const express = require('express');
const Message = require('../models/Message');
const Report = require('../models/Report');
const { requireAdmin } = require('./adminAuth');
const LoginEvent = require('../models/LoginEvent');
const TempUser = require('../models/TempUser');
const User = require('../models/User');
const Media = require('../models/Media');
const fs = require('fs');
const path = require('path');

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

// Messages history between two identities (optionally scoped by deviceId)
router.get('/messages/history/:userA/:userB', async (req, res) => {
	const { userA, userB } = req.params;
	const { devA, devB } = req.query || {};
	try {
		const clauses = [];
		const clause1 = { sender: userA, recipient: userB };
		const clause2 = { sender: userB, recipient: userA };
		if (devA) clause1.senderDeviceId = devA;
		if (devB) clause1.recipientDeviceId = devB;
		if (devB) clause2.senderDeviceId = devB;
		if (devA) clause2.recipientDeviceId = devA;
		clauses.push(clause1, clause2);
		const history = await Message.find({ $or: clauses }).sort({ timestamp: 1 }).lean();
		res.json(history);
	} catch (e) {
		console.error('[Admin] history error', e);
		res.status(500).json({ error: 'Failed to fetch history' });
	}
});

// List unique identities that have messages (empty when no chats yet)
router.get('/users/all', async (_req, res) => {
	try {
		// Aggregate senders by username+device
		const senders = await Message.aggregate([
			{ $group: {
				_id: { username: '$sender', deviceId: '$senderDeviceId' },
				firstAt: { $min: '$timestamp' },
				lastAt: { $max: '$timestamp' },
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
							1, 0
						]
					}
				}
			} }
		]);
		// Aggregate recipients by username+device
		const recipients = await Message.aggregate([
			{ $group: {
				_id: { username: '$recipient', deviceId: '$recipientDeviceId' },
				firstAt: { $min: '$timestamp' },
				lastAt: { $max: '$timestamp' },
				messagesCount: { $sum: 1 },
				imagesCount: { $sum: 0 }
			} }
		]);

		const byKey = new Map();
		function merge(list) {
			for (const r of list) {
				const key = `${r._id.username}::${r._id.deviceId || 'unknown'}`;
				const curr = byKey.get(key) || {
					username: r._id.username,
					deviceId: r._id.deviceId || null,
					firstAt: r.firstAt,
					lastAt: r.lastAt,
					messagesCount: 0,
					imagesCount: 0
				};
				curr.firstAt = curr.firstAt && curr.firstAt < r.firstAt ? curr.firstAt : r.firstAt;
				curr.lastAt = curr.lastAt && curr.lastAt > r.lastAt ? curr.lastAt : r.lastAt;
				curr.messagesCount += r.messagesCount || 0;
				curr.imagesCount += r.imagesCount || 0;
				byKey.set(key, curr);
			}
		}
		merge(senders);
		merge(recipients);

		// Enrich with some live temp info if available
		const usernames = Array.from(new Set(Array.from(byKey.values()).map(v => v.username)));
		const tempNow = await TempUser.find({ username: { $in: usernames } })
			.select('username age gender country countryCode deviceId isOnline lastSeen').lean();
		const tempByUname = new Map(tempNow.map(u => [u.username, u]));

		const out = Array.from(byKey.values()).map(v => {
			const live = tempByUname.get(v.username);
			if (live) v.tempProfile = live;
			return v;
		}).sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));

		res.json(out);
	} catch (e) {
		console.error('[Admin] users/all error', e);
		res.status(500).json({ error: 'Failed to list users' });
	}
});

// List conversations for a given user with last message and counts
router.get('/users/:username/conversations', async (req, res) => {
	const username = req.params.username;
	const { deviceId } = req.query || {};
	try {
		const match = deviceId
			? { $or: [ { sender: username, senderDeviceId: deviceId }, { recipient: username, recipientDeviceId: deviceId } ] }
			: { $or: [ { sender: username }, { recipient: username } ] };
		const convos = await Message.aggregate([
			{ $match: match },
			{ $project: {
				other: { $cond: [ { $eq: ['$sender', username] }, '$recipient', '$sender' ] },
				otherDeviceId: { $cond: [
					{ $eq: ['$sender', username] }, '$recipientDeviceId', '$senderDeviceId'
				] },
				message: 1,
				timestamp: 1
			} },
			{ $sort: { timestamp: 1 } },
			{ $group: {
				_id: { other: '$other', deviceId: '$otherDeviceId' },
				lastAt: { $last: '$timestamp' },
				lastMessage: { $last: '$message' },
				messagesCount: { $sum: 1 }
			} },
			{ $sort: { lastAt: -1 } }
		]);
		res.json(convos.map(c => ({
			with: c._id.other,
			withDeviceId: c._id.deviceId || null,
			lastAt: c.lastAt,
			lastMessage: c.lastMessage,
			messagesCount: c.messagesCount
		})));
	} catch (e) {
		console.error('[Admin] conversations error', e);
		res.status(500).json({ error: 'Failed to fetch conversations' });
	}
});

// List all images sent by a given user (even if later deleted in chat UI)
router.get('/users/:username/images', async (req, res) => {
	const username = req.params.username;
	const { deviceId } = req.query || {};
	try {
		const match = {
			sender: username,
			$or: [
				{ message: { $regex: '^\\[image\\]', $options: 'i' } },
				{ message: { $regex: '\\.(png|jpe?g|gif|webp|avif)(\\?.*)?$', $options: 'i' } }
			]
		};
		if (deviceId) match.senderDeviceId = deviceId;
		const docs = await Message.find(match).sort({ timestamp: -1 }).lean();
		res.json(docs.map(d => ({
			message: d.message,
			timestamp: d.timestamp,
			recipient: d.recipient,
			recipientDeviceId: d.recipientDeviceId || null
		})));
	} catch (e) {
		console.error('[Admin] user images error', e);
		res.status(500).json({ error: 'Failed to fetch images' });
	}
});

// Admin media resolver with DB fallback
router.get('/media/resolve', async (req, res) => {
	try {
		const src = (req.query && req.query.src) ? String(req.query.src) : '';
		if (!src) return res.status(400).send('Missing src');
		// Normalize to filename under /uploads
		const match = /\/uploads\/([^?#]+)/.exec(src);
		const filename = match ? match[1] : null;
		const uploadsDir = path.join(__dirname, '..', 'uploads');
		if (filename) {
			const filePath = path.join(uploadsDir, filename);
			if (fs.existsSync(filePath)) {
				const ext = path.extname(filename).toLowerCase();
				const contentType = {
					'.jpg': 'image/jpeg',
					'.jpeg': 'image/jpeg',
					'.png': 'image/png',
					'.gif': 'image/gif',
					'.webp': 'image/webp',
					'.avif': 'image/avif'
				}[ext] || 'application/octet-stream';
				res.setHeader('Content-Type', contentType);
				res.setHeader('Cache-Control', 'private, max-age=31536000');
				return fs.createReadStream(filePath).pipe(res);
			}
		}
		// DB fallback: find by filename or by originalUrl
		let mediaDoc = null;
		if (filename) {
			mediaDoc = await Media.findOne({ filename }).sort({ createdAt: -1 }).lean();
		}
		if (!mediaDoc) {
			mediaDoc = await Media.findOne({ originalUrl: src }).sort({ createdAt: -1 }).lean();
		}
		if (!mediaDoc || !mediaDoc.bytes) return res.status(404).send('Not found');
		res.setHeader('Content-Type', mediaDoc.contentType || 'application/octet-stream');
		res.setHeader('Cache-Control', 'private, max-age=31536000');
		return res.end(mediaDoc.bytes);
	} catch (e) {
		console.error('[Admin] media resolve error', e);
		res.status(500).send('Failed to resolve');
	}
});

module.exports = router;


