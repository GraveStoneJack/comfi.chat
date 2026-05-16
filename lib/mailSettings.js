const crypto = require('crypto');
const nodemailer = require('nodemailer');
const MailSettings = require('../models/MailSettings');

const MAIL_SETTINGS_ID = '000000000000000000000001';

function encryptionKey() {
	const secret = process.env.MAIL_SETTINGS_SECRET || process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
	if (!secret) {
		throw new Error('MAIL_SETTINGS_SECRET, ADMIN_JWT_SECRET, or JWT_SECRET is required to encrypt mail settings');
	}
	return crypto.createHash('sha256').update(secret).digest();
}

function encryptSecret(value) {
	if (!value) return undefined;
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
	const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptSecret(value) {
	if (!value) return '';
	const [iv, tag, encrypted] = value.split('.');
	if (!iv || !tag || !encrypted) return '';
	const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
	decipher.setAuthTag(Buffer.from(tag, 'base64'));
	return Buffer.concat([
		decipher.update(Buffer.from(encrypted, 'base64')),
		decipher.final()
	]).toString('utf8');
}

function sanitize(settings) {
	if (!settings) {
		return {
			enabled: false,
			provider: 'icloud',
			host: 'smtp.mail.me.com',
			port: 587,
			secure: false,
			username: '',
			fromAddress: 'no-reply@comfi.chat',
			fromName: 'ComfiChat',
			replyTo: 'support@comfi.chat',
			hasPassword: false
		};
	}
	return {
		enabled: !!settings.enabled,
		provider: settings.provider || 'custom-smtp',
		host: settings.host || '',
		port: settings.port || 587,
		secure: !!settings.secure,
		username: settings.username || '',
		fromAddress: settings.fromAddress || '',
		fromName: settings.fromName || 'ComfiChat',
		replyTo: settings.replyTo || '',
		hasPassword: !!settings.passwordEncrypted,
		updatedAt: settings.updatedAt
	};
}

function formatFrom(settings) {
	const name = (settings && settings.fromName) || 'ComfiChat';
	const address = (settings && settings.fromAddress) || process.env.MAIL_FROM || 'no-reply@comfi.chat';
	return name ? `"${String(name).replace(/"/g, '\\"')}" <${address}>` : address;
}

async function getSettings({ includePassword = false } = {}) {
	const query = MailSettings.findById(MAIL_SETTINGS_ID);
	if (includePassword) query.select('+passwordEncrypted');
	return query.lean();
}

async function saveSettings(payload, adminId) {
	const existing = await MailSettings.findById(MAIL_SETTINGS_ID).select('+passwordEncrypted');
	const enabled = !!payload.enabled;
	const update = {
		enabled,
		provider: payload.provider || 'custom-smtp',
		host: String(payload.host || '').trim(),
		port: parseInt(payload.port || 587, 10),
		secure: !!payload.secure,
		username: String(payload.username || '').trim(),
		fromAddress: String(payload.fromAddress || '').trim().toLowerCase(),
		fromName: String(payload.fromName || 'ComfiChat').trim(),
		replyTo: String(payload.replyTo || '').trim().toLowerCase(),
		updatedByAdminId: adminId
	};

	if (!Number.isFinite(update.port) || update.port < 1 || update.port > 65535) {
		throw new Error('SMTP port must be between 1 and 65535');
	}
	if (enabled && (!update.host || !update.username || !update.fromAddress)) {
		throw new Error('SMTP host, username, and sending address are required when mail is enabled');
	}
	if (payload.password) {
		update.passwordEncrypted = encryptSecret(payload.password);
	} else if (existing && existing.passwordEncrypted) {
		update.passwordEncrypted = existing.passwordEncrypted;
	}
	if (enabled && !update.passwordEncrypted) {
		throw new Error('SMTP password is required when mail is enabled');
	}

	const saved = await MailSettings.findByIdAndUpdate(
		MAIL_SETTINGS_ID,
		update,
		{ upsert: true, new: true, setDefaultsOnInsert: true }
	).select('+passwordEncrypted');
	return sanitize(saved);
}

async function createConfiguredTransport() {
	const settings = await getSettings({ includePassword: true });
	if (settings && settings.enabled) {
		const password = decryptSecret(settings.passwordEncrypted);
		return {
			transporter: nodemailer.createTransport({
				host: settings.host,
				port: settings.port,
				secure: !!settings.secure,
				auth: {
					user: settings.username,
					pass: password
				}
			}),
			settings,
			source: 'database'
		};
	}
	if (process.env.SMTP_URL) {
		return {
			transporter: nodemailer.createTransport(process.env.SMTP_URL),
			settings: {
				fromAddress: process.env.MAIL_FROM || 'no-reply@comfi.chat',
				fromName: 'ComfiChat',
				replyTo: process.env.MAIL_REPLY_TO || ''
			},
			source: 'env'
		};
	}
	const test = await nodemailer.createTestAccount();
	return {
		transporter: nodemailer.createTransport({
			host: 'smtp.ethereal.email',
			port: 587,
			secure: false,
			auth: { user: test.user, pass: test.pass }
		}),
		settings: {
			fromAddress: process.env.MAIL_FROM || 'no-reply@comfi.chat',
			fromName: 'ComfiChat',
			replyTo: process.env.MAIL_REPLY_TO || ''
		},
		source: 'ethereal'
	};
}

async function sendMail(options) {
	const { transporter, settings, source } = await createConfiguredTransport();
	const info = await transporter.sendMail({
		from: formatFrom(settings),
		replyTo: settings.replyTo || undefined,
		...options
	});
	const preview = source === 'ethereal' && nodemailer.getTestMessageUrl
		? nodemailer.getTestMessageUrl(info)
		: undefined;
	return { info, preview, source };
}

module.exports = {
	getSettings,
	saveSettings,
	sanitize,
	sendMail
};
