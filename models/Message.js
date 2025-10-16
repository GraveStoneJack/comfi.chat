// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: String,
        required: true,
        index: true
    },
    recipient: {
        type: String,
        required: true,
        index: true
    },
    message: {
        type: String,
        required: true,
        trim: true
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: false
});

// Compound index for efficient two-party history queries
messageSchema.index({ sender: 1, recipient: 1, timestamp: 1 });
messageSchema.index({ recipient: 1, sender: 1, timestamp: 1 });

module.exports = mongoose.model('Message', messageSchema);


