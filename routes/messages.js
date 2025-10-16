// routes/messages.js
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

// Fetch message history between two users, ordered ascending by time
router.get('/history/:userA/:userB', async (req, res) => {
    const { userA, userB } = req.params;
    try {
        const history = await Message.find({
            $or: [
                { sender: userA, recipient: userB },
                { sender: userB, recipient: userA }
            ]
        }).sort({ timestamp: 1 }).lean();
        res.json(history);
    } catch (err) {
        console.error('[Messages] history error:', err);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

module.exports = router;


