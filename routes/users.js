const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

function signToken(payload) {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    return jwt.sign(payload, secret, { expiresIn: '30d' });
}

function authMiddleware(req, res, next) {
    try {
        const header = req.headers['authorization'] || '';
        const token = header.startsWith('Bearer ') ? header.substring(7) : null;
        if (!token) return res.status(401).json({ error: 'Missing token' });
        const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
        const decoded = jwt.verify(token, secret);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

router.post('/register', async (req, res) => {
    try {
        const {
            username,
            email,
            password,
            displayName,
            age,
            gender,
            profilePicture,
            hairType,
            hairColor,
            eyeColor,
            ethnicity,
            hobbies,
            sexuality,
            lookingFor,
            provider,
            providerId
        } = req.body || {};

        if (!username || !email || !age || !gender) {
            return res.status(400).json({ error: 'username, email, age and gender are required' });
        }

        const existing = await User.findOne({ $or: [ { username }, { email } ] });
        if (existing) {
            return res.status(409).json({ error: 'Username or email already in use' });
        }

        const user = new User({
            username,
            email,
            displayName: displayName || username,
            age,
            gender,
            profilePicture,
            hairType,
            hairColor,
            eyeColor,
            ethnicity,
            hobbies: Array.isArray(hobbies) ? hobbies : (typeof hobbies === 'string' && hobbies ? hobbies.split(',').map(s => s.trim()).filter(Boolean) : []),
            sexuality,
            lookingFor: Array.isArray(lookingFor) ? lookingFor : (typeof lookingFor === 'string' && lookingFor ? lookingFor.split(',').map(s => s.trim()).filter(Boolean) : [])
        });

        if (provider === 'google' && providerId) user.googleId = providerId;
        if (provider === 'apple' && providerId) user.appleId = providerId;

        if (!provider || provider === 'email') {
            if (!password || password.length < 6) {
                return res.status(400).json({ error: 'Password (min 6 chars) is required for email sign up' });
            }
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        await user.save();

        const token = signToken({ id: user._id.toString(), username: user.username, email: user.email });
        const safeUser = await User.findById(user._id).lean();
        return res.status(201).json({ token, user: safeUser });
    } catch (e) {
        console.error('[Users] register error:', e);
        return res.status(500).json({ error: 'Registration failed' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        const user = await User.findOne({ email }).select('+password');
        if (!user || !user.password) return res.status(401).json({ error: 'Invalid credentials' });
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
        const token = signToken({ id: user._id.toString(), username: user.username, email: user.email });
        const safeUser = await User.findById(user._id).lean();
        return res.json({ token, user: safeUser });
    } catch (e) {
        console.error('[Users] login error:', e);
        return res.status(500).json({ error: 'Login failed' });
    }
});

router.get('/me', authMiddleware, async (req, res) => {
    try {
        const me = await User.findById(req.user.id).lean();
        if (!me) return res.status(404).json({ error: 'User not found' });
        return res.json(me);
    } catch (e) {
        console.error('[Users] me error:', e);
        return res.status(500).json({ error: 'Failed to fetch user' });
    }
});

router.put('/me', authMiddleware, async (req, res) => {
    try {
        const allowed = [
            'displayName','age','gender','profilePicture','hairType','hairColor','eyeColor','ethnicity','hobbies','sexuality','lookingFor','weight','height'
        ];
        const update = {};
        for (const key of allowed) {
            if (key in req.body) update[key] = req.body[key];
        }
        if (typeof update.hobbies === 'string') update.hobbies = update.hobbies.split(',').map(s => s.trim()).filter(Boolean);
        if (typeof update.lookingFor === 'string') update.lookingFor = update.lookingFor.split(',').map(s => s.trim()).filter(Boolean);
        const saved = await User.findByIdAndUpdate(req.user.id, update, { new: true }).lean();
        return res.json(saved);
    } catch (e) {
        console.error('[Users] update error:', e);
        return res.status(500).json({ error: 'Failed to update profile' });
    }
});

router.get('/public/:username', async (req, res) => {
    try {
        const u = await User.findOne({ username: req.params.username }).lean();
        if (!u) return res.status(404).json({ error: 'User not found' });
        const { password, googleId, appleId, ...rest } = u;
        return res.json(rest);
    } catch (e) {
        console.error('[Users] public profile error:', e);
        return res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

module.exports = router;


