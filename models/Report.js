// models/Report.js
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
	reportingUser: { type: String, required: true, trim: true, index: true },
	reportedUser: { type: String, required: true, trim: true, index: true },
	reason: { type: String, required: true, trim: true },
	additionalInfo: { type: String, trim: true },
	status: { type: String, enum: ['open', 'in_review', 'resolved', 'dismissed'], default: 'open', index: true },
    adminNotes: { type: String, trim: true },
    reviewedByAdminId: { type: String, index: true },
    reviewedAt: { type: Date },
	createdAt: { type: Date, default: Date.now, index: true },
	updatedAt: { type: Date, default: Date.now }
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

reportSchema.index({ reportingUser: 1, createdAt: -1 });
reportSchema.index({ reportedUser: 1, createdAt: -1 });
reportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);


