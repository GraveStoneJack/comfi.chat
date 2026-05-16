const mongoose = require('mongoose');

const mailSettingsSchema = new mongoose.Schema({
	enabled: { type: Boolean, default: false },
	provider: { type: String, default: 'custom-smtp', trim: true },
	host: { type: String, trim: true },
	port: { type: Number, min: 1, max: 65535, default: 587 },
	secure: { type: Boolean, default: false },
	username: { type: String, trim: true },
	passwordEncrypted: { type: String, select: false },
	fromAddress: { type: String, trim: true, lowercase: true },
	fromName: { type: String, trim: true, default: 'ComfiChat' },
	replyTo: { type: String, trim: true, lowercase: true },
	updatedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' }
}, {
	timestamps: true
});

module.exports = mongoose.model('MailSettings', mailSettingsSchema);
