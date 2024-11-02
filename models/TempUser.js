// models/TempUser.js
const mongoose = require('mongoose');

const tempUserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    age: {
        type: Number,
        required: true
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
        default: Date.now,
        expires: 3600 // Document will be automatically deleted after 1 hour
    },
    isOnline: {
        type: Boolean,
        default: true
    }
});

module.exports = mongoose.model('TempUser', tempUserSchema);
