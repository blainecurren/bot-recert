/**
 * Chat Routes
 * POST /api/chat — Chat stub (echoes message back)
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createLogger } = require('../services/logger');

const router = express.Router();
const log = createLogger('ChatRoute');

/**
 * POST /api/chat
 * Stub endpoint — echoes the user's message back.
 * Will be replaced with Azure OpenAI integration.
 *
 * Body: { message: string }
 * Response: { reply: string, timestamp: string }
 */
router.post('/', requireAuth, async (req, res, next) => {
    try {
        const { message } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required' });
        }

        log.info({ email: req.user.email }, 'Chat message received');

        // Stub: echo the message back
        res.json({
            reply: `Echo: ${message}`,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
