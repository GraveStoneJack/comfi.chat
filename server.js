// server.js
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const passport = require('passport');
const tempUsersRoutes = require('./routes/tempUsers');
const messagesRoutes = require('./routes/messages');
const usersRoutes = require('./routes/users');
const uploadRoutes = require('./routes/upload');
const authRoutes = require('./routes/auth');
const reportsRoutes = require('./routes/reports');
const { router: adminAuthRouter } = require('./routes/adminAuth');
const adminRouter = require('./routes/admin');
const Message = require('./models/Message');
const TempUser = require('./models/TempUser');
const LoginEvent = require('./models/LoginEvent');

dotenv.config();

// Initialize express and create HTTP server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const clients = new Map();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static('public'));
app.use(passport.initialize());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// CORS configuration
const corsOptions = {
    origin: ['https://comfi.chat', 'http://localhost:3000', 'https://admin.comfi.chat', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// WebSocket server implementation
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
	// Track liveness and respond to heartbeat pings
	ws.isAlive = true;
	ws.on('pong', function heartbeat() {
		this.isAlive = true;
	});

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
                    // Attempt to resolve device identities from TempUser for both parties
                    let senderDeviceId, recipientDeviceId;
                    try {
                        const [senderTmp, recipientTmp] = await Promise.all([
                            TempUser.findOne({ username: data.sender }).lean(),
                            TempUser.findOne({ username: data.recipient }).lean()
                        ]);
                        senderDeviceId = senderTmp && senderTmp.deviceId || undefined;
                        recipientDeviceId = recipientTmp && recipientTmp.deviceId || undefined;
                    } catch (_e) {}
                    await new Message({
                        sender: data.sender,
                        senderDeviceId,
                        recipient: data.recipient,
                        recipientDeviceId,
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

// Server-initiated heartbeat to keep idle connections alive and detect dead peers
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WS_HEARTBEAT_INTERVAL_MS || '30000', 10);
const heartbeatInterval = setInterval(() => {
	try {
		wss.clients.forEach((ws) => {
			if (ws.isAlive === false) {
				// Cleanup client mapping for this socket before terminating
				for (const [username, socket] of clients.entries()) {
					if (socket === ws) {
						clients.delete(username);
						console.log(`Cleaned up stale connection for ${username}`);
						break;
					}
				}
				return ws.terminate();
			}
			ws.isAlive = false;
			// ping will trigger an automatic 'pong' from browser clients
			try { ws.ping(); } catch (_e) {}
		});
	} catch (err) {
		console.error('Heartbeat interval error:', err);
	}
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
	clearInterval(heartbeatInterval);
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
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/admin/auth', adminAuthRouter);
app.use('/api/admin', adminRouter);

// Serve admin portal under an obscure base path
const ADMIN_BASE = process.env.ADMIN_BASE_PATH || '/ops-9c6b';
app.use(ADMIN_BASE, express.static(path.join(__dirname, 'admin')));
app.get(`${ADMIN_BASE}`, (_req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// Explicit logoff endpoint: mark offline and remove messages for this user
app.post('/api/logoff/:username', async (req, res) => {
    try {
        const { username } = req.params;
        await TempUser.findOneAndUpdate({ username }, { isOnline: false, lastSeen: new Date() });
        // Preserve messages for audit/admin purposes. Only record a logout event.
        try {
            await LoginEvent.create({
                username,
                type: 'logout',
                userType: 'unknown',
                timestamp: new Date()
            });
        } catch (e2) {
            console.error('Failed to record logout event:', e2);
        }
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
