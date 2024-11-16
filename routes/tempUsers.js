// routes/tempUsers.js
const express = require('express');
const router = express.Router(); // Add this line at the top
const TempUser = require('../models/TempUser');

// Create temporary user
router.post('/create', async (req, res) => {
    try {
        console.log('[TempUser Create] Request body:', req.body);

        const { username, age, gender, country, countryCode } = req.body;

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

        // Check if username already exists
        const existingUser = await TempUser.findOne({ username });
        if (existingUser) {
            console.log('[TempUser Create] Username exists:', username);
            return res.status(400).json({ error: 'Username already taken' });
        }

        console.log('[TempUser Create] Creating new user with data:', {
            username,
            age,
            gender,
            country,
            countryCode
        });

        const tempUser = new TempUser({
            username,
            age,
            gender,
            country,
            countryCode,
            isOnline: true
        });

        const savedUser = await tempUser.save();
        console.log('[TempUser Create] User created:', savedUser);
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

// Get online users
router.get('/online', async (req, res) => {
    try {
        const onlineUsers = await TempUser.find({ isOnline: true });
        res.json(onlineUsers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update user online status
router.put('/status/:username', async (req, res) => {
    try {
        const { isOnline } = req.body;
        const user = await TempUser.findOneAndUpdate(
            { username: req.params.username },
            {
                isOnline,
                lastSeen: new Date() // Track last activity
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        console.log(`User ${user.username} status updated to ${isOnline}`);
        res.json(user);
    } catch (error) {
        console.error('Error updating user status:' error);
        res.status(500).json({ error: 'Failed to update user status' });
    }
});

// Get online users - add sorting by lastSeen
router.get('/online', async (req, res) => {
    try {
        const onlineUsers = await TempUser.find({ isOnline: true })
            .sort({ lastSeen: -1 }); // Sort by most recently active

        console.log(`Fetch ${onlineUsers.length} online users`);
        res.json(onlineUsers);
    } catch (error) {
        console.error('Error fetching online users:' error);
        res.status(500).json({ error: 'Failed to fetch online users' });
    }
});

module.exports = router;
