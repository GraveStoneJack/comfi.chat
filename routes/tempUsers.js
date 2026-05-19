// routes/tempUsers.js
const express = require('express');
const router = express.Router();
const TempUser = require('../models/TempUser');
const LoginEvent = require('../models/LoginEvent');
const User = require('../models/User');

function publicUserProfile(user) {
    return {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        age: user.age,
        gender: user.gender,
        sexuality: user.sexuality,
        lookingFor: user.lookingFor || [],
        profilePicture: user.profilePicture,
        hairType: user.hairType,
        hairColor: user.hairColor,
        eyeColor: user.eyeColor,
        ethnicity: user.ethnicity,
        hobbies: user.hobbies || [],
        country: user.country,
        countryCode: user.countryCode,
        isOnline: !!user.isOnline,
        lastSeen: user.lastSeen || user.lastActive || user.updatedAt,
        accountType: 'registered'
    };
}

// Create temporary user
router.post('/create', async (req, res) => {
    try {
        console.log('[TempUser Create] Request body:', req.body);

        const { username, age, gender, country, countryCode, deviceId } = req.body;

        // Validation logging
        console.log('[TempUser Create] Validating fields:', {
            hasUsername: !!username,
            hasAge: !!age,
            hasGender: !!gender,
            hasCountry: !!country,
            hasCountryCode: !!countryCode
        });

        // Validate required fields
        if (!username || !age || !gender || !country || !countryCode) {
            const missingFields = [];
            if (!username) missingFields.push('username');
            if (!age) missingFields.push('age');
            if (!gender) missingFields.push('gender');
            if (!country) missingFields.push('country');
            if (!countryCode) missingFields.push('countryCode');

            console.log('[TempUser Create] Missing fields:', missingFields);

            return res.status(400).json({
                error: 'Missing required fields',
                missingFields
            });
        }

        // Validate age
        if (isNaN(age) || age < 13 || age > 100) {
            return res.status(400).json({
                error: 'Invalid age',
                details: 'Age must be between 13 and 100'
            });
        }

        // Validate gender
        if (!['male', 'female', 'other'].includes(gender)) {
            return res.status(400).json({
                error: 'Invalid gender',
                details: 'Gender must be male, female, or other'
            });
        }

        // Check if username already exists - allow reclaim by same device within hold window
        const existingUser = await TempUser.findOne({ username });
        if (existingUser) {
            // If same deviceId and within 1 hour of lastSeen, allow reuse and update record
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const sameDevice = deviceId && existingUser.deviceId && existingUser.deviceId === deviceId;
            if (!(sameDevice && existingUser.lastSeen && existingUser.lastSeen > oneHourAgo)) {
                console.log('[TempUser Create] Username exists and reserved by another device:', username);
                return res.status(400).json({ error: 'Username already taken' });
            }
        }

        console.log('[TempUser Create] Creating new user with data:', {
            username,
            age,
            gender,
            country,
            countryCode
        });

        const holdUntil = new Date(Date.now() + 60 * 60 * 1000);
        const payload = {
            username,
            deviceId,
            age,
            gender,
            country,
            countryCode,
            isOnline: true,
            lastSeen: new Date(),
            expiresAt: holdUntil
        };

        let savedUser;
        if (existingUser) {
            Object.assign(existingUser, payload);
            savedUser = await existingUser.save();
        } else {
            const tempUser = new TempUser(payload);
            savedUser = await tempUser.save();
        }
        console.log('[TempUser Create] User created:', savedUser);
        // Record a login event for auditing/admin views
        try {
            await LoginEvent.create({
                username,
                deviceId,
                type: 'login',
                userType: 'temp',
                metadata: { age, gender, country, countryCode },
                timestamp: new Date()
            });
        } catch (e) {
            console.error('[TempUser Create] Failed to record login event:', e);
        }
        res.status(201).json(savedUser);
    } catch (error) {
        console.error('[TempUser Create] Error:', error);
        res.status(500).json({
            error: 'Error creating temporary user',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Update user online status with combined handlers
router.put('/status/:username', handleStatus);
router.post('/status/:username', handleStatus);

async function handleStatus(req, res) {
    try {
        console.log('[TempUser Status] Updating status for:', req.params.username, 'to:', req.body.isOnline);

        const holdUntil = new Date(Date.now() + 60 * 60 * 1000);
        const update = {
            isOnline: req.body.isOnline,
            lastSeen: new Date(),
            expiresAt: holdUntil
        };
        if (req.body.deviceId) update.deviceId = req.body.deviceId;
        const updatedUser = await TempUser.findOneAndUpdate(
            { username: req.params.username },
            update,
            { new: true }
        );

        if (!updatedUser) {
            const registeredUser = await User.findOneAndUpdate(
                { username: req.params.username },
                {
                    isOnline: req.body.isOnline,
                    lastActive: new Date()
                },
                { new: true }
            ).lean();
            if (!registeredUser) {
                console.log('[TempUser Status] User not found:', req.params.username);
                return res.status(404).json({ error: 'User not found' });
            }
            return res.json(publicUserProfile(registeredUser));
        }

        console.log('[TempUser Status] Successfully updated user:', updatedUser);
        // If this is a transition to offline, record a logout event
        try {
            if (req.body && (req.body.isOnline === false || req.body.isOnline === 'false')) {
                await LoginEvent.create({
                    username: req.params.username,
                    deviceId: update.deviceId,
                    type: 'logout',
                    userType: 'temp',
                    timestamp: new Date()
                });
            }
        } catch (e) {
            console.error('[TempUser Status] Failed to record logout event:', e);
        }
        res.json(updatedUser);
    } catch (error) {
        console.error('[TempUser Status] Error:', error);
        res.status(500).json({ error: 'Failed to update user status' });
    }
}

// Get online users - add sorting by lastSeen
router.get('/online', async (req, res) => {
    try {
        const [tempUsers, registeredUsers] = await Promise.all([
            TempUser.find({ isOnline: true }).sort({ lastSeen: -1 }).lean(),
            User.find({ isOnline: true })
                .select('username displayName age gender sexuality lookingFor profilePicture hairType hairColor eyeColor ethnicity hobbies country countryCode isOnline lastActive updatedAt')
                .sort({ lastActive: -1 })
                .lean()
        ]);

        const tempUsernames = new Set(tempUsers.map(user => user.username));
        const onlineUsers = [
            ...tempUsers.map(user => ({ ...user, accountType: 'guest' })),
            ...registeredUsers
                .filter(user => !tempUsernames.has(user.username))
                .map(publicUserProfile)
        ].sort((a, b) => new Date(b.lastSeen || b.lastActive || 0) - new Date(a.lastSeen || a.lastActive || 0));

        console.log('[TempUser Online] Fetched online users:', {
            count: onlineUsers.length,
            usernames: onlineUsers.map(user => user.username)
        });

        res.json(onlineUsers);
    } catch (error) {
        console.error('[TempUser Online] Error fetching online users:', error);
        res.status(500).json({ error: 'Failed to fetch online users' });
    }
});

// Delete user immediately at logoff (explicit)
router.delete('/delete/:username', handleDelete);
router.post('/delete/:username', handleDelete);

async function handleDelete(req, res) {
    try {
        console.log('[TempUser Delete] Attempting to delete user:', req.params.username);

        const deletedUser = await TempUser.findOneAndDelete({
            username: req.params.username
        });

        if (!deletedUser) {
            console.log('[TempUser Delete] User not found:', req.params.username);
            return res.status(404).json({ error: 'User not found' });
        }

        console.log('[TempUser Delete] Successfully deleted user:', deletedUser);
        // Record a logout event when the temp user is deleted
        try {
            await LoginEvent.create({
                username: req.params.username,
                deviceId: deletedUser?.deviceId,
                type: 'logout',
                userType: 'temp',
                timestamp: new Date()
            });
        } catch (e) {
            console.error('[TempUser Delete] Failed to record logout event:', e);
        }
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('[TempUser Delete] Error:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
}

module.exports = router;
