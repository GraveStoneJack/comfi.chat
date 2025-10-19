const mongoose = require('mongoose');

const pendingUserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true,
        unique: true
    },
    passwordHash: {
        type: String,
        required: true,
        select: false
    },
    token: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    verified: {
        type: Boolean,
        default: false
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true
    }
}, { timestamps: true });

// Auto-expire unverified pending users after 24h
pendingUserSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PendingUser', pendingUserSchema);


