// scripts/bootstrapAdmin.js
// Usage: node scripts/bootstrapAdmin.js username email password
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const AdminUser = require('../models/AdminUser');

dotenv.config();

async function run() {
	const [,, username, email, password] = process.argv;
	if (!username || !email || !password) {
		console.log('Usage: node scripts/bootstrapAdmin.js <username> <email> <password>');
		process.exit(1);
	}
	if (!process.env.MONGODB_URI || !process.env.ADMIN_JWT_SECRET) {
		console.error('Please set MONGODB_URI and ADMIN_JWT_SECRET in the environment');
		process.exit(1);
	}
	await mongoose.connect(process.env.MONGODB_URI);
	try {
		const exists = await AdminUser.findOne({ $or: [ { username }, { email } ] });
		if (exists) {
			console.log('An admin with that username or email already exists.');
			process.exit(1);
		}
		const passwordHash = await bcrypt.hash(password, 10);
		const secret = authenticator.generateSecret();
		const admin = await AdminUser.create({
			username, email, passwordHash, role: 'owner', totpSecret: secret
		});
		const otpauth = authenticator.keyuri(email, 'Comfi Admin', secret);
		console.log('Admin created:', admin.username);
		console.log('TOTP secret (store securely):', secret);
		console.log('Add to your authenticator app using this URI:');
		console.log(otpauth);
	} finally {
		await mongoose.disconnect();
	}
}

run().catch((e) => { console.error(e); process.exit(1); });


