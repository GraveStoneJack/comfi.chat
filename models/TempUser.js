// models/TempUser.js
const mongoose = require('mongoose');

const tempUserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    deviceId: {
        type: String,
        index: true
    },
    age: {
        type: Number,
        required: true,
        min: 13,
        max: 100
    },
    gender: {
        type: String,
        required: true,
        enum: ['male', 'female', 'other']
    },
    country: {
        type: String,
        required: true
    },
    countryCode: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    isOnline: {
        type: Boolean,
        default: true
    },
    lastSeen: {
        type: Date,
        default: Date.now
    },
    // Absolute expiry; when set, TTL index removes after this timestamp
    expiresAt: {
        type: Date,
        default: undefined
    }
});

// TTL index for absolute expiry. MongoDB removes docs when `expiresAt` <= now.
tempUserSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('TempUser', tempUserSchema);
