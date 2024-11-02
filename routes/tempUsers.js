// routes/tempUsers.js
const express = require('express');
const router = express.Router();
const TempUser = require('../models/TempUser');

// Create temporary user
router.post('/create', async (req, res) => {
    try {
        const { username, age, gender, country, countryCode } = req.body;
        
        // Check if username already exists
        const existingUser = await TempUser.findOne({ username });
        if (existingUser) {
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
        res.status(201).json(tempUser);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
