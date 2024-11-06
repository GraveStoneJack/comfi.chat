// routes/tempUsers.js
const express = require('express');
const router = express.Router();
const TempUser = require('../models/TempUser');

// Create temporary user
outer.post('/create', async (req, res) => {
    try {
        console.log('Received request body:', req.body);

        const { username, age, gender, country, countryCode } = req.body;
        
        // Log all received data
        console.log('Parsed data:', {
            username,
            age,
            gender,
            country,
            countryCode
        });

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

        // Create new user with explicit data
        const tempUser = new TempUser({
            username: username,
            age: parseInt(age),
            gender: gender,
            country: country,
            countryCode: countryCode,
            isOnline: true,
            createdAt: new Date()
        });

        // Log the user object before saving
        console.log('Attempting to save user:', tempUser);

        const savedUser = await tempUser.save();
        console.log('User created successfully:', savedUser);
        res.status(201).json(savedUser);
    } catch (error) {
        console.error('Error creating temporary user:', error);
        // Send more detailed error information
        res.status(500).json({ 
            error: 'Error creating temporary user',
            message: error.message,
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
            { isOnline },
            { new: true }
        );
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
