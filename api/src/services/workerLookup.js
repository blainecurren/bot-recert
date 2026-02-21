/**
 * Worker Lookup Service
 * Resolves HCHB worker/practitioner by ID via FHIR API.
 * Adapted from patientService.getWorkerById — 4-strategy fallback.
 *
 * PHI note: Worker names are considered PHI-adjacent.
 * Returned data should not be logged without redaction.
 */

const { fhirGet } = require('./fhirClient');
const { createLogger } = require('./logger');

const log = createLogger('WorkerLookup');

/**
 * Look up a worker (Practitioner) by ID using multiple FHIR search strategies.
 * @param {string} workerId - Worker ID, resource ID, or name
 * @returns {Promise<{id: string, identifier: string, name: string, active: boolean} | null>}
 */
async function getWorkerById(workerId) {
    if (!workerId) return null;

    try {
        log.debug({ workerId }, 'Looking up worker');

        // Strategy 1: Search by identifier
        let bundle = await fhirGet('/Practitioner', {
            identifier: workerId,
            _count: 1
        });

        // Strategy 2: Search by _id (resource ID)
        if (!bundle.entry || bundle.entry.length === 0) {
            log.debug('Not found by identifier, trying _id');
            bundle = await fhirGet('/Practitioner', {
                _id: workerId,
                _count: 1
            });
        }

        // Strategy 3: Direct fetch by resource ID
        if (!bundle.entry || bundle.entry.length === 0) {
            log.debug('Not found by _id, trying direct fetch');
            try {
                const practitioner = await fhirGet(`/Practitioner/${workerId}`);
                if (practitioner && practitioner.id) {
                    const name = practitioner.name?.[0] || {};
                    return {
                        id: practitioner.id,
                        identifier: workerId,
                        name: name.text || `${name.given?.[0] || ''} ${name.family || ''}`.trim() || workerId,
                        active: practitioner.active
                    };
                }
            } catch (e) {
                // Not found by direct fetch, continue
            }
        }

        // Strategy 4: Search by name (if workerId looks like a name)
        if (!bundle.entry || bundle.entry.length === 0) {
            log.debug('Not found by ID, trying name search');
            bundle = await fhirGet('/Practitioner', {
                name: workerId,
                _count: 1
            });
        }

        if (bundle.entry && bundle.entry.length > 0) {
            const practitioner = bundle.entry[0].resource;
            const name = practitioner.name?.[0] || {};
            return {
                id: practitioner.id,
                identifier: workerId,
                name: name.text || `${name.given?.[0] || ''} ${name.family || ''}`.trim() || workerId,
                active: practitioner.active
            };
        }

        log.debug('Worker not found');
        return null;
    } catch (error) {
        log.error({ err: error }, 'Worker lookup failed');
        return null;
    }
}

module.exports = {
    getWorkerById,
};
