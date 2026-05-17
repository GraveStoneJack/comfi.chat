const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { authenticator } = require('otplib');
const AdminUser = require('../models/AdminUser');

const router = express.Router();
const ADMIN_ROLES = ['owner', 'admin', 'moderator', 'viewer'];

const LOGIN_LIMITER = rateLimit({
	windowMs: 5 * 60 * 1000,
	max: 20
});

function signTempMfaToken(adminId) {
	return jwt.sign({ sub: adminId, stage: 'mfa' }, process.env.ADMIN_JWT_SECRET, { expiresIn: '5m' });
}

function signAdminSession(admin) {
	return jwt.sign({ sub: admin._id.toString(), role: admin.role }, process.env.ADMIN_JWT_SECRET, { expiresIn: '12h' });
}

function requireAdmin(req, res, next) {
	try {
		const token = req.cookies && req.cookies.admin_token;
		if (!token) return res.status(401).json({ error: 'Unauthorized' });
		const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
		req.admin = payload;
		next();
	} catch (_e) {
		return res.status(401).json({ error: 'Unauthorized' });
	}
}

function canManageAdmins(role) {
	return role === 'owner' || role === 'admin';
}

function safeAdmin(admin) {
	return {
		id: admin._id.toString(),
		username: admin.username,
		email: admin.email,
		role: admin.role,
		isActive: !!admin.isActive,
		lastLoginAt: admin.lastLoginAt,
		createdAt: admin.createdAt
	};
}

async function assertOwnerWouldRemain(targetAdmin, nextRole, nextIsActive) {
	if (!targetAdmin || targetAdmin.role !== 'owner') return;
	const wouldStillBeOwner = nextRole === 'owner' && nextIsActive !== false;
	if (wouldStillBeOwner) return;
	const activeOwners = await AdminUser.countDocuments({ role: 'owner', isActive: true, _id: { $ne: targetAdmin._id } });
	if (activeOwners < 1) {
		const error = new Error('At least one active owner account is required');
		error.status = 400;
		throw error;
	}
}

router.post('/login', LOGIN_LIMITER, async (req, res) => {
	try {
		const { username, password } = req.body || {};
		if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
		const admin = await AdminUser.findOne({ username, isActive: true }).select('+passwordHash +totpSecret');
		if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
		const ok = await bcrypt.compare(password, admin.passwordHash);
		if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
		const tempToken = signTempMfaToken(admin._id.toString());
		return res.json({ mfaRequired: true, tempToken });
	} catch (e) {
		console.error('[AdminAuth] login error', e);
		return res.status(500).json({ error: 'Login failed' });
	}
});

router.post('/mfa/verify', LOGIN_LIMITER, async (req, res) => {
	try {
		const { code, tempToken } = req.body || {};
		if (!code || !tempToken) return res.status(400).json({ error: 'Missing parameters' });
		const payload = jwt.verify(tempToken, process.env.ADMIN_JWT_SECRET);
		if (!payload || payload.stage !== 'mfa') return res.status(401).json({ error: 'Invalid token' });
		const admin = await AdminUser.findById(payload.sub).select('+totpSecret');
		if (!admin || !admin.isActive) return res.status(401).json({ error: 'Invalid token' });
		const valid = authenticator.check(code, admin.totpSecret);
		if (!valid) return res.status(401).json({ error: 'Invalid code' });
		admin.lastLoginAt = new Date();
		await admin.save();
		const session = signAdminSession(admin);
		res.cookie('admin_token', session, {
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
			maxAge: 12 * 60 * 60 * 1000
		});
		return res.json({ ok: true, role: admin.role, id: admin._id.toString() });
	} catch (e) {
		console.error('[AdminAuth] mfa verify error', e);
		return res.status(401).json({ error: 'Unauthorized' });
	}
});

router.post('/logout', (req, res) => {
	res.clearCookie('admin_token');
	res.json({ ok: true });
});

router.get('/me', requireAdmin, async (req, res) => {
	try {
		const admin = await AdminUser.findById(req.admin.sub).lean();
		if (!admin) return res.status(404).json({ error: 'Not found' });
		res.json({ username: admin.username, email: admin.email, role: admin.role, id: admin._id.toString() });
	} catch (e) {
		res.status(500).json({ error: 'Failed' });
	}
});

router.get('/users', requireAdmin, async (req, res) => {
	try {
		if (!canManageAdmins(req.admin && req.admin.role)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const users = await AdminUser.find({}).sort({ role: 1, username: 1 }).lean();
		res.json(users.map(safeAdmin));
	} catch (e) {
		console.error('[AdminAuth] list users', e);
		res.status(500).json({ error: 'Failed to load admin users' });
	}
});

// Create new admin
router.post('/users', requireAdmin, async (req, res) => {
	try {
		if (!canManageAdmins(req.admin && req.admin.role)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const { username, email, password, role, totpSecret } = req.body || {};
		if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
		const nextRole = ADMIN_ROLES.includes(role) ? role : 'admin';
		if (nextRole === 'owner' && req.admin.role !== 'owner') return res.status(403).json({ error: 'Only owners can create owner accounts' });
		const existing = await AdminUser.findOne({ $or: [ { username }, { email } ] });
		if (existing) return res.status(409).json({ error: 'Username or email already used' });
		const bcryptjs = require('bcryptjs');
		const hash = await bcryptjs.hash(password, 10);
		const secret = totpSecret || require('otplib').authenticator.generateSecret();
		const admin = await AdminUser.create({
			username,
			email,
			passwordHash: hash,
			role: nextRole,
			totpSecret: secret
		});
		const otpauth = require('otplib').authenticator.keyuri(email, 'Comfi Admin', secret);
		return res.status(201).json({ admin: safeAdmin(admin), totpSecret: secret, otpauth });
	} catch (e) {
		console.error('[AdminAuth] create user', e);
		res.status(500).json({ error: 'Failed to create admin' });
	}
});

router.patch('/users/:id', requireAdmin, async (req, res) => {
	try {
		if (!canManageAdmins(req.admin && req.admin.role)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const target = await AdminUser.findById(req.params.id);
		if (!target) return res.status(404).json({ error: 'Admin user not found' });
		const update = {};
		if ('role' in req.body) {
			if (!ADMIN_ROLES.includes(req.body.role)) return res.status(400).json({ error: 'Invalid role' });
			if ((target.role === 'owner' || req.body.role === 'owner') && req.admin.role !== 'owner') {
				return res.status(403).json({ error: 'Only owners can modify owner roles' });
			}
			update.role = req.body.role;
		}
		if ('isActive' in req.body) {
			if (target._id.toString() === req.admin.sub && req.body.isActive === false) {
				return res.status(400).json({ error: 'You cannot deactivate your own account' });
			}
			update.isActive = !!req.body.isActive;
		}
		await assertOwnerWouldRemain(target, update.role || target.role, 'isActive' in update ? update.isActive : target.isActive);
		Object.assign(target, update);
		await target.save();
		res.json(safeAdmin(target));
	} catch (e) {
		console.error('[AdminAuth] update user', e);
		res.status(e.status || 500).json({ error: e.message || 'Failed to update admin user' });
	}
});

router.post('/users/:id/password', requireAdmin, async (req, res) => {
	try {
		if (!canManageAdmins(req.admin && req.admin.role)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const { password } = req.body || {};
		if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
		const target = await AdminUser.findById(req.params.id);
		if (!target) return res.status(404).json({ error: 'Admin user not found' });
		if (target.role === 'owner' && req.admin.role !== 'owner') return res.status(403).json({ error: 'Only owners can rotate owner passwords' });
		target.passwordHash = await bcrypt.hash(password, 10);
		await target.save();
		res.json({ ok: true });
	} catch (e) {
		console.error('[AdminAuth] rotate password', e);
		res.status(500).json({ error: 'Failed to rotate password' });
	}
});

router.post('/users/:id/mfa-reset', requireAdmin, async (req, res) => {
	try {
		if (!canManageAdmins(req.admin && req.admin.role)) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const target = await AdminUser.findById(req.params.id);
		if (!target) return res.status(404).json({ error: 'Admin user not found' });
		if (target.role === 'owner' && req.admin.role !== 'owner') return res.status(403).json({ error: 'Only owners can reset owner MFA' });
		const secret = authenticator.generateSecret();
		target.totpSecret = secret;
		await target.save();
		res.json({ ok: true, totpSecret: secret, otpauth: authenticator.keyuri(target.email, 'Comfi Admin', secret) });
	} catch (e) {
		console.error('[AdminAuth] reset mfa', e);
		res.status(500).json({ error: 'Failed to reset MFA' });
	}
});

module.exports = { router, requireAdmin };


