const express = require('express');
const Message = require('../models/Message');
const Report = require('../models/Report');
const { requireAdmin } = require('./adminAuth');

const router = express.Router();

router.use(requireAdmin);

// Reports listing
router.get('/reports', async (req, res) => {
	try {
		const reports = await Report.find().sort({ createdAt: -1 }).limit(200).lean();
		res.json(reports);
	} catch (e) {
		console.error('[Admin] list reports', e);
		res.status(500).json({ error: 'Failed to fetch reports' });
	}
});

// Single report
router.get('/reports/:id', async (req, res) => {
	try {
		const r = await Report.findById(req.params.id).lean();
		if (!r) return res.status(404).json({ error: 'Not found' });
		res.json(r);
	} catch (e) {
		res.status(500).json({ error: 'Failed to fetch' });
	}
});

// Messages history between two users
router.get('/messages/history/:userA/:userB', async (req, res) => {
	const { userA, userB } = req.params;
	try {
		const history = await Message.find({
			$or: [
				{ sender: userA, recipient: userB },
				{ sender: userB, recipient: userA }
			]
		}).sort({ timestamp: 1 }).lean();
		res.json(history);
	} catch (e) {
		console.error('[Admin] history error', e);
		res.status(500).json({ error: 'Failed to fetch history' });
	}
});

module.exports = router;


