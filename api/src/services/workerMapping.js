/**
 * Worker Mapping Service
 * Maps user emails to HCHB worker IDs.
 * Primary: Redis. Fallback: in-memory Map.
 *
 * PHI note: Worker mappings contain email → workerID associations.
 * No patient data is stored here.
 */

const { createLogger } = require('./logger');

const log = createLogger('WorkerMapping');

// In-memory fallback store
const memoryStore = new Map();

// Redis client (lazy-initialized)
let redis = null;
let redisAvailable = false;

const REDIS_PREFIX = 'worker-mapping:';

/**
 * Initialize Redis connection if REDIS_URL is configured.
 * Call once at startup. Safe to skip — falls back to in-memory.
 */
async function initRedis(redisUrl) {
    if (!redisUrl) {
        log.info('No REDIS_URL configured, using in-memory store');
        return;
    }

    try {
        const Redis = require('ioredis');
        redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            lazyConnect: true,
        });

        redis.on('error', (err) => {
            log.warn({ err }, 'Redis error, falling back to memory');
            redisAvailable = false;
        });

        redis.on('connect', () => {
            log.info('Redis connected');
            redisAvailable = true;
        });

        await redis.connect();
    } catch (err) {
        log.warn({ err }, 'Redis connection failed, using in-memory store');
        redis = null;
        redisAvailable = false;
    }
}

/**
 * Get worker mapping for an email.
 * @param {string} email
 * @returns {Promise<{email: string, workerId: string, displayName?: string} | null>}
 */
async function getMapping(email) {
    const key = email.toLowerCase();

    if (redisAvailable && redis) {
        try {
            const data = await redis.get(`${REDIS_PREFIX}${key}`);
            if (data) return JSON.parse(data);
        } catch (err) {
            log.warn({ err }, 'Redis get failed, trying memory');
        }
    }

    return memoryStore.get(key) || null;
}

/**
 * Set a worker mapping.
 * @param {string} email
 * @param {string} workerId
 * @param {string} [displayName]
 */
async function setMapping(email, workerId, displayName) {
    const key = email.toLowerCase();
    const value = { email: key, workerId, displayName: displayName || null };

    // Always write to memory (acts as cache and fallback)
    memoryStore.set(key, value);

    if (redisAvailable && redis) {
        try {
            await redis.set(`${REDIS_PREFIX}${key}`, JSON.stringify(value));
        } catch (err) {
            log.warn({ err }, 'Redis set failed, stored in memory only');
        }
    }

    log.info({ email: key, workerId }, 'Mapping set');
}

/**
 * Delete a worker mapping.
 * @param {string} email
 * @returns {Promise<boolean>} True if a mapping was deleted
 */
async function deleteMapping(email) {
    const key = email.toLowerCase();
    const existed = memoryStore.delete(key);

    if (redisAvailable && redis) {
        try {
            await redis.del(`${REDIS_PREFIX}${key}`);
        } catch (err) {
            log.warn({ err }, 'Redis delete failed');
        }
    }

    log.info({ email: key }, 'Mapping deleted');
    return existed;
}

/**
 * List all worker mappings.
 * @returns {Promise<Array<{email: string, workerId: string, displayName?: string}>>}
 */
async function listMappings() {
    if (redisAvailable && redis) {
        try {
            const keys = await redis.keys(`${REDIS_PREFIX}*`);
            if (keys.length > 0) {
                const pipeline = redis.pipeline();
                keys.forEach(k => pipeline.get(k));
                const results = await pipeline.exec();
                return results
                    .filter(([err, val]) => !err && val)
                    .map(([, val]) => JSON.parse(val));
            }
            return [];
        } catch (err) {
            log.warn({ err }, 'Redis list failed, returning memory store');
        }
    }

    return Array.from(memoryStore.values());
}

module.exports = {
    initRedis,
    getMapping,
    setMapping,
    deleteMapping,
    listMappings,
};
