const express = require('express');
const rateLimit = require('express-rate-limit');
const Report = require('../models/Report');

const router = express.Router();

const CREATE_LIMITER = rateLimit({
	windowMs: 10 * 60 * 1000,
	max: 30
});

router.post('/create', CREATE_LIMITER, async (req, res) => {
	try {
		const { reportingUser, reportedUser, reason, additionalInfo } = req.body || {};
		if (!reportingUser || !reportedUser || !reason) {
			return res.status(400).json({ error: 'Missing fields' });
		}
		const report = await Report.create({
			reportingUser, reportedUser, reason, additionalInfo
		});
		return res.status(201).json({ id: report._id.toString() });
	} catch (e) {
		console.error('[Reports] create error', e);
		res.status(500).json({ error: 'Failed to create report' });
	}
});

module.exports = router;


