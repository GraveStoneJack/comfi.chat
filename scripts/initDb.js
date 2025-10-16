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
        await db.createCollection('messages');

        // Create indexes
        await db.collection('tempusers').createIndex({ "username": 1 }, { unique: true });
        await db.collection('tempusers').createIndex({ "createdAt": 1 }, { expireAfterSeconds: 3600 });
        
        await db.collection('users').createIndex({ "username": 1 }, { unique: true });
        await db.collection('users').createIndex({ "email": 1 }, { unique: true });
        await db.collection('messages').createIndex({ sender: 1, recipient: 1, timestamp: 1 });
        await db.collection('messages').createIndex({ recipient: 1, sender: 1, timestamp: 1 });

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        await mongoose.disconnect();
    }
}

initializeDatabase();
