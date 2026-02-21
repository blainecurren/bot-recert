/**
 * Recert API — Express Server
 * Entry point for the web frontend backend.
 */

const config = require('./config/env');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createLogger } = require('./services/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { initRedis } = require('./services/workerMapping');

// Routes
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admin');
const patientRoutes = require('./routes/patients');

const log = createLogger('Server');
const app = express();

// ── Middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
    origin: config.isDev ? true : process.env.CORS_ORIGIN,
    credentials: true,
}));
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patients', patientRoutes);

// ── Error handler ──────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────────────
async function start() {
    // Initialize Redis (non-blocking — falls back to memory)
    await initRedis(config.redisUrl);

    app.listen(config.port, () => {
        log.info({ port: config.port, isDev: config.isDev }, 'Server started');
    });
}

start().catch((err) => {
    log.fatal({ err }, 'Failed to start server');
    process.exit(1);
});
