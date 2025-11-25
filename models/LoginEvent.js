// models/LoginEvent.js
const mongoose = require('mongoose');

const loginEventSchema = new mongoose.Schema({
	username: { type: String, required: true, index: true, trim: true },
	deviceId: { type: String, index: true },
	type: { type: String, enum: ['login', 'logout'], required: true, index: true },
	userType: { type: String, enum: ['temp', 'registered', 'unknown'], default: 'unknown', index: true },
	metadata: { type: mongoose.Schema.Types.Mixed },
	timestamp: { type: Date, default: Date.now, index: true }
}, { timestamps: false });

loginEventSchema.index({ username: 1, timestamp: -1 });

module.exports = mongoose.model('LoginEvent', loginEventSchema);


