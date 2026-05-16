const express = require('express');
const rateLimit = require('express-rate-limit');
const Report = require('../models/Report');
const ModerationBlock = require('../models/ModerationBlock');

const router = express.Router();

const CREATE_LIMITER = rateLimit({
	windowMs: 10 * 60 * 1000,
	max: 30
});

router.post('/create', CREATE_LIMITER, async (req, res) => {
	try {
		const { reportingUser, reportedUser, reason, additionalInfo, reportingDeviceId, reportedDeviceId, alsoBlock } = req.body || {};
		if (!reportingUser || !reportedUser || !reason) {
			return res.status(400).json({ error: 'Missing fields' });
		}
		const report = await Report.create({
			reportingUser, reportedUser, reason, additionalInfo
		});
		if (alsoBlock) {
			await ModerationBlock.create({
				blockerUsername: reportingUser,
				blockerDeviceId: reportingDeviceId,
				blockedUsername: reportedUser,
				blockedDeviceId: reportedDeviceId,
				source: 'report_and_block',
				reason,
				reportId: report._id
			});
		}
		return res.status(201).json({ id: report._id.toString() });
	} catch (e) {
		console.error('[Reports] create error', e);
		res.status(500).json({ error: 'Failed to create report' });
	}
});

router.post('/block', CREATE_LIMITER, async (req, res) => {
	try {
		const { blockerUsername, blockerDeviceId, blockedUsername, blockedDeviceId, source, reason } = req.body || {};
		if (!blockerUsername || !blockedUsername) {
			return res.status(400).json({ error: 'Missing block users' });
		}
		const block = await ModerationBlock.create({
			blockerUsername,
			blockerDeviceId,
			blockedUsername,
			blockedDeviceId,
			source: source || 'block_button',
			reason
		});
		return res.status(201).json({ id: block._id.toString() });
	} catch (e) {
		console.error('[Reports] block create error', e);
		res.status(500).json({ error: 'Failed to record block' });
	}
});

module.exports = router;


