// routes/tempUsers.js
const express = require('express');
const router = express.Router();
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

// Update user online status with combined handlers
router.put('/status/:username', handleStatus);
router.post('/status/:username', handleStatus);

async function handleStatus(req, res) {
    try {
        console.log('[TempUser Status] Updating status for:', req.params.username, 'to:', req.body.isOnline);

        const updatedUser = await TempUser.findOneAndUpdate(
            { username: req.params.username },
            {
                isOnline: req.body.isOnline,
                lastSeen: new Date()
            },
            { new: true }
        );

        if (!updatedUser) {
            console.log('[TempUser Status] User not found:', req.params.username);
            return res.status(404).json({ error: 'User not found' });
        }

        console.log('[TempUser Status] Successfully updated user:', updatedUser);
        res.json(updatedUser);
    } catch (error) {
        console.error('[TempUser Status] Error:', error);
        res.status(500).json({ error: 'Failed to update user status' });
    }
}

// Get online users - add sorting by lastSeen
router.get('/online', async (req, res) => {
    try {
        const onlineUsers = await TempUser.find({ isOnline: true })
            .sort({ lastSeen: -1 }); // Sort by most recently active

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

// Delete user from database at logoff
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
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('[TempUser Delete] Error:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
}

module.exports = router;
