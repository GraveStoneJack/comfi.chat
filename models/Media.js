// models/Media.js
const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
	filename: { type: String, index: true },
	originalUrl: { type: String, index: true },
	uploader: { type: String, index: true },
	bytes: { type: Buffer, required: true },
	byteLength: { type: Number, index: true },
	contentType: { type: String, default: 'image/jpeg' },
	createdAt: { type: Date, default: Date.now, index: true },
	deletedAt: { type: Date, index: true },
	deletedByAdminId: { type: String, index: true },
	deleteReason: { type: String, trim: true }
});

mediaSchema.index({ filename: 1, createdAt: -1 });
mediaSchema.index({ uploader: 1, createdAt: -1 });
mediaSchema.index({ deletedAt: 1, createdAt: -1 });

module.exports = mongoose.model('Media', mediaSchema);


