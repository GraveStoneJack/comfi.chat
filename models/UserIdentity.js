const mongoose = require('mongoose');

const nameHistorySchema = new mongoose.Schema({
    username: { type: String, required: true, trim: true },
    firstSeenAt: { type: Date },
    lastSeenAt: { type: Date },
    source: { type: String, enum: ['login', 'message', 'profile', 'unknown'], default: 'unknown' }
}, { _id: false });

const demographicSnapshotSchema = new mongoose.Schema({
    age: Number,
    gender: String,
    country: String,
    countryCode: String,
    capturedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ['login', 'profile', 'unknown'], default: 'unknown' }
}, { _id: false });

const userIdentitySchema = new mongoose.Schema({
    deviceId: { type: String, unique: true, sparse: true, index: true },
    registeredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    currentUsername: { type: String, trim: true, index: true },
    names: [nameHistorySchema],
    demographics: [demographicSnapshotSchema],
    firstSeenAt: { type: Date, index: true },
    lastSeenAt: { type: Date, index: true },
    lastLoginAt: { type: Date },
    lastMessageAt: { type: Date },
    messageCount: { type: Number, default: 0 },
    imageCount: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },
    blockedByCount: { type: Number, default: 0 },
    blocksMadeCount: { type: Number, default: 0 },
    isOnline: { type: Boolean, default: false }
}, { timestamps: true });

userIdentitySchema.index({ currentUsername: 1, lastSeenAt: -1 });

module.exports = mongoose.model('UserIdentity', userIdentitySchema);
