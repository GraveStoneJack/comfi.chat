// server.js
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const tempUsersRoutes = require('./routes/tempUsers');

dotenv.config();

// Initialize express only once
const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// CORS configuration
const corsOptions = {
    origin: ['https://luxeonchat.netlify.app', 'https://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// WebSocket server implementation
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });

const clients = new Map();

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'identify') {
            clients.set(data.username, ws);
        } else if (data.type === 'message') {
            const recipientWs = clients.get(data.recipient);
            if (recipientWs) {
                recipientWs.send(JSON.stringify({
                    type: 'message',
                    message: data.message,
                    sender: data.sender,
                    timestamp: new Date()
                }));
            }
        }
    });

    ws.on('close', () => {
        // Remove client from map when they disconnect
        for (const [username, socket] of clients.entries()) {
            if (socket === ws) {
                clients.delete(username);
                break;
            }
        }
    });
});

// Debug middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.method === 'POST') {
        console.log('Request body:', req.body);
    }
    next();
});

// Routes
app.use('/api/temp-users', tempUsersRoutes);

// Basic route for testing
app.get('/', (req, res) => {
    res.json({
        message: 'LuxeonChat Backend API is running',
        timestamp: new Date().toISOString()
    });
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    serverApi: {
        version: '1',
        strict: true,
        deprecationErrors: true,
    }
})
.then(() => {
    console.log('Connected to MongoDB');
    console.log('Database:', mongoose.connection.db.databaseName);

    // Initialize server only after successful database connection
    const PORT = process.env.PORT || 10000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
})
.catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
});

// Error handling
mongoose.connection.on('error', err => {
    console.error('MongoDB error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected');
});

process.on('SIGINT', async () => {
    await mongoose.connection.close();
    process.exit(0);
});

app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});
