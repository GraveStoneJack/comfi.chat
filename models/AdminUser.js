// models/AdminUser.js
const mongoose = require('mongoose');

const adminUserSchema = new mongoose.Schema({
	username: { type: String, required: true, unique: true, trim: true },
	email: { type: String, required: true, unique: true, lowercase: true, trim: true },
	passwordHash: { type: String, required: true, select: false },
	role: { type: String, enum: ['owner', 'admin', 'moderator'], default: 'owner' },
	totpSecret: { type: String, required: true, select: false },
	isActive: { type: Boolean, default: true },
	lastLoginAt: { type: Date },
	createdAt: { type: Date, default: Date.now }
});

adminUserSchema.index({ username: 1 });
adminUserSchema.index({ email: 1 });

module.exports = mongoose.model('AdminUser', adminUserSchema);


