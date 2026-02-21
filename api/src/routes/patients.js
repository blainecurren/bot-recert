/**
 * Patient Routes
 * CRUD-style endpoints for patient data, all backed by FHIR via fhirService.
 *
 * All routes require authentication. The nurse's workerId is resolved
 * from their email via workerMapping.
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const workerMapping = require('../services/workerMapping');
const fhirService = require('../services/fhirService');
const { RESOURCE_CATEGORIES, RESOURCE_LABELS, fetchResourceData } = require('../services/resourceMap');
const { createLogger } = require('../services/logger');

const router = express.Router();
const log = createLogger('PatientsRoute');

/**
 * GET /api/patients
 * Nurse's caseload for today (or ?date=YYYY-MM-DD).
 * Resolves workerId from the authenticated user's email via worker mapping.
 */
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const { email } = req.user;

        // Resolve worker mapping
        const mapping = await workerMapping.getMapping(email);
        if (!mapping) {
            return res.status(403).json({
                error: 'No worker mapping found for this user. Contact an administrator to link your account.'
            });
        }

        const { workerId } = mapping;
        const dateStr = req.query.date || new Date().toISOString().split('T')[0];

        log.info({ email, workerId, dateStr }, 'Loading patient caseload');

        const patients = await fhirService.getPatientsByWorkerAndDate(workerId, dateStr);

        res.json({
            workerId,
            date: dateStr,
            count: patients.length,
            patients
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/patients/:id
 * Single patient detail — demographics, episodes, and conditions.
 */
router.get('/:id', requireAuth, async (req, res, next) => {
    try {
        const { id } = req.params;

        log.info({ patientId: id }, 'Patient detail requested');

        // Fetch patient, episodes, and conditions in parallel
        const [patient, episodes, conditions] = await Promise.all([
            fhirService.getPatientById(id),
            fhirService.getPatientEpisodes(id),
            fhirService.getConditions(id),
        ]);

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        res.json({
            patient,
            episodes,
            conditions
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/patients/:id/episodes
 * Episode list for a patient.
 */
router.get('/:id/episodes', requireAuth, async (req, res, next) => {
    try {
        const { id } = req.params;

        log.info({ patientId: id }, 'Episodes requested');

        const episodes = await fhirService.getPatientEpisodes(id);

        res.json({
            patientId: id,
            count: episodes.length,
            episodes
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/patients/:id/resources
 * Available resource types metadata — categories with labels.
 * The frontend uses this to render the resource picker UI.
 */
router.get('/:id/resources', requireAuth, async (req, res, next) => {
    try {
        const { id } = req.params;

        res.json({
            patientId: id,
            categories: RESOURCE_CATEGORIES
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/patients/:id/resources/:resourceType
 * Generic resource fetcher — any of the 46+ resource types.
 * The :resourceType param matches a key in RESOURCE_METHOD_MAP.
 */
router.get('/:id/resources/:resourceType', requireAuth, async (req, res, next) => {
    try {
        const { id, resourceType } = req.params;

        // Resolve workerId in case the resource needs it
        const { email } = req.user;
        const mapping = await workerMapping.getMapping(email);
        const workerId = mapping?.workerId || null;

        log.info({ patientId: id, resourceType }, 'Resource data requested');

        const result = await fetchResourceData(resourceType, id, workerId);

        res.json({
            patientId: id,
            ...result
        });
    } catch (err) {
        // fetchResourceData throws with statusCode for known errors
        if (err.statusCode) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        next(err);
    }
});

module.exports = router;
