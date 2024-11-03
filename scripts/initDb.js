// scripts/initDb.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

async function initializeDatabase() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Get database instance
        const db = mongoose.connection.db;

        // Create collections if they don't exist
        await db.createCollection('tempusers');
        await db.createCollection('users');
        await db.createCollection('reports');

        // Create indexes
        await db.collection('tempusers').createIndex({ "username": 1 }, { unique: true });
        await db.collection('tempusers').createIndex({ "createdAt": 1 }, { expireAfterSeconds: 3600 });
        
        await db.collection('users').createIndex({ "username": 1 }, { unique: true });
        await db.collection('users').createIndex({ "email": 1 }, { unique: true });

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        await mongoose.disconnect();
    }
}

initializeDatabase();
