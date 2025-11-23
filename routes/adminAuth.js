const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { authenticator } = require('otplib');
const AdminUser = require('../models/AdminUser');

const router = express.Router();

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

// Create new admin (owner only)
router.post('/users', requireAdmin, async (req, res) => {
	try {
		if (!req.admin || (req.admin.role !== 'owner' && req.admin.role !== 'admin')) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const { username, email, password, role, totpSecret } = req.body || {};
		if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
		const existing = await AdminUser.findOne({ $or: [ { username }, { email } ] });
		if (existing) return res.status(409).json({ error: 'Username or email already used' });
		const bcryptjs = require('bcryptjs');
		const hash = await bcryptjs.hash(password, 10);
		const admin = await AdminUser.create({
			username, email, passwordHash: hash, role: role || 'admin', totpSecret: totpSecret || require('otplib').authenticator.generateSecret()
		});
		return res.status(201).json({ id: admin._id.toString() });
	} catch (e) {
		console.error('[AdminAuth] create user', e);
		res.status(500).json({ error: 'Failed to create admin' });
	}
});

module.exports = { router, requireAdmin };


