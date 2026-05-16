const mongoose = require('mongoose');

const moderationActionSchema = new mongoose.Schema({
    actionType: {
        type: String,
        enum: ['report_status', 'delete_message', 'clear_user_history', 'delete_conversation', 'delete_media', 'block_recorded'],
        required: true,
        index: true
    },
    actorAdminId: { type: String, index: true },
    actorRole: { type: String },
    targetUser: { type: String, index: true },
    targetDeviceId: { type: String, index: true },
    relatedUser: { type: String, index: true },
    relatedDeviceId: { type: String, index: true },
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', index: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', index: true },
    mediaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', index: true },
    metadata: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: false });

moderationActionSchema.index({ targetUser: 1, createdAt: -1 });
moderationActionSchema.index({ actionType: 1, createdAt: -1 });

module.exports = mongoose.model('ModerationAction', moderationActionSchema);
