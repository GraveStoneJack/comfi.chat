const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const PendingUser = require('../models/PendingUser');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const AppleStrategy = require('passport-apple').Strategy;

const router = express.Router();

function signToken(payload) {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    return jwt.sign(payload, secret, { expiresIn: '30d' });
}

function getBaseUrl(req) {
    // Prefer FRONTEND_URL if set to ensure email links open on the correct host
    const host = process.env.FRONTEND_URL || process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    return host;
}

async function getMailer() {
    if (process.env.SMTP_URL) {
        return nodemailer.createTransport(process.env.SMTP_URL);
    }
    // Fallback: Ethereal for development
    const test = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: test.user, pass: test.pass }
    });
}

// ============ OAuth (Google / Apple) Setup ============
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const PUBLIC_URL = process.env.PUBLIC_URL; // backend base for callbacks if needed

function getBackendBase(req) {
    return PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

const hasGoogle = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
if (hasGoogle) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: (PUBLIC_URL || '') + '/api/auth/google/callback'
    }, (accessToken, refreshToken, profile, done) => {
        const email = Array.isArray(profile.emails) && profile.emails[0] ? profile.emails[0].value : undefined;
        const photo = Array.isArray(profile.photos) && profile.photos[0] ? profile.photos[0].value : undefined;
        return done(null, {
            provider: 'google',
            providerId: profile.id,
            email,
            displayName: profile.displayName,
            picture: photo
        });
    }));
}

const hasApple = !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY);
if (hasApple) {
    passport.use(new AppleStrategy({
        clientID: process.env.APPLE_CLIENT_ID,
        teamID: process.env.APPLE_TEAM_ID,
        keyID: process.env.APPLE_KEY_ID,
        privateKey: process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        callbackURL: (PUBLIC_URL || '') + '/api/auth/apple/callback',
        scope: ['name', 'email'],
        passReqToCallback: false
    }, (accessToken, refreshToken, idToken, profile, done) => {
        // Apple can omit email on subsequent logins
        const email = profile && profile.email ? profile.email : undefined;
        return done(null, {
            provider: 'apple',
            providerId: profile && (profile.id || profile.sub),
            email,
            displayName: profile && profile.name ? `${profile.name.firstName || ''} ${profile.name.lastName || ''}`.trim() : undefined
        });
    }));
}

router.get('/google/start', (req, res, next) => {
    if (!hasGoogle) return res.status(501).json({ error: 'Google OAuth not configured' });
    return passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
    if (!hasGoogle) return res.redirect(`${FRONTEND_URL}/?auth=google_not_configured`);
    passport.authenticate('google', { session: false }, (err, user) => {
        if (err || !user) return res.redirect(`${FRONTEND_URL}/?auth=google_failed`);
        const tempToken = signToken({ type: 'oauth', provider: user.provider, providerId: user.providerId, email: user.email, displayName: user.displayName });
        return res.redirect(`${FRONTEND_URL}/profile.html?provider=google&tempToken=${encodeURIComponent(tempToken)}`);
    })(req, res, next);
});

router.get('/apple/start', (req, res, next) => {
    if (!hasApple) return res.status(501).json({ error: 'Apple OAuth not configured' });
    return passport.authenticate('apple', { session: false })(req, res, next);
});

router.post('/apple/callback', (req, res, next) => {
    if (!hasApple) return res.redirect(`${FRONTEND_URL}/?auth=apple_not_configured`);
    passport.authenticate('apple', { session: false }, (err, user) => {
        if (err || !user) return res.redirect(`${FRONTEND_URL}/?auth=apple_failed`);
        const tempToken = signToken({ type: 'oauth', provider: user.provider, providerId: user.providerId, email: user.email, displayName: user.displayName });
        return res.redirect(`${FRONTEND_URL}/profile.html?provider=apple&tempToken=${encodeURIComponent(tempToken)}`);
    })(req, res, next);
});

// Finalize OAuth into a full user after profile completion
router.post('/oauth/finalize', async (req, res) => {
    try {
        const { tempToken, username, age, gender, displayName, profilePicture } = req.body || {};
        if (!tempToken) return res.status(400).json({ error: 'tempToken required' });
        const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
        let decoded; try { decoded = jwt.verify(tempToken, secret); } catch { return res.status(401).json({ error: 'Invalid temp token' }); }
        if (!decoded || decoded.type !== 'oauth') return res.status(401).json({ error: 'Invalid temp token' });
        if (!username || !age || !gender) return res.status(400).json({ error: 'username, age, gender required' });

        const email = decoded.email; // may be undefined for Apple
        const provider = decoded.provider;
        const providerId = decoded.providerId;

        // Ensure unique username/email
        if (email) {
            const existingEmail = await User.findOne({ email });
            if (existingEmail) return res.status(409).json({ error: 'Email already in use' });
        }
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(409).json({ error: 'Username already in use' });

        const user = new User({ username, email, age, gender, displayName: displayName || decoded.displayName || username, profilePicture });
        if (provider === 'google') user.googleId = providerId;
        if (provider === 'apple') user.appleId = providerId;
        await user.save();

        const token = signToken({ id: user._id.toString(), username: user.username, email: user.email });
        const safeUser = await User.findById(user._id).lean();
        return res.json({ token, user: safeUser });
    } catch (e) {
        console.error('[Auth] oauth finalize error:', e);
        return res.status(500).json({ error: 'Finalize failed' });
    }
});

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
        const transporter = await getMailer();
        const info = await transporter.sendMail({
            from: process.env.MAIL_FROM || 'no-reply@comfi.chat',
            to: email,
            subject: 'Verify your ComfiChat email',
            text: `Click to verify your email: ${verifyUrl}`,
            html: `<p>Click to verify your email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`
        });

        const preview = nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : undefined;
        return res.json({ ok: true, preview });
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
        const { tempToken, username, age, gender, displayName, profilePicture } = req.body || {};
        if (!tempToken) return res.status(400).json({ error: 'tempToken required' });
        const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
        let decoded;
        try { decoded = jwt.verify(tempToken, secret); } catch { return res.status(401).json({ error: 'Invalid temp token' }); }
        if (!decoded || decoded.type !== 'pending' || !decoded.pendingEmail) return res.status(401).json({ error: 'Invalid temp token' });
        if (!username || !age || !gender) return res.status(400).json({ error: 'username, age, gender required' });

        const pending = await PendingUser.findOne({ email: decoded.pendingEmail }).select('+passwordHash');
        if (!pending || !pending.verified) return res.status(400).json({ error: 'Pending record not verified' });
        const email = pending.email;
        const exists = await User.findOne({ $or: [{ email }, { username }] });
        if (exists) return res.status(409).json({ error: 'Username or email already in use' });

        const user = new User({ username, email, age, gender, displayName: displayName || username, profilePicture });
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


