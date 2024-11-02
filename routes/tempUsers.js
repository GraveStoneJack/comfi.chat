// routes/tempUsers.js
const express = require('express');
const router = express.Router();
const TempUser = require('../models/TempUser');

// Create temporary user
router.post('/create', async (req, res) => {
    try {
        console.log('Received request body:', req.body); // Added for debugging

        const { username, age, gender, country, countryCode } = req.body;
        
        // Validate required fields
        if (!username || !age || !gender || !country || !countryCode) {
            console.log('Missing required fields:', { username, age, gender, country, countryCode });
            return res.status(400).json({ 
                error: 'Missing required fields',
                details: { username, age, gender, country, countryCode }
            });
        }

        // Check if username already exists
        const existingUser = await TempUser.findOne({ username });
        if (existingUser) {
            console.log('Username already exists:', username);
            return res.status(400).json({ error: 'Username already taken' });
        }

        const tempUser = new TempUser({
            username,
            age,
            gender,
            country,
            countryCode
        });

        await tempUser.save();
        console.log('User created successfully:', tempUser);
        res.status(201).json(tempUser);
    } catch (error) {
        console.error('Error creating temporary user:', error);
        res.status(500).json({ 
            error: 'Error creating temporary user',
            details: error.message
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
            { isOnline },
            { new: true }
        );
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
