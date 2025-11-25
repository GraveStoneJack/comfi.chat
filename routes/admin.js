const express = require('express');
const Message = require('../models/Message');
const Report = require('../models/Report');
const { requireAdmin } = require('./adminAuth');
const LoginEvent = require('../models/LoginEvent');
const TempUser = require('../models/TempUser');
const User = require('../models/User');

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

// List all people who logged on or appeared in messages, with basic stats
router.get('/users/all', async (_req, res) => {
	try {
		// Aggregate login events
		const eventsAgg = await LoginEvent.aggregate([
			{ $group: { _id: '$username', firstSeen: { $min: '$timestamp' }, lastSeen: { $max: '$timestamp' } } }
		]);

		// Aggregate participation from messages (treat sender and recipient as "username")
		const messageAgg = await Message.aggregate([
			{ $project: { username: ['$sender', '$recipient'], timestamp: 1, message: 1 } },
			{ $unwind: '$username' },
			{ $group: {
				_id: '$username',
				lastMessageAt: { $max: '$timestamp' },
				messagesCount: { $sum: 1 },
				imagesCount: {
					$sum: {
						$cond: [
							{
								$or: [
									{ $regexMatch: { input: '$message', regex: '^\\[image\\]', options: 'i' } },
									{ $regexMatch: { input: '$message', regex: '\\.(png|jpe?g|gif|webp|avif)(\\?.*)?$', options: 'i' } }
								]
							},
							1,
							0
						]
					}
				}
			} }
		]);

		// Current temp users and registered users
		const [tempNow, regUsers] = await Promise.all([
			TempUser.find().select('username age gender country countryCode lastSeen isOnline').lean(),
			User.find().select('username').lean()
		]);
		const registeredUsernames = new Set((regUsers || []).map(u => u.username));
		const tempNowMap = new Map((tempNow || []).map(u => [u.username, u]));

		const byUsername = new Map();
		eventsAgg.forEach(e => {
			byUsername.set(e._id, {
				username: e._id,
				firstSeen: e.firstSeen,
				lastSeen: e.lastSeen,
				userType: registeredUsernames.has(e._id) ? 'registered' : (tempNowMap.has(e._id) ? 'temp' : 'unknown'),
				messagesCount: 0,
				imagesCount: 0
			});
		});
		messageAgg.forEach(m => {
			const curr = byUsername.get(m._id) || {
				username: m._id,
				userType: registeredUsernames.has(m._id) ? 'registered' : (tempNowMap.has(m._id) ? 'temp' : 'unknown')
			};
			curr.messagesCount = (curr.messagesCount || 0) + (m.messagesCount || 0);
			curr.imagesCount = (curr.imagesCount || 0) + (m.imagesCount || 0);
			curr.lastMessageAt = m.lastMessageAt;
			byUsername.set(m._id, curr);
		});

		// Merge in some live temp info for convenience
		for (const [uname, u] of tempNowMap.entries()) {
			const curr = byUsername.get(uname) || { username: uname, userType: 'temp' };
			curr.tempProfile = u;
			byUsername.set(uname, curr);
		}

		const out = Array.from(byUsername.values()).sort((a, b) => {
			const aTs = new Date(a.lastMessageAt || a.lastSeen || a.firstSeen || 0).getTime();
			const bTs = new Date(b.lastMessageAt || b.lastSeen || b.firstSeen || 0).getTime();
			return bTs - aTs;
		});
		res.json(out);
	} catch (e) {
		console.error('[Admin] users/all error', e);
		res.status(500).json({ error: 'Failed to list users' });
	}
});

// List conversations for a given user with last message and counts
router.get('/users/:username/conversations', async (req, res) => {
	const username = req.params.username;
	try {
		const convos = await Message.aggregate([
			{ $match: { $or: [ { sender: username }, { recipient: username } ] } },
			{ $project: {
				other: { $cond: [ { $eq: ['$sender', username] }, '$recipient', '$sender' ] },
				message: 1,
				timestamp: 1
			} },
			{ $sort: { timestamp: 1 } },
			{ $group: {
				_id: '$other',
				lastAt: { $last: '$timestamp' },
				lastMessage: { $last: '$message' },
				messagesCount: { $sum: 1 }
			} },
			{ $sort: { lastAt: -1 } }
		]);
		res.json(convos.map(c => ({ with: c._id, lastAt: c.lastAt, lastMessage: c.lastMessage, messagesCount: c.messagesCount })));
	} catch (e) {
		console.error('[Admin] conversations error', e);
		res.status(500).json({ error: 'Failed to fetch conversations' });
	}
});

// List all images sent by a given user (even if later deleted in chat UI)
router.get('/users/:username/images', async (req, res) => {
	const username = req.params.username;
	try {
		const docs = await Message.find({
			sender: username,
			$or: [
				{ message: { $regex: '^\\[image\\]', $options: 'i' } },
				{ message: { $regex: '\\.(png|jpe?g|gif|webp|avif)(\\?.*)?$', $options: 'i' } }
			]
		}).sort({ timestamp: -1 }).lean();
		res.json(docs.map(d => ({
			message: d.message,
			timestamp: d.timestamp,
			recipient: d.recipient
		})));
	} catch (e) {
		console.error('[Admin] user images error', e);
		res.status(500).json({ error: 'Failed to fetch images' });
	}
});

module.exports = router;


