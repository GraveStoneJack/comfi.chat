const mongoose = require('mongoose');

const moderationBlockSchema = new mongoose.Schema({
    blockerUsername: { type: String, required: true, trim: true, index: true },
    blockerDeviceId: { type: String, index: true },
    blockedUsername: { type: String, required: true, trim: true, index: true },
    blockedDeviceId: { type: String, index: true },
    source: {
        type: String,
        enum: ['block_button', 'report_and_block', 'admin', 'unknown'],
        default: 'unknown',
        index: true
    },
    reason: { type: String, trim: true },
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', index: true },
    metadata: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: false });

moderationBlockSchema.index({ blockedUsername: 1, createdAt: -1 });
moderationBlockSchema.index({ blockedDeviceId: 1, createdAt: -1 });
moderationBlockSchema.index({ blockerUsername: 1, blockedUsername: 1, createdAt: -1 });

module.exports = mongoose.model('ModerationBlock', moderationBlockSchema);
