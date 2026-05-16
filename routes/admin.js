const express = require('express');
const Message = require('../models/Message');
const Report = require('../models/Report');
const { requireAdmin } = require('./adminAuth');
const LoginEvent = require('../models/LoginEvent');
const TempUser = require('../models/TempUser');
const User = require('../models/User');
const Media = require('../models/Media');
const ModerationAction = require('../models/ModerationAction');
const ModerationBlock = require('../models/ModerationBlock');
const UserIdentity = require('../models/UserIdentity');
const fs = require('fs');
const path = require('path');

const router = express.Router();

router.use(requireAdmin);

const IMAGE_RE = /^(?:\[image\])|(?:\.(png|jpe?g|gif|webp|avif)(\?.*)?$)/i;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateRange(query) {
	const days = Math.max(1, Math.min(parseInt(query.days || '30', 10) || 30, 365));
	const to = query.to ? new Date(query.to) : new Date();
	const from = query.from ? new Date(query.from) : new Date(to.getTime() - days * DAY_MS);
	return { from, to, days };
}

function escapeRegExp(value) {
	return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isImageMessageText(text) {
	return typeof text === 'string' && (
		text.startsWith('[image]') ||
		/\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(text)
	);
}

function normalizeLimit(value, fallback = 50, max = 250) {
	const limit = parseInt(value || fallback, 10);
	return Math.max(1, Math.min(Number.isFinite(limit) ? limit : fallback, max));
}

function normalizePage(value) {
	const page = parseInt(value || '1', 10);
	return Math.max(1, Number.isFinite(page) ? page : 1);
}

function activeMessageMatch(extra = {}) {
	return { deletedAt: { $exists: false }, ...extra };
}

function buildImageMessageOr() {
	return [
		{ message: { $regex: '^\\[image\\]', $options: 'i' } },
		{ message: { $regex: '\\.(png|jpe?g|gif|webp|avif)(\\?.*)?$', $options: 'i' } }
	];
}

function bucketAge(age) {
	if (!age && age !== 0) return 'Unknown';
	if (age < 18) return '13-17';
	if (age < 25) return '18-24';
	if (age < 35) return '25-34';
	if (age < 45) return '35-44';
	if (age < 55) return '45-54';
	return '55+';
}

function dayKey(date) {
	return new Date(date).toISOString().slice(0, 10);
}

function dateBuckets(from, to) {
	const buckets = [];
	const cursor = new Date(from);
	cursor.setUTCHours(0, 0, 0, 0);
	while (cursor <= to) {
		buckets.push(dayKey(cursor));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return buckets;
}

async function recordAction(req, payload) {
	try {
		await ModerationAction.create({
			...payload,
			actorAdminId: req.admin && req.admin.sub,
			actorRole: req.admin && req.admin.role
		});
	} catch (e) {
		console.error('[Admin] failed to record moderation action', e);
	}
}

async function buildIdentityRows({ search, limit = 100 } = {}) {
	const searchRegex = search ? new RegExp(escapeRegExp(search), 'i') : null;
	const byKey = new Map();
	const ensure = (deviceId, username) => {
		const key = deviceId || `username:${username || 'unknown'}`;
		if (!byKey.has(key)) {
			byKey.set(key, {
				key,
				deviceId: deviceId || null,
				currentUsername: username || 'unknown',
				usernames: [],
				demographics: [],
				firstSeenAt: null,
				lastSeenAt: null,
				lastLoginAt: null,
				lastMessageAt: null,
				messageCount: 0,
				imageCount: 0,
				reportCount: 0,
				blockedByCount: 0,
				blocksMadeCount: 0,
				isOnline: false
			});
		}
		const row = byKey.get(key);
		if (username && !row.usernames.includes(username)) row.usernames.push(username);
		if (username) row.currentUsername = username;
		return row;
	};
	const touchDates = (row, first, last, kind) => {
		if (first && (!row.firstSeenAt || new Date(first) < new Date(row.firstSeenAt))) row.firstSeenAt = first;
		if (last && (!row.lastSeenAt || new Date(last) > new Date(row.lastSeenAt))) row.lastSeenAt = last;
		if (kind === 'login' && last && (!row.lastLoginAt || new Date(last) > new Date(row.lastLoginAt))) row.lastLoginAt = last;
		if (kind === 'message' && last && (!row.lastMessageAt || new Date(last) > new Date(row.lastMessageAt))) row.lastMessageAt = last;
	};

	const [loginRows, senderRows, recipientRows, tempUsers, registeredUsers, reportRows, blockTargetRows, blockSourceRows] = await Promise.all([
		LoginEvent.aggregate([
			{ $group: {
				_id: { deviceId: '$deviceId', username: '$username' },
				firstAt: { $min: '$timestamp' },
				lastAt: { $max: '$timestamp' },
				logins: { $sum: { $cond: [{ $eq: ['$type', 'login'] }, 1, 0] } },
				demographics: { $push: '$metadata' }
			} }
		]),
		Message.aggregate([
			{ $match: activeMessageMatch() },
			{ $group: {
				_id: { deviceId: '$senderDeviceId', username: '$sender' },
				firstAt: { $min: '$timestamp' },
				lastAt: { $max: '$timestamp' },
				messages: { $sum: 1 },
				images: { $sum: { $cond: [{ $or: [
					{ $regexMatch: { input: '$message', regex: '^\\[image\\]', options: 'i' } },
					{ $regexMatch: { input: '$message', regex: '\\.(png|jpe?g|gif|webp|avif)(\\?.*)?$', options: 'i' } }
				] }, 1, 0] } }
			} }
		]),
		Message.aggregate([
			{ $match: activeMessageMatch() },
			{ $group: {
				_id: { deviceId: '$recipientDeviceId', username: '$recipient' },
				firstAt: { $min: '$timestamp' },
				lastAt: { $max: '$timestamp' },
				messages: { $sum: 0 },
				images: { $sum: 0 }
			} }
		]),
		TempUser.find(searchRegex ? { username: searchRegex } : {}).select('username age gender country countryCode deviceId isOnline lastSeen createdAt').lean(),
		User.find(searchRegex ? { username: searchRegex } : {}).select('username age gender country countryCode isOnline lastActive accountCreated').lean(),
		Report.aggregate([{ $group: { _id: '$reportedUser', count: { $sum: 1 } } }]),
		ModerationBlock.aggregate([{ $group: { _id: { username: '$blockedUsername', deviceId: '$blockedDeviceId' }, count: { $sum: 1 } } }]),
		ModerationBlock.aggregate([{ $group: { _id: { username: '$blockerUsername', deviceId: '$blockerDeviceId' }, count: { $sum: 1 } } }])
	]);

	for (const row of loginRows) {
		const identity = ensure(row._id.deviceId, row._id.username);
		touchDates(identity, row.firstAt, row.lastAt, 'login');
		for (const demo of row.demographics || []) {
			if (demo && (demo.age || demo.gender || demo.country)) identity.demographics.push({ ...demo, source: 'login', capturedAt: row.lastAt });
		}
	}
	for (const row of [...senderRows, ...recipientRows]) {
		const identity = ensure(row._id.deviceId, row._id.username);
		identity.messageCount += row.messages || 0;
		identity.imageCount += row.images || 0;
		touchDates(identity, row.firstAt, row.lastAt, 'message');
	}
	for (const user of tempUsers) {
		const identity = ensure(user.deviceId, user.username);
		identity.isOnline = !!user.isOnline;
		touchDates(identity, user.createdAt, user.lastSeen, 'login');
		identity.demographics.push({
			age: user.age,
			gender: user.gender,
			country: user.country,
			countryCode: user.countryCode,
			source: 'profile',
			capturedAt: user.lastSeen || user.createdAt
		});
	}
	for (const user of registeredUsers) {
		const identity = ensure(null, user.username);
		identity.isOnline = !!user.isOnline;
		touchDates(identity, user.accountCreated || user.createdAt, user.lastActive || user.updatedAt, 'login');
		identity.demographics.push({
			age: user.age,
			gender: user.gender,
			country: user.country,
			countryCode: user.countryCode,
			source: 'profile',
			capturedAt: user.lastActive || user.updatedAt
		});
	}
	const reportsByUser = new Map(reportRows.map(r => [r._id, r.count]));
	const blockedByKey = new Map(blockTargetRows.map(r => [`${r._id.username || ''}::${r._id.deviceId || ''}`, r.count]));
	const blocksMadeByKey = new Map(blockSourceRows.map(r => [`${r._id.username || ''}::${r._id.deviceId || ''}`, r.count]));

	let rows = Array.from(byKey.values()).map(row => {
		row.reportCount = row.usernames.reduce((sum, name) => sum + (reportsByUser.get(name) || 0), 0);
		row.blockedByCount = (blockedByKey.get(`${row.currentUsername || ''}::${row.deviceId || ''}`) || 0) +
			row.usernames.reduce((sum, name) => sum + (blockedByKey.get(`${name}::`) || 0), 0);
		row.blocksMadeCount = (blocksMadeByKey.get(`${row.currentUsername || ''}::${row.deviceId || ''}`) || 0) +
			row.usernames.reduce((sum, name) => sum + (blocksMadeByKey.get(`${name}::`) || 0), 0);
		row.demographics = row.demographics.filter(Boolean).slice(-8);
		const latestDemo = row.demographics[row.demographics.length - 1] || {};
		row.age = latestDemo.age || null;
		row.ageBand = bucketAge(latestDemo.age);
		row.gender = latestDemo.gender || 'unknown';
		row.country = latestDemo.country || 'Unknown';
		row.countryCode = latestDemo.countryCode || '';
		return row;
	});
	if (searchRegex) {
		rows = rows.filter(row =>
			searchRegex.test(row.currentUsername || '') ||
			searchRegex.test(row.deviceId || '') ||
			row.usernames.some(name => searchRegex.test(name))
		);
	}
	rows.sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
	return rows.slice(0, limit);
}

router.get('/dashboard/summary', async (req, res) => {
	try {
		const { from, to } = parseDateRange(req.query || {});
		const [messageBuckets, loginBuckets, reportBuckets, mediaBuckets, activeUsers, openReports, mediaSize, frequentBlocks, frequentReports, identities] = await Promise.all([
			Message.aggregate([
				{ $match: activeMessageMatch({ timestamp: { $gte: from, $lte: to } }) },
				{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, messages: { $sum: 1 }, images: { $sum: { $cond: [{ $or: buildImageMessageOr().map(q => ({ $regexMatch: { input: '$message', regex: q.message.$regex, options: q.message.$options } })) }, 1, 0] } }, uniqueSenders: { $addToSet: '$senderDeviceId' } } },
				{ $sort: { _id: 1 } }
			]),
			LoginEvent.aggregate([
				{ $match: { timestamp: { $gte: from, $lte: to } } },
				{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, logins: { $sum: { $cond: [{ $eq: ['$type', 'login'] }, 1, 0] } }, logouts: { $sum: { $cond: [{ $eq: ['$type', 'logout'] }, 1, 0] } }, devices: { $addToSet: '$deviceId' } } },
				{ $sort: { _id: 1 } }
			]),
			Report.aggregate([
				{ $match: { createdAt: { $gte: from, $lte: to } } },
				{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, reports: { $sum: 1 } } },
				{ $sort: { _id: 1 } }
			]),
			Media.aggregate([
				{ $match: { createdAt: { $gte: from, $lte: to }, deletedAt: { $exists: false } } },
				{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, uploads: { $sum: 1 }, bytes: { $sum: '$byteLength' } } },
				{ $sort: { _id: 1 } }
			]),
			TempUser.countDocuments({ isOnline: true }),
			Report.countDocuments({ status: { $in: ['open', 'in_review'] } }),
			Media.aggregate([{ $match: { deletedAt: { $exists: false } } }, { $group: { _id: null, bytes: { $sum: '$byteLength' }, count: { $sum: 1 } } }]),
			ModerationBlock.aggregate([{ $group: { _id: '$blockedUsername', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }]),
			Report.aggregate([{ $group: { _id: '$reportedUser', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }]),
			buildIdentityRows({ limit: 1000 })
		]);
		const byDay = new Map(dateBuckets(from, to).map(day => [day, { day, messages: 0, images: 0, logins: 0, logouts: 0, uniqueDevices: 0, reports: 0, uploads: 0, bytes: 0 }]));
		for (const row of messageBuckets) {
			const day = byDay.get(row._id) || { day: row._id };
			day.messages = row.messages || 0;
			day.images = row.images || 0;
			day.uniqueDevices = (row.uniqueSenders || []).filter(Boolean).length;
			byDay.set(row._id, day);
		}
		for (const row of loginBuckets) {
			const day = byDay.get(row._id) || { day: row._id };
			day.logins = row.logins || 0;
			day.logouts = row.logouts || 0;
			day.uniqueDevices = Math.max(day.uniqueDevices || 0, (row.devices || []).filter(Boolean).length);
			byDay.set(row._id, day);
		}
		for (const row of reportBuckets) {
			const day = byDay.get(row._id) || { day: row._id };
			day.reports = row.reports || 0;
			byDay.set(row._id, day);
		}
		for (const row of mediaBuckets) {
			const day = byDay.get(row._id) || { day: row._id };
			day.uploads = row.uploads || 0;
			day.bytes = row.bytes || 0;
			byDay.set(row._id, day);
		}
		const recurringUsers = identities.filter(i => i.deviceId && i.usernames.length > 1).length;
		const demographics = {
			age: Object.entries(identities.reduce((acc, row) => ((acc[row.ageBand || 'Unknown'] = (acc[row.ageBand || 'Unknown'] || 0) + 1), acc), {})).map(([name, value]) => ({ name, value })),
			gender: Object.entries(identities.reduce((acc, row) => ((acc[row.gender || 'unknown'] = (acc[row.gender || 'unknown'] || 0) + 1), acc), {})).map(([name, value]) => ({ name, value })),
			country: Object.entries(identities.reduce((acc, row) => ((acc[row.country || 'Unknown'] = (acc[row.country || 'Unknown'] || 0) + 1), acc), {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12)
		};
		const totals = Array.from(byDay.values()).reduce((acc, row) => {
			acc.messages += row.messages || 0;
			acc.images += row.images || 0;
			acc.logins += row.logins || 0;
			acc.reports += row.reports || 0;
			acc.uploads += row.uploads || 0;
			return acc;
		}, { messages: 0, images: 0, logins: 0, reports: 0, uploads: 0 });
		res.json({
			range: { from, to },
			kpis: {
				activeUsers,
				openReports,
				recurringUsers,
				uniqueIdentities: identities.length,
				messages: totals.messages,
				images: totals.images,
				logins: totals.logins,
				reports: totals.reports,
				uploads: totals.uploads,
				mediaBytes: (mediaSize[0] && mediaSize[0].bytes) || 0,
				mediaCount: (mediaSize[0] && mediaSize[0].count) || 0
			},
			timeline: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
			demographics,
			needsAttention: {
				frequentBlocks: frequentBlocks.map(r => ({ username: r._id || 'unknown', count: r.count })),
				frequentReports: frequentReports.map(r => ({ username: r._id || 'unknown', count: r.count })),
				highVolumeDevices: identities.filter(i => i.deviceId).sort((a, b) => b.messageCount - a.messageCount).slice(0, 8)
			}
		});
	} catch (e) {
		console.error('[Admin] dashboard summary', e);
		res.status(500).json({ error: 'Failed to load dashboard' });
	}
});

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

router.patch('/reports/:id', async (req, res) => {
	try {
		const { status, adminNotes } = req.body || {};
		const allowed = ['open', 'in_review', 'resolved', 'dismissed'];
		if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
		const update = {};
		if (status) update.status = status;
		if (adminNotes !== undefined) update.adminNotes = String(adminNotes || '');
		update.reviewedByAdminId = req.admin && req.admin.sub;
		update.reviewedAt = new Date();
		const report = await Report.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
		if (!report) return res.status(404).json({ error: 'Not found' });
		await recordAction(req, {
			actionType: 'report_status',
			reportId: report._id,
			targetUser: report.reportedUser,
			relatedUser: report.reportingUser,
			metadata: { status: report.status, adminNotes: report.adminNotes || '' }
		});
		res.json(report);
	} catch (e) {
		console.error('[Admin] update report', e);
		res.status(500).json({ error: 'Failed to update report' });
	}
});

router.get('/identities', async (req, res) => {
	try {
		const rows = await buildIdentityRows({
			search: req.query.search,
			limit: normalizeLimit(req.query.limit, 100, 500)
		});
		res.json(rows);
	} catch (e) {
		console.error('[Admin] identities', e);
		res.status(500).json({ error: 'Failed to load identities' });
	}
});

router.post('/identities/backfill', async (req, res) => {
	try {
		const rows = await buildIdentityRows({ limit: 1000 });
		let upserted = 0;
		for (const row of rows.filter(r => r.deviceId)) {
			await UserIdentity.findOneAndUpdate(
				{ deviceId: row.deviceId },
				{
					deviceId: row.deviceId,
					currentUsername: row.currentUsername,
					names: row.usernames.map(username => ({ username, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, source: 'unknown' })),
					demographics: row.demographics,
					firstSeenAt: row.firstSeenAt,
					lastSeenAt: row.lastSeenAt,
					lastLoginAt: row.lastLoginAt,
					lastMessageAt: row.lastMessageAt,
					messageCount: row.messageCount,
					imageCount: row.imageCount,
					reportCount: row.reportCount,
					blockedByCount: row.blockedByCount,
					blocksMadeCount: row.blocksMadeCount,
					isOnline: row.isOnline
				},
				{ upsert: true, new: true }
			);
			upserted += 1;
		}
		res.json({ ok: true, upserted });
	} catch (e) {
		console.error('[Admin] identity backfill', e);
		res.status(500).json({ error: 'Failed to backfill identities' });
	}
});

router.get('/identities/detail', async (req, res) => {
	try {
		const { username, deviceId } = req.query || {};
		if (!username && !deviceId) return res.status(400).json({ error: 'Missing username or deviceId' });
		const identityRows = await buildIdentityRows({ search: username || deviceId, limit: 50 });
		const identity = identityRows.find(row => (deviceId && row.deviceId === deviceId) || (username && row.usernames.includes(username))) || identityRows[0] || null;
		const names = identity ? identity.usernames : [username].filter(Boolean);
		const [
			loginEvents,
			reportsAgainst,
			reportsMade,
			blocksAgainst,
			blocksMade,
			actions,
			conversations,
			media
		] = await Promise.all([
			LoginEvent.find({
				$or: [
					...(deviceId ? [{ deviceId }] : []),
					...(names.length ? [{ username: { $in: names } }] : [])
				]
			}).sort({ timestamp: -1 }).limit(100).lean(),
			Report.find({ reportedUser: { $in: names } }).sort({ createdAt: -1 }).limit(50).lean(),
			Report.find({ reportingUser: { $in: names } }).sort({ createdAt: -1 }).limit(50).lean(),
			ModerationBlock.find({ $or: [{ blockedUsername: { $in: names } }, ...(deviceId ? [{ blockedDeviceId: deviceId }] : [])] }).sort({ createdAt: -1 }).limit(50).lean(),
			ModerationBlock.find({ $or: [{ blockerUsername: { $in: names } }, ...(deviceId ? [{ blockerDeviceId: deviceId }] : [])] }).sort({ createdAt: -1 }).limit(50).lean(),
			ModerationAction.find({ $or: [{ targetUser: { $in: names } }, ...(deviceId ? [{ targetDeviceId: deviceId }] : [])] }).sort({ createdAt: -1 }).limit(50).lean(),
			username ? getConversationsForUser(username, deviceId) : Promise.resolve([]),
			username ? getImagesForUser(username, deviceId, 60) : Promise.resolve([])
		]);
		res.json({ identity, loginEvents, reportsAgainst, reportsMade, blocksAgainst, blocksMade, actions, conversations, media });
	} catch (e) {
		console.error('[Admin] identity detail', e);
		res.status(500).json({ error: 'Failed to load identity detail' });
	}
});

router.get('/blocks', async (req, res) => {
	try {
		const limit = normalizeLimit(req.query.limit, 100, 500);
		const search = req.query.search ? new RegExp(escapeRegExp(req.query.search), 'i') : null;
		const match = search ? {
			$or: [
				{ blockerUsername: search },
				{ blockedUsername: search },
				{ blockerDeviceId: search },
				{ blockedDeviceId: search }
			]
		} : {};
		const [items, frequentTargets, frequentSources] = await Promise.all([
			ModerationBlock.find(match).sort({ createdAt: -1 }).limit(limit).lean(),
			ModerationBlock.aggregate([{ $group: { _id: { username: '$blockedUsername', deviceId: '$blockedDeviceId' }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 20 }]),
			ModerationBlock.aggregate([{ $group: { _id: { username: '$blockerUsername', deviceId: '$blockerDeviceId' }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 20 }])
		]);
		res.json({ items, frequentTargets, frequentSources });
	} catch (e) {
		console.error('[Admin] blocks', e);
		res.status(500).json({ error: 'Failed to load blocks' });
	}
});

router.post('/blocks', async (req, res) => {
	try {
		const payload = req.body || {};
		if (!payload.blockerUsername || !payload.blockedUsername) return res.status(400).json({ error: 'Missing block users' });
		const block = await ModerationBlock.create({
			blockerUsername: payload.blockerUsername,
			blockerDeviceId: payload.blockerDeviceId,
			blockedUsername: payload.blockedUsername,
			blockedDeviceId: payload.blockedDeviceId,
			source: payload.source || 'admin',
			reason: payload.reason,
			metadata: payload.metadata
		});
		await recordAction(req, {
			actionType: 'block_recorded',
			targetUser: block.blockedUsername,
			targetDeviceId: block.blockedDeviceId,
			relatedUser: block.blockerUsername,
			relatedDeviceId: block.blockerDeviceId,
			metadata: { source: block.source, reason: block.reason }
		});
		res.status(201).json(block);
	} catch (e) {
		console.error('[Admin] create block', e);
		res.status(500).json({ error: 'Failed to create block' });
	}
});

async function getConversationsForUser(username, deviceId) {
	const match = deviceId
		? activeMessageMatch({ $or: [ { sender: username, senderDeviceId: deviceId }, { recipient: username, recipientDeviceId: deviceId } ] })
		: activeMessageMatch({ $or: [ { sender: username }, { recipient: username } ] });
	const convos = await Message.aggregate([
		{ $match: match },
		{ $project: {
			other: { $cond: [ { $eq: ['$sender', username] }, '$recipient', '$sender' ] },
			otherDeviceId: { $cond: [
				{ $eq: ['$sender', username] }, '$recipientDeviceId', '$senderDeviceId'
			] },
			message: 1,
			timestamp: 1,
			hasImage: { $or: [
				{ $regexMatch: { input: '$message', regex: '^\\[image\\]', options: 'i' } },
				{ $regexMatch: { input: '$message', regex: '\\.(png|jpe?g|gif|webp|avif)(\\?.*)?$', options: 'i' } }
			] }
		} },
		{ $sort: { timestamp: 1 } },
		{ $group: {
			_id: { other: '$other', deviceId: '$otherDeviceId' },
			lastAt: { $last: '$timestamp' },
			lastMessage: { $last: '$message' },
			messagesCount: { $sum: 1 },
			imagesCount: { $sum: { $cond: ['$hasImage', 1, 0] } }
		} },
		{ $sort: { lastAt: -1 } }
	]);
	return convos.map(c => ({
		with: c._id.other,
		withDeviceId: c._id.deviceId || null,
		lastAt: c.lastAt,
		lastMessage: c.lastMessage,
		messagesCount: c.messagesCount,
		imagesCount: c.imagesCount
	}));
}

async function getImagesForUser(username, deviceId, limit = 100) {
	const match = activeMessageMatch({
		sender: username,
		$or: buildImageMessageOr()
	});
	if (deviceId) match.senderDeviceId = deviceId;
	const docs = await Message.find(match).sort({ timestamp: -1 }).limit(limit).lean();
	return docs.map(d => ({
		_id: d._id,
		message: d.message,
		timestamp: d.timestamp,
		recipient: d.recipient,
		recipientDeviceId: d.recipientDeviceId || null
	}));
}

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
		const history = await Message.find(activeMessageMatch({ $or: clauses })).sort({ timestamp: 1 }).lean();
		res.json(history);
	} catch (e) {
		console.error('[Admin] history error', e);
		res.status(500).json({ error: 'Failed to fetch history' });
	}
});

router.get('/messages/search', async (req, res) => {
	try {
		const q = String(req.query.q || '').trim();
		const page = normalizePage(req.query.page);
		const limit = normalizeLimit(req.query.limit, 50, 100);
		const from = req.query.from ? new Date(req.query.from) : null;
		const to = req.query.to ? new Date(req.query.to) : null;
		const match = activeMessageMatch();
		if (q) match.message = { $regex: escapeRegExp(q), $options: 'i' };
		if (req.query.user) match.$or = [{ sender: req.query.user }, { recipient: req.query.user }];
		if (req.query.deviceId) {
			const deviceClause = [{ senderDeviceId: req.query.deviceId }, { recipientDeviceId: req.query.deviceId }];
			match.$and = match.$and || [];
			match.$and.push({ $or: deviceClause });
		}
		if (from || to) {
			match.timestamp = {};
			if (from) match.timestamp.$gte = from;
			if (to) match.timestamp.$lte = to;
		}
		if (req.query.mediaOnly === 'true') {
			match.$and = match.$and || [];
			match.$and.push({ $or: buildImageMessageOr() });
		}
		const [items, total] = await Promise.all([
			Message.find(match).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(),
			Message.countDocuments(match)
		]);
		res.json({ items, total, page, limit });
	} catch (e) {
		console.error('[Admin] message search', e);
		res.status(500).json({ error: 'Failed to search messages' });
	}
});

router.get('/messages/conversations', async (req, res) => {
	try {
		const limit = normalizeLimit(req.query.limit, 100, 500);
		const match = activeMessageMatch();
		if (req.query.user) match.$or = [{ sender: req.query.user }, { recipient: req.query.user }];
		const rows = await Message.aggregate([
			{ $match: match },
			{ $project: {
				participantA: { $cond: [{ $lte: ['$sender', '$recipient'] }, '$sender', '$recipient'] },
				participantB: { $cond: [{ $lte: ['$sender', '$recipient'] }, '$recipient', '$sender'] },
				deviceA: { $cond: [{ $lte: ['$sender', '$recipient'] }, '$senderDeviceId', '$recipientDeviceId'] },
				deviceB: { $cond: [{ $lte: ['$sender', '$recipient'] }, '$recipientDeviceId', '$senderDeviceId'] },
				message: 1,
				timestamp: 1,
				hasImage: { $or: [
					{ $regexMatch: { input: '$message', regex: '^\\[image\\]', options: 'i' } },
					{ $regexMatch: { input: '$message', regex: '\\.(png|jpe?g|gif|webp|avif)(\\?.*)?$', options: 'i' } }
				] }
			} },
			{ $sort: { timestamp: 1 } },
			{ $group: {
				_id: { a: '$participantA', b: '$participantB', devA: '$deviceA', devB: '$deviceB' },
				lastAt: { $last: '$timestamp' },
				firstAt: { $first: '$timestamp' },
				lastMessage: { $last: '$message' },
				messagesCount: { $sum: 1 },
				imagesCount: { $sum: { $cond: ['$hasImage', 1, 0] } }
			} },
			{ $sort: { lastAt: -1 } },
			{ $limit: limit }
		]);
		res.json(rows.map(row => ({
			userA: row._id.a,
			userB: row._id.b,
			devA: row._id.devA || null,
			devB: row._id.devB || null,
			firstAt: row.firstAt,
			lastAt: row.lastAt,
			lastMessage: row.lastMessage,
			messagesCount: row.messagesCount,
			imagesCount: row.imagesCount
		})));
	} catch (e) {
		console.error('[Admin] conversations list', e);
		res.status(500).json({ error: 'Failed to load conversations' });
	}
});

router.delete('/messages/:id', async (req, res) => {
	try {
		const message = await Message.findByIdAndUpdate(req.params.id, {
			deletedAt: new Date(),
			deletedByAdminId: req.admin && req.admin.sub,
			deleteReason: req.body && req.body.reason
		}, { new: true }).lean();
		if (!message) return res.status(404).json({ error: 'Not found' });
		await recordAction(req, {
			actionType: 'delete_message',
			messageId: message._id,
			targetUser: message.sender,
			targetDeviceId: message.senderDeviceId,
			relatedUser: message.recipient,
			relatedDeviceId: message.recipientDeviceId,
			metadata: { reason: message.deleteReason }
		});
		res.json({ ok: true, message });
	} catch (e) {
		console.error('[Admin] delete message', e);
		res.status(500).json({ error: 'Failed to delete message' });
	}
});

router.post('/messages/clear', async (req, res) => {
	try {
		const { username, deviceId, otherUsername, otherDeviceId, reason } = req.body || {};
		if (!username && !otherUsername) return res.status(400).json({ error: 'Missing user filter' });
		const clauses = [];
		if (username && otherUsername) {
			const a = { sender: username, recipient: otherUsername };
			const b = { sender: otherUsername, recipient: username };
			if (deviceId) {
				a.senderDeviceId = deviceId;
				b.recipientDeviceId = deviceId;
			}
			if (otherDeviceId) {
				a.recipientDeviceId = otherDeviceId;
				b.senderDeviceId = otherDeviceId;
			}
			clauses.push(a, b);
		} else if (username) {
			clauses.push({ sender: username }, { recipient: username });
		}
		const filter = activeMessageMatch({ $or: clauses });
		const update = {
			deletedAt: new Date(),
			deletedByAdminId: req.admin && req.admin.sub,
			deleteReason: reason || 'admin_clear'
		};
		const result = await Message.updateMany(filter, update);
		await recordAction(req, {
			actionType: otherUsername ? 'delete_conversation' : 'clear_user_history',
			targetUser: username,
			targetDeviceId: deviceId,
			relatedUser: otherUsername,
			relatedDeviceId: otherDeviceId,
			metadata: { reason, deletedCount: result.modifiedCount || 0 }
		});
		res.json({ ok: true, deletedCount: result.modifiedCount || 0 });
	} catch (e) {
		console.error('[Admin] clear messages', e);
		res.status(500).json({ error: 'Failed to clear messages' });
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
		res.json(await getConversationsForUser(username, deviceId));
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
		res.json(await getImagesForUser(username, deviceId, 200));
	} catch (e) {
		console.error('[Admin] user images error', e);
		res.status(500).json({ error: 'Failed to fetch images' });
	}
});

// Admin media resolver with DB fallback
router.get('/media', async (req, res) => {
	try {
		const page = normalizePage(req.query.page);
		const limit = normalizeLimit(req.query.limit, 60, 120);
		const match = { deletedAt: { $exists: false } };
		if (req.query.uploader) match.uploader = new RegExp(escapeRegExp(req.query.uploader), 'i');
		const [items, total] = await Promise.all([
			Media.find(match).select('-bytes').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
			Media.countDocuments(match)
		]);
		res.json({ items, total, page, limit });
	} catch (e) {
		console.error('[Admin] media list error', e);
		res.status(500).json({ error: 'Failed to load media' });
	}
});

router.delete('/media/:id', async (req, res) => {
	try {
		const media = await Media.findByIdAndUpdate(req.params.id, {
			deletedAt: new Date(),
			deletedByAdminId: req.admin && req.admin.sub,
			deleteReason: req.body && req.body.reason
		}, { new: true }).select('-bytes').lean();
		if (!media) return res.status(404).json({ error: 'Not found' });
		await recordAction(req, {
			actionType: 'delete_media',
			mediaId: media._id,
			targetUser: media.uploader,
			metadata: { filename: media.filename, reason: media.deleteReason }
		});
		res.json({ ok: true, media });
	} catch (e) {
		console.error('[Admin] delete media error', e);
		res.status(500).json({ error: 'Failed to delete media' });
	}
});

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
				res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
				res.setHeader('Access-Control-Allow-Origin', '*');
				res.setHeader('Content-Type', contentType);
				res.setHeader('Cache-Control', 'private, max-age=31536000');
				return fs.createReadStream(filePath).pipe(res);
			}
		}
		// DB fallback: find by filename or by originalUrl
		let mediaDoc = null;
		if (filename) {
			mediaDoc = await Media.findOne({ filename, deletedAt: { $exists: false } }).sort({ createdAt: -1 }).lean();
		}
		if (!mediaDoc) {
			mediaDoc = await Media.findOne({ originalUrl: src, deletedAt: { $exists: false } }).sort({ createdAt: -1 }).lean();
		}
		if (!mediaDoc || !mediaDoc.bytes) return res.status(404).send('Not found');
		res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Content-Type', mediaDoc.contentType || 'application/octet-stream');
		res.setHeader('Cache-Control', 'private, max-age=31536000');
		return res.end(mediaDoc.bytes);
	} catch (e) {
		console.error('[Admin] media resolve error', e);
		res.status(500).send('Failed to resolve');
	}
});

module.exports = router;


