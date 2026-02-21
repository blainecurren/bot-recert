/**
 * Admin Routes
 * CRUD for worker-email mappings.
 *
 * GET    /api/admin/worker-mappings         — List all
 * POST   /api/admin/worker-mappings         — Create/update
 * DELETE /api/admin/worker-mappings/:email   — Delete
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const workerMapping = require('../services/workerMapping');
const { createLogger } = require('../services/logger');

const router = express.Router();
const log = createLogger('AdminRoute');

/**
 * GET /api/admin/worker-mappings
 */
router.get('/worker-mappings', requireAuth, async (req, res, next) => {
    try {
        const mappings = await workerMapping.listMappings();
        res.json({ mappings });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/admin/worker-mappings
 * Body: { email: string, workerId: string, displayName?: string }
 */
router.post('/worker-mappings', requireAuth, async (req, res, next) => {
    try {
        const { email, workerId, displayName } = req.body;

        if (!email || !workerId) {
            return res.status(400).json({ error: 'email and workerId are required' });
        }

        await workerMapping.setMapping(email, workerId, displayName);

        log.info({ email, workerId }, 'Worker mapping created');
        res.status(201).json({ email: email.toLowerCase(), workerId, displayName: displayName || null });
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/admin/worker-mappings/:email
 */
router.delete('/worker-mappings/:email', requireAuth, async (req, res, next) => {
    try {
        const { email } = req.params;
        const deleted = await workerMapping.deleteMapping(email);

        if (!deleted) {
            return res.status(404).json({ error: 'Mapping not found' });
        }

        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
