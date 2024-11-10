// server.js
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const tempUsersRoutes = require('./routes/tempUsers');

dotenv.config();

const app = express();

// Middleware
app.use(express.json());

// CORS configuration
const corsOptions = {
    origin: ['https://steady-lollipop-53e11c.netlify.app'],
    credentials: true,
    optionsSuccessStatus: 200
},

app.use(cors(corsOptions));

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
    const PORT = process.env.PORT || 10000; // Changed to 10000 for Render
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
})
.catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit if unable to connect to database
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

