// server.js
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const tempUsersRoutes = require('./routes/tempUsers');
const messagesRoutes = require('./routes/messages');
const usersRoutes = require('./routes/users');
const uploadRoutes = require('./routes/upload');
const Message = require('./models/Message');
const TempUser = require('./models/TempUser');

dotenv.config();

// Initialize express and create HTTP server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const clients = new Map();

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// CORS configuration
const corsOptions = {
    origin: ['https://comfi.chat', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// WebSocket server implementation
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);

            if (data.type === 'identify') {
                clients.set(data.username, ws);
                console.log(`User ${data.username} identified`);
            } else if (data.type === 'message') {
                const recipientWs = clients.get(data.recipient);
                if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                    recipientWs.send(JSON.stringify({
                        type: 'message',
                        message: data.message,
                        sender: data.sender,
                        recipient: data.recipient,
                        timestamp: new Date()
                    }));
                    console.log(`Message sent to ${data.recipient}`);
                } else {
                    console.log(`Recipient ${data.recipient} not found or not connected`);
                }

                // Send back to sender for confirmation
                const senderWs = clients.get(data.sender);
                if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                    senderWs.send(JSON.stringify({
                        type: 'message',
                        message: data.message,
                        sender: data.sender,
                        recipient: data.recipient,
                        timestamp: new Date()
                    }));
                }

                // Persist message for history
                try {
                    await new Message({
                        sender: data.sender,
                        recipient: data.recipient,
                        message: data.message,
                        timestamp: new Date()
                    }).save();
                } catch (e) {
                    console.error('Failed to persist message:', e);
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        for (const [username, socket] of clients.entries()) {
            if (socket === ws) {
                clients.delete(username);
                console.log(`User ${username} disconnected`);
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
app.use('/api/messages', messagesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/upload', uploadRoutes);

// Explicit logoff endpoint: mark offline and remove messages for this user
app.post('/api/logoff/:username', async (req, res) => {
    try {
        const { username } = req.params;
        await TempUser.findOneAndUpdate({ username }, { isOnline: false, lastSeen: new Date() });
        await Message.deleteMany({ $or: [ { sender: username }, { recipient: username } ] });
        res.json({ ok: true });
    } catch (e) {
        console.error('Logoff cleanup failed:', e);
        res.status(500).json({ error: 'Failed to logoff' });
    }
});

// Basic route for testing
app.get('/', (req, res) => {
    res.json({
        message: 'ComfiChat Backend API is running',
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
    server.listen(PORT, () => {
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
