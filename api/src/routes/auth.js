/**
 * Auth Routes
 * GET /api/auth/me — Returns user profile + linked worker (if mapped)
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const workerMapping = require('../services/workerMapping');
const { getWorkerById } = require('../services/workerLookup');
const { createLogger } = require('../services/logger');

const router = express.Router();
const log = createLogger('AuthRoute');

/**
 * GET /api/auth/me
 * Returns the authenticated user's profile and their linked worker (if any).
 */
router.get('/me', requireAuth, async (req, res, next) => {
    try {
        const { email, name, oid } = req.user;

        log.info({ email }, 'User profile requested');

        // Look up worker mapping
        const mapping = await workerMapping.getMapping(email);
        let worker = null;

        if (mapping) {
            // Verify worker exists in FHIR
            worker = await getWorkerById(mapping.workerId);
            if (!worker) {
                log.warn({ email, workerId: mapping.workerId }, 'Mapped worker not found in FHIR');
            }
        }

        res.json({
            user: { email, name, oid },
            worker: worker,
            mapped: !!mapping,
            mappedWorkerId: mapping?.workerId || null,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
