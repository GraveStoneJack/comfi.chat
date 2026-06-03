const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const PendingUser = require('../models/PendingUser');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { sendMail } = require('../lib/mailSettings');

const router = express.Router();

function signToken(payload) {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    return jwt.sign(payload, secret, { expiresIn: '30d' });
}

function parseList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        return value.split(',').map(item => item.trim()).filter(Boolean);
    }
    return [];
}

function uploadsPathFromUrl(value) {
    if (!value) return '';
    const match = /\/uploads\/([^?#]+)/i.exec(String(value));
    return match ? `/uploads/${match[1]}` : '';
}

function normalizePhotoUrl(value) {
    if (value === null || value === 'default-profile.png') return 'default-profile.png';
    if (!value) return undefined;
    const uploadsPath = uploadsPathFromUrl(value);
    if (uploadsPath) return uploadsPath;
    return String(value);
}

function normalizeProfilePhotos(value) {
    return parseList(value)
        .map(item => normalizePhotoUrl(item))
        .filter(item => item && item !== 'default-profile.png')
        .slice(0, 10);
}

function getBaseUrl(req) {
    // Prefer FRONTEND_URL if set to ensure email links open on the correct host
    const host = process.env.FRONTEND_URL || process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    return host;
}

router.post('/email/signup', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password || password.length < 6) {
            return res.status(400).json({ error: 'Email and password (min 6) required' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(409).json({ error: 'Email already in use' });

        const token = crypto.randomBytes(24).toString('hex');
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await PendingUser.findOneAndUpdate(
            { email },
            { email, passwordHash, token, verified: false, expiresAt },
            { upsert: true, new: true }
        );

        const verifyUrl = `${getBaseUrl(req)}/verify.html?token=${token}`;
        const result = await sendMail({
            to: email,
            subject: 'Verify your ComfiChat email',
            text: `Click to verify your email: ${verifyUrl}`,
            html: `<p>Click to verify your email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`
        });

        return res.json({ ok: true, preview: result.preview, mailSource: result.source });
    } catch (e) {
        console.error('[Auth] email signup error:', e);
        return res.status(500).json({ error: 'Failed to start signup' });
    }
});

router.post('/email/verify', async (req, res) => {
    try {
        const { token } = req.body || {};
        if (!token) return res.status(400).json({ error: 'Token required' });
        const pending = await PendingUser.findOne({ token }).select('+passwordHash');
        if (!pending) return res.status(400).json({ error: 'Invalid or expired token' });
        // Mark verified and return a temporary token allowing profile completion
        pending.verified = true;
        await pending.save();
        const tempToken = signToken({ pendingEmail: pending.email, type: 'pending' });
        return res.json({ ok: true, tempToken });
    } catch (e) {
        console.error('[Auth] email verify error:', e);
        return res.status(500).json({ error: 'Verification failed' });
    }
});

router.post('/email/finalize', async (req, res) => {
    try {
        const {
            tempToken,
            username,
            age,
            gender,
            displayName,
            profilePicture,
            profilePhotos,
            hairType,
            hairColor,
            eyeColor,
            ethnicity,
            hobbies,
            transgender,
            sexuality,
            lookingFor
        } = req.body || {};
        if (!tempToken) return res.status(400).json({ error: 'tempToken required' });
        const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
        let decoded;
        try { decoded = jwt.verify(tempToken, secret); } catch { return res.status(401).json({ error: 'Invalid temp token' }); }
        if (!decoded || decoded.type !== 'pending' || !decoded.pendingEmail) return res.status(401).json({ error: 'Invalid temp token' });
        const cleanDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
        const cleanSexuality = typeof sexuality === 'string' ? sexuality.trim() : '';
        if (!username || !cleanDisplayName || !age || !gender || !cleanSexuality) {
            return res.status(400).json({ error: 'username, displayName, age, gender, sexuality required' });
        }

        const pending = await PendingUser.findOne({ email: decoded.pendingEmail }).select('+passwordHash');
        if (!pending || !pending.verified) return res.status(400).json({ error: 'Pending record not verified' });
        const email = pending.email;
        const exists = await User.findOne({ $or: [{ email }, { username }] });
        if (exists) return res.status(409).json({ error: 'Username or email already in use' });

        const user = new User({
            username,
            email,
            age,
            gender,
            displayName: cleanDisplayName,
            profilePicture: normalizePhotoUrl(profilePicture),
            profilePhotos: normalizeProfilePhotos(profilePhotos),
            hairType,
            hairColor,
            eyeColor,
            ethnicity,
            hobbies: parseList(hobbies),
            transgender,
            sexuality: cleanSexuality,
            lookingFor: parseList(lookingFor)
        });
        user.password = pending.passwordHash; // already hashed
        await user.save();
        await PendingUser.deleteOne({ _id: pending._id });
        const token = signToken({ id: user._id.toString(), username: user.username, email: user.email });
        const safeUser = await User.findById(user._id).lean();
        return res.json({ token, user: safeUser });
    } catch (e) {
        console.error('[Auth] email finalize error:', e);
        return res.status(500).json({ error: 'Finalize failed' });
    }
});

module.exports = router;


