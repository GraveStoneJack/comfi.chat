const express = require('express');
const Message = require('../models/Message');
const Report = require('../models/Report');
const { requireAdmin } = require('./adminAuth');
const LoginEvent = require('../models/LoginEvent');
const TempUser = require('../models/TempUser');
const User = require('../models/User');
const PendingUser = require('../models/PendingUser');
const Media = require('../models/Media');
const ModerationAction = require('../models/ModerationAction');
const ModerationBlock = require('../models/ModerationBlock');
const UserIdentity = require('../models/UserIdentity');
const { getSettings: getMailSettings, sanitize: sanitizeMailSettings, saveSettings: saveMailSettings, sendMail } = require('../lib/mailSettings');
const fs = require('fs');
const path = require('path');

const router = express.Router();

router.use(requireAdmin);
router.use((req, res, next) => {
	if (req.admin && req.admin.role === 'viewer' && req.method !== 'GET') {
		return res.status(403).json({ error: 'Viewer accounts are read-only' });
	}
	next();
});

const IMAGE_RE = /^(?:\[image\])|(?:\.(png|jpe?g|gif|webp|avif)(\?.*)?$)/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const HIGH_RISK_MESSAGE_RE = /(child\s*(?:exploitation|abuse|porn|sexual)|csam|minor\s*(?:sex|sexual|nude|nudes)|underage\s*(?:sex|sexual|nude|nudes)|rape|kill\s+yourself|suicide|self[-\s]?harm|bomb|terror|blackmail|extort|doxx|stalking|traffick|hate\s*speech)/i;

function parseDateRange(query) {
	const days = Math.max(1, Math.min(parseInt(query.days || '30', 10) || 30, 365));
	const to = query.to ? new Date(query.to) : new Date();
	if (query.to) to.setHours(23, 59, 59, 999);
	const from = query.from ? new Date(query.from) : new Date(to.getTime() - days * DAY_MS);
	if (query.from) from.setHours(0, 0, 0, 0);
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

function riskForIdentity(row) {
	const contentPoints = Math.min((row.contentFlagCount || 0) * 30, 60);
	const reportPoints = Math.min((row.reportCount || 0) * 20, 45);
	const blockedPoints = Math.min((row.blockedByCount || 0) * 15, 30);
	const aliasPoints = row.deviceId ? Math.min(Math.max((row.usernames || []).length - 2, 0) * 8, 16) : 0;
	const volumePoints = Math.min(Math.floor((row.messageCount || 0) / 100) * 4, 12);
	const score = Math.min(100, contentPoints + reportPoints + blockedPoints + aliasPoints + volumePoints);
	const level = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
	return { score, level, signals: { content: row.contentFlagCount || 0, reports: row.reportCount || 0, blocks: row.blockedByCount || 0 } };
}

function mediaBuffer(bytes) {
	if (!bytes) return null;
	if (Buffer.isBuffer(bytes)) return bytes;
	if (bytes.buffer && Buffer.isBuffer(bytes.buffer)) return bytes.buffer;
	if (bytes.buffer) return Buffer.from(bytes.buffer);
	if (Array.isArray(bytes.data)) return Buffer.from(bytes.data);
	return Buffer.from(bytes);
}

function evidenceFilename(prefix, parts) {
	const safe = parts.filter(Boolean).join('_').replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 80);
	return `${prefix}-${safe || 'bundle'}-${Date.now()}.json`;
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
				contentFlagCount: 0,
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
				] }, 1, 0] } },
				contentFlags: { $sum: { $cond: [{ $regexMatch: { input: '$message', regex: HIGH_RISK_MESSAGE_RE } }, 1, 0] } }
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
		identity.contentFlagCount += row.contentFlags || 0;
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
		row.risk = riskForIdentity(row);
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
		const liveSince = new Date(Date.now() - 15 * 60 * 1000);
		const previousSince = new Date(Date.now() - 30 * 60 * 1000);
		const [messageBuckets, loginBuckets, reportBuckets, mediaBuckets, activeUsers, openReports, mediaSize, frequentBlocks, frequentReports, identities, liveMessages, previousLiveMessages, activeConversations] = await Promise.all([
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
			buildIdentityRows({ limit: 1000 }),
			Message.countDocuments(activeMessageMatch({ timestamp: { $gte: liveSince } })),
			Message.countDocuments(activeMessageMatch({ timestamp: { $gte: previousSince, $lt: liveSince } })),
			Message.aggregate([
				{ $match: activeMessageMatch({ timestamp: { $gte: liveSince } }) },
				{ $project: {
					a: { $cond: [{ $lte: ['$sender', '$recipient'] }, '$sender', '$recipient'] },
					b: { $cond: [{ $lte: ['$sender', '$recipient'] }, '$recipient', '$sender'] }
				} },
				{ $group: { _id: { a: '$a', b: '$b' }, messages: { $sum: 1 } } },
				{ $sort: { messages: -1 } },
				{ $limit: 8 }
			])
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
		const deviceRows = identities
			.filter(i => i.deviceId)
			.map(i => ({
				deviceId: i.deviceId,
				currentUsername: i.currentUsername,
				usernames: i.usernames || [],
				namesCount: (i.usernames || []).length,
				usernamesCount: (i.usernames || []).length,
				messageCount: i.messageCount || 0,
				imageCount: i.imageCount || 0,
				reportCount: i.reportCount || 0,
				blockedByCount: i.blockedByCount || 0,
				blocksMadeCount: i.blocksMadeCount || 0,
				lastSeenAt: i.lastSeenAt,
				lastMessageAt: i.lastMessageAt,
				lastLoginAt: i.lastLoginAt,
				country: i.country,
				gender: i.gender,
				ageBand: i.ageBand
			}));
		const known = {
			age: identities.filter(row => row.ageBand && row.ageBand !== 'Unknown'),
			gender: identities.filter(row => row.gender && row.gender !== 'unknown'),
			country: identities.filter(row => row.country && row.country !== 'Unknown')
		};
		const demographics = {
			age: Object.entries(known.age.reduce((acc, row) => ((acc[row.ageBand] = (acc[row.ageBand] || 0) + 1), acc), {})).map(([name, value]) => ({ name, value })),
			gender: Object.entries(known.gender.reduce((acc, row) => ((acc[row.gender] = (acc[row.gender] || 0) + 1), acc), {})).map(([name, value]) => ({ name, value })),
			country: Object.entries(known.country.reduce((acc, row) => ((acc[row.country] = (acc[row.country] || 0) + 1), acc), {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12),
			unknownCounts: {
				age: identities.length - known.age.length,
				gender: identities.length - known.gender.length,
				country: identities.length - known.country.length
			}
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
				recurringDevices: deviceRows.filter(i => i.namesCount > 1).sort((a, b) => b.namesCount - a.namesCount || new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0)).slice(0, 8),
				highVolumeDevices: deviceRows.filter(i => i.messageCount > 0).sort((a, b) => b.messageCount - a.messageCount).slice(0, 8),
				recentDevices: deviceRows.sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0)).slice(0, 8)
			},
			risk: {
				highest: identities.filter(i => i.risk).sort((a, b) => b.risk.score - a.risk.score).slice(0, 8),
				criticalCount: identities.filter(i => i.risk && i.risk.level === 'critical').length,
				highCount: identities.filter(i => i.risk && i.risk.level === 'high').length
			},
			liveNow: {
				activeUsers,
				messagesLast15m: liveMessages,
				previous15mMessages: previousLiveMessages,
				spikePercent: previousLiveMessages ? Math.round(((liveMessages - previousLiveMessages) / previousLiveMessages) * 100) : (liveMessages ? 100 : 0),
				activeConversations: activeConversations.map(c => ({ userA: c._id.a, userB: c._id.b, messages: c.messages }))
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
		const { status, adminNotes, severity, assignedAdminId, followUpAt } = req.body || {};
		const allowed = ['open', 'in_review', 'resolved', 'dismissed'];
		if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
		if (severity && !['low', 'medium', 'high', 'critical'].includes(severity)) return res.status(400).json({ error: 'Invalid severity' });
		const update = {};
		if (status) update.status = status;
		if (severity) update.severity = severity;
		if (assignedAdminId !== undefined) update.assignedAdminId = String(assignedAdminId || '');
		if (followUpAt !== undefined) update.followUpAt = followUpAt ? new Date(followUpAt) : null;
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
			metadata: { status: report.status, severity: report.severity, assignedAdminId: report.assignedAdminId, followUpAt: report.followUpAt, adminNotes: report.adminNotes || '' }
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
					contentFlagCount: row.contentFlagCount,
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
		const timeline = [
			...loginEvents.map(e => ({ type: `login_${e.type}`, at: e.timestamp, title: `${e.type} as ${e.username}`, metadata: { deviceId: e.deviceId, userType: e.userType } })),
			...reportsAgainst.map(r => ({ type: 'reported', at: r.createdAt, title: `${r.reportedUser} reported by ${r.reportingUser}`, metadata: { reason: r.reason, status: r.status, severity: r.severity } })),
			...reportsMade.map(r => ({ type: 'reported_other', at: r.createdAt, title: `${r.reportingUser} reported ${r.reportedUser}`, metadata: { reason: r.reason, status: r.status } })),
			...blocksAgainst.map(b => ({ type: 'blocked_by_other', at: b.createdAt, title: `${b.blockedUsername} blocked by ${b.blockerUsername}`, metadata: { source: b.source, reason: b.reason } })),
			...blocksMade.map(b => ({ type: 'blocked_other', at: b.createdAt, title: `${b.blockerUsername} blocked ${b.blockedUsername}`, metadata: { source: b.source, reason: b.reason } })),
			...actions.map(a => ({ type: 'admin_action', at: a.createdAt, title: a.actionType, metadata: a.metadata }))
		].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 120);
		res.json({ identity, loginEvents, reportsAgainst, reportsMade, blocksAgainst, blocksMade, actions, conversations, media, timeline });
	} catch (e) {
		console.error('[Admin] identity detail', e);
		res.status(500).json({ error: 'Failed to load identity detail' });
	}
});

router.get('/cases', async (req, res) => {
	try {
		const status = req.query.status;
		const match = status && status !== 'all' ? { status } : {};
		const reports = await Report.find(match).sort({ followUpAt: 1, createdAt: -1 }).limit(normalizeLimit(req.query.limit, 200, 500)).lean();
		res.json(reports);
	} catch (e) {
		console.error('[Admin] cases', e);
		res.status(500).json({ error: 'Failed to load cases' });
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

router.get('/registered-users', async (req, res) => {
	try {
		const limit = normalizeLimit(req.query.limit, 100, 500);
		const page = normalizePage(req.query.page);
		const search = String(req.query.search || '').trim();
		const status = String(req.query.status || 'all');
		const query = {};
		if (search) {
			const regex = new RegExp(escapeRegExp(search), 'i');
			query.$or = [{ username: regex }, { email: regex }, { displayName: regex }];
		}
		if (status === 'online') query.isOnline = true;
		if (status === 'offline') query.isOnline = { $ne: true };

		const [total, registeredTotal, onlineTotal, rows] = await Promise.all([
			User.countDocuments(query),
			User.countDocuments({}),
			User.countDocuments({ isOnline: true }),
			User.find(query)
				.select('username email displayName age gender sexuality lookingFor profilePicture hairType hairColor eyeColor ethnicity hobbies isOnline lastActive accountCreated createdAt updatedAt')
				.sort({ accountCreated: -1, createdAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.lean()
		]);

		const usernames = rows.map(user => user.username);
		const [messageRows, reportRows, blockRows] = await Promise.all([
			Message.aggregate([
				{ $match: activeMessageMatch({ $or: [{ sender: { $in: usernames } }, { recipient: { $in: usernames } }] }) },
				{ $project: {
					username: { $cond: [{ $in: ['$sender', usernames] }, '$sender', '$recipient'] },
					isSender: { $in: ['$sender', usernames] },
					hasImage: { $or: [
						{ $regexMatch: { input: '$message', regex: '^\\[image\\]', options: 'i' } },
						{ $regexMatch: { input: '$message', regex: '\\.(png|jpe?g|gif|webp|avif)(\\?.*)?$', options: 'i' } }
					] },
					timestamp: 1
				} },
				{ $group: {
					_id: '$username',
					messagesCount: { $sum: 1 },
					imagesCount: { $sum: { $cond: [{ $and: ['$isSender', '$hasImage'] }, 1, 0] } },
					lastMessageAt: { $max: '$timestamp' }
				} }
			]),
			Report.aggregate([
				{ $match: { reportedUser: { $in: usernames } } },
				{ $group: { _id: '$reportedUser', reportsCount: { $sum: 1 } } }
			]),
			ModerationBlock.aggregate([
				{ $match: { blockedUsername: { $in: usernames } } },
				{ $group: { _id: '$blockedUsername', blockedByCount: { $sum: 1 } } }
			])
		]);

		const messagesByUser = new Map(messageRows.map(row => [row._id, row]));
		const reportsByUser = new Map(reportRows.map(row => [row._id, row.reportsCount]));
		const blocksByUser = new Map(blockRows.map(row => [row._id, row.blockedByCount]));

		res.json({
			rows: rows.map(user => {
				const metrics = messagesByUser.get(user.username) || {};
				return {
					...user,
					messagesCount: metrics.messagesCount || 0,
					imagesCount: metrics.imagesCount || 0,
					lastMessageAt: metrics.lastMessageAt || null,
					reportsCount: reportsByUser.get(user.username) || 0,
					blockedByCount: blocksByUser.get(user.username) || 0
				};
			}),
			pagination: { page, limit, total },
			kpis: { registeredTotal, onlineTotal }
		});
	} catch (e) {
		console.error('[Admin] registered users error', e);
		res.status(500).json({ error: 'Failed to list registered users' });
	}
});

router.get('/registered-users/:id', async (req, res) => {
	try {
		const user = await User.findById(req.params.id)
			.select('username email displayName age gender sexuality lookingFor profilePicture hairType hairColor eyeColor ethnicity hobbies isOnline lastActive accountCreated createdAt updatedAt')
			.lean();
		if (!user) return res.status(404).json({ error: 'Registered user not found' });
		const [conversations, images, reportsAgainst, blocksAgainst] = await Promise.all([
			getConversationsForUser(user.username, null),
			getImagesForUser(user.username, null, 80),
			Report.find({ reportedUser: user.username }).sort({ createdAt: -1 }).limit(25).lean(),
			ModerationBlock.find({ blockedUsername: user.username }).sort({ createdAt: -1 }).limit(25).lean()
		]);
		res.json({ user, conversations, images, reportsAgainst, blocksAgainst });
	} catch (e) {
		console.error('[Admin] registered user detail error', e);
		res.status(500).json({ error: 'Failed to load registered user' });
	}
});

router.patch('/registered-users/:id', async (req, res) => {
	try {
		const allowed = ['displayName', 'age', 'gender', 'sexuality', 'lookingFor', 'profilePicture', 'hairType', 'hairColor', 'eyeColor', 'ethnicity', 'hobbies'];
		const update = {};
		for (const key of allowed) {
			if (key in req.body) update[key] = req.body[key];
		}
		if (typeof update.displayName === 'string') update.displayName = update.displayName.trim();
		if (typeof update.sexuality === 'string') update.sexuality = update.sexuality.trim();
		if (typeof update.hobbies === 'string') update.hobbies = update.hobbies.split(',').map(s => s.trim()).filter(Boolean);
		if (typeof update.lookingFor === 'string') update.lookingFor = update.lookingFor.split(',').map(s => s.trim()).filter(Boolean);
		if (Array.isArray(update.hobbies)) update.hobbies = update.hobbies.map(s => String(s).trim()).filter(Boolean);
		if (Array.isArray(update.lookingFor)) update.lookingFor = update.lookingFor.map(s => String(s).trim()).filter(Boolean);
		if (!update.displayName || !update.age || !update.gender || !update.sexuality) {
			return res.status(400).json({ error: 'displayName, age, gender, and sexuality are required' });
		}
		const saved = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
			.select('username email displayName age gender sexuality lookingFor profilePicture hairType hairColor eyeColor ethnicity hobbies isOnline lastActive accountCreated createdAt updatedAt')
			.lean();
		if (!saved) return res.status(404).json({ error: 'Registered user not found' });
		await recordAction(req, {
			actionType: 'update_registered_user',
			targetUser: saved.username,
			metadata: { fields: Object.keys(update) }
		});
		res.json(saved);
	} catch (e) {
		console.error('[Admin] registered user update error', e);
		res.status(500).json({ error: 'Failed to update registered user' });
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

router.get('/storage/cleanup', async (req, res) => {
	try {
		const limit = normalizeLimit(req.query.limit, 80, 200);
		const olderThanDays = Math.max(1, Math.min(parseInt(req.query.olderThanDays || '30', 10) || 30, 3650));
		const minBytes = Math.max(0, parseInt(req.query.minBytes || '0', 10) || 0);
		const olderThan = new Date(Date.now() - olderThanDays * DAY_MS);
		const match = { deletedAt: { $exists: false }, $or: [{ createdAt: { $lte: olderThan } }, { byteLength: { $gte: minBytes } }] };
		const [items, totals] = await Promise.all([
			Media.find(match).select('-bytes').sort({ byteLength: -1, createdAt: 1 }).limit(limit).lean(),
			Media.aggregate([{ $match: { deletedAt: { $exists: false } } }, { $group: { _id: null, bytes: { $sum: '$byteLength' }, count: { $sum: 1 } } }])
		]);
		res.json({ items, summary: totals[0] || { bytes: 0, count: 0 }, filters: { olderThanDays, minBytes } });
	} catch (e) {
		console.error('[Admin] storage cleanup', e);
		res.status(500).json({ error: 'Failed to load cleanup candidates' });
	}
});

router.get('/settings/summary', async (_req, res) => {
	try {
		const [
			messages,
			reports,
			loginEvents,
			tempUsers,
			registeredUsers,
			pendingUsers,
			media,
			blocks,
			actions,
			identities,
			mailSettings
		] = await Promise.all([
			Message.countDocuments(),
			Report.countDocuments(),
			LoginEvent.countDocuments(),
			TempUser.countDocuments(),
			User.countDocuments(),
			PendingUser.countDocuments(),
			Media.aggregate([{ $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$byteLength' } } }]),
			ModerationBlock.countDocuments(),
			ModerationAction.countDocuments(),
			UserIdentity.countDocuments(),
			getMailSettings({ includePassword: true })
		]);
		res.json({
			counts: {
				messages,
				reports,
				loginEvents,
				tempUsers,
				registeredUsers,
				pendingUsers,
				media: (media[0] && media[0].count) || 0,
				mediaBytes: (media[0] && media[0].bytes) || 0,
				blocks,
				actions,
				identities
			},
			recommendations: [
				{ title: 'Review reports daily', description: 'Open and in-review reports should be triaged before they age out of context.' },
				{ title: 'Export evidence before deletion', description: 'Export report or conversation evidence before clearing chats or media.' },
				{ title: 'Use storage cleanup weekly', description: 'Review large or old images, then delete only after moderation review.' },
				{ title: 'Use no-reply@comfi.chat for verification', description: 'Keep transactional account email separate from a human support inbox such as support@comfi.chat.' },
				{ title: 'Wipe staging before public launch', description: 'Use the danger zone to remove test chats, accounts, media, and moderation artifacts while preserving admin accounts.' }
			],
			mail: sanitizeMailSettings(mailSettings),
			mailRecommendations: {
				fromAddress: 'no-reply@comfi.chat',
				replyTo: 'support@comfi.chat',
				icloud: {
					host: 'smtp.mail.me.com',
					port: 587,
					secure: false,
					authMethod: 'LOGIN',
					note: 'Use STARTTLS on port 587. Apple usually requires an app-specific password for SMTP.'
				}
			},
			dangerConfirmation: 'WIPE COMFI DATA'
		});
	} catch (e) {
		console.error('[Admin] settings summary', e);
		res.status(500).json({ error: 'Failed to load settings summary' });
	}
});

router.put('/settings/mail', async (req, res) => {
	try {
		if (!req.admin || (req.admin.role !== 'owner' && req.admin.role !== 'admin')) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const saved = await saveMailSettings(req.body || {}, req.admin.sub);
		await recordAction(req, {
			actionType: 'settings_update',
			metadata: { area: 'mail', enabled: saved.enabled, host: saved.host, fromAddress: saved.fromAddress }
		});
		res.json({ ok: true, mail: saved });
	} catch (e) {
		console.error('[Admin] save mail settings', e);
		res.status(400).json({ error: e.message || 'Failed to save mail settings' });
	}
});

router.post('/settings/mail/test', async (req, res) => {
	try {
		if (!req.admin || (req.admin.role !== 'owner' && req.admin.role !== 'admin')) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const { recipient } = req.body || {};
		if (!recipient) return res.status(400).json({ error: 'Recipient email is required' });
		const result = await sendMail({
			to: recipient,
			subject: 'ComfiChat mail test',
			text: 'This is a test email from your ComfiChat admin mail settings.',
			html: '<p>This is a test email from your <strong>ComfiChat</strong> admin mail settings.</p>'
		});
		await recordAction(req, {
			actionType: 'settings_update',
			metadata: { area: 'mail-test', recipient, source: result.source }
		});
		res.json({ ok: true, source: result.source, preview: result.preview });
	} catch (e) {
		console.error('[Admin] test mail settings', e);
		res.status(400).json({ error: e.message || 'Failed to send test email' });
	}
});

router.post('/settings/wipe-data', async (req, res) => {
	try {
		if (!req.admin || (req.admin.role !== 'owner' && req.admin.role !== 'admin')) {
			return res.status(403).json({ error: 'Forbidden' });
		}
		const { confirmation } = req.body || {};
		if (confirmation !== 'WIPE COMFI DATA') {
			return res.status(400).json({ error: 'Confirmation text did not match' });
		}
		const collections = [
			['messages', Message],
			['reports', Report],
			['loginEvents', LoginEvent],
			['tempUsers', TempUser],
			['registeredUsers', User],
			['pendingUsers', PendingUser],
			['media', Media],
			['blocks', ModerationBlock],
			['actions', ModerationAction],
			['identities', UserIdentity]
		];
		const deleted = {};
		for (const [name, model] of collections) {
			const result = await model.deleteMany({});
			deleted[name] = result.deletedCount || 0;
		}
		const uploadsDir = path.join(__dirname, '..', 'uploads');
		let uploadFilesDeleted = 0;
		try {
			if (fs.existsSync(uploadsDir)) {
				for (const entry of fs.readdirSync(uploadsDir)) {
					const filePath = path.join(uploadsDir, entry);
					if (fs.statSync(filePath).isFile()) {
						fs.unlinkSync(filePath);
						uploadFilesDeleted += 1;
					}
				}
			}
		} catch (fileError) {
			console.error('[Admin] wipe uploads warning', fileError);
		}
		deleted.uploadFiles = uploadFilesDeleted;
		await recordAction(req, {
			actionType: 'clear_user_history',
			metadata: { dangerZoneWipe: true, deleted }
		});
		res.json({ ok: true, deleted });
	} catch (e) {
		console.error('[Admin] wipe data', e);
		res.status(500).json({ error: 'Failed to wipe data' });
	}
});

router.get('/evidence/report/:id', async (req, res) => {
	try {
		const report = await Report.findById(req.params.id).lean();
		if (!report) return res.status(404).json({ error: 'Not found' });
		const [messages, reportsAgainst, blocksAgainst] = await Promise.all([
			Message.find(activeMessageMatch({ $or: [
				{ sender: report.reportingUser, recipient: report.reportedUser },
				{ sender: report.reportedUser, recipient: report.reportingUser }
			] })).sort({ timestamp: 1 }).lean(),
			Report.find({ reportedUser: report.reportedUser }).sort({ createdAt: -1 }).limit(50).lean(),
			ModerationBlock.find({ blockedUsername: report.reportedUser }).sort({ createdAt: -1 }).limit(50).lean()
		]);
		const bundle = { exportedAt: new Date(), type: 'report', report, messages, reportsAgainst, blocksAgainst };
		res.setHeader('Content-Disposition', `attachment; filename="${evidenceFilename('report', [report.reportingUser, report.reportedUser])}"`);
		res.json(bundle);
	} catch (e) {
		console.error('[Admin] report evidence', e);
		res.status(500).json({ error: 'Failed to export evidence' });
	}
});

router.get('/media/:id/content', async (req, res) => {
	try {
		const mediaDoc = await Media.findOne({ _id: req.params.id, deletedAt: { $exists: false } }).lean();
		if (!mediaDoc || !mediaDoc.bytes) return res.status(404).send('Not found');
		const bytes = mediaBuffer(mediaDoc.bytes);
		if (!bytes) return res.status(404).send('Not found');
		res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Content-Type', mediaDoc.contentType || 'application/octet-stream');
		res.setHeader('Cache-Control', 'private, max-age=3600');
		return res.end(bytes);
	} catch (e) {
		console.error('[Admin] media content error', e);
		res.status(500).send('Failed to resolve media');
	}
});

router.get('/evidence/conversation', async (req, res) => {
	try {
		const { userA, userB, devA, devB } = req.query || {};
		if (!userA || !userB) return res.status(400).json({ error: 'Missing users' });
		const clause1 = { sender: userA, recipient: userB };
		const clause2 = { sender: userB, recipient: userA };
		if (devA) clause1.senderDeviceId = devA;
		if (devB) clause1.recipientDeviceId = devB;
		if (devB) clause2.senderDeviceId = devB;
		if (devA) clause2.recipientDeviceId = devA;
		const [messages, reports] = await Promise.all([
			Message.find(activeMessageMatch({ $or: [clause1, clause2] })).sort({ timestamp: 1 }).lean(),
			Report.find({ $or: [{ reportingUser: userA, reportedUser: userB }, { reportingUser: userB, reportedUser: userA }] }).sort({ createdAt: -1 }).lean()
		]);
		res.setHeader('Content-Disposition', `attachment; filename="${evidenceFilename('conversation', [userA, userB])}"`);
		res.json({ exportedAt: new Date(), type: 'conversation', participants: { userA, userB, devA, devB }, messages, reports });
	} catch (e) {
		console.error('[Admin] conversation evidence', e);
		res.status(500).json({ error: 'Failed to export evidence' });
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
		const bytes = mediaBuffer(mediaDoc.bytes);
		if (!bytes) return res.status(404).send('Not found');
		res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Content-Type', mediaDoc.contentType || 'application/octet-stream');
		res.setHeader('Cache-Control', 'private, max-age=31536000');
		return res.end(bytes);
	} catch (e) {
		console.error('[Admin] media resolve error', e);
		res.status(500).send('Failed to resolve');
	}
});

module.exports = router;


