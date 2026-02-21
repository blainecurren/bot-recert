/**
 * Structured Logging Utility (Pino)
 *
 * Provides JSON-structured logs with:
 * - Component-scoped child loggers via createLogger(component)
 * - Request-scoped loggers with correlation IDs via createRequestLogger(component, req)
 * - Two-layer PHI redaction: path-based (Pino native) + regex scrubbing on messages
 * - LOG_LEVEL env var (default: debug in development, info in production)
 * - pino-pretty transport when NODE_ENV !== 'production'
 */

const pino = require('pino');

const IS_DEV = process.env.NODE_ENV !== 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (IS_DEV ? 'debug' : 'info');

// ── PHI redaction paths (Pino native) ──────────────────────────────
// These structured fields are censored automatically when logged as objects.
const REDACT_PATHS = [
    'patient.fullName',
    'patient.firstName',
    'patient.lastName',
    'patient.dob',
    'patient.birthDate',
    'patient.mrn',
    'patient.phone',
    'patient.address',
    'patient.name',
    'worker.name',
    'patientName',
    'fullName',
    'dob',
    'birthDate',
    'err.response.data',
];

// ── Regex-based PHI scrubbing for message strings ──────────────────
// Catches PHI that leaks into free-text log messages.
const PHI_PATTERNS = [
    { re: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },           // SSN
    { re: /\b\d{3}\.\d{2}\.\d{4}\b/g, replacement: '[SSN]' },         // SSN dot-delimited
    { re: /\(\d{3}\)\s?\d{3}-\d{4}/g, replacement: '[PHONE]' },       // (555) 123-4567
    { re: /\b\d{3}-\d{3}-\d{4}\b/g, replacement: '[PHONE]' },         // 555-123-4567
    { re: /\b(MRN|mrn)[:\s#]*\d{4,}\b/g, replacement: '[MRN]' },      // MRN: 12345
    { re: /\b\d{2}\/\d{2}\/\d{4}\b/g, replacement: '[DOB]' },         // MM/DD/YYYY
    { re: /\b\d{4}-\d{2}-\d{2}\b/g, replacement: '[DATE]' },          // YYYY-MM-DD (scrub dates in messages)
];

function scrubMessage(msg) {
    if (typeof msg !== 'string') return msg;
    let scrubbed = msg;
    for (const { re, replacement } of PHI_PATTERNS) {
        scrubbed = scrubbed.replace(re, replacement);
    }
    return scrubbed;
}

// ── Root logger ────────────────────────────────────────────────────
const transport = IS_DEV
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' } }
    : undefined;

const rootLogger = pino({
    level: LOG_LEVEL,
    transport,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
        level(label) {
            return { level: label };
        },
    },
});

// ── Proxy wrapper that scrubs message strings ──────────────────────
function wrapWithScrubbing(logger) {
    return new Proxy(logger, {
        get(target, prop) {
            const val = target[prop];
            if (typeof val !== 'function') return val;

            // Intercept logging methods to scrub message arguments
            const LOG_METHODS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
            if (!LOG_METHODS.has(prop)) return val.bind(target);

            return function (...args) {
                const scrubbed = args.map((arg) => {
                    if (typeof arg === 'string') return scrubMessage(arg);
                    return arg;
                });
                return val.apply(target, scrubbed);
            };
        },
    });
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Create a component-scoped logger.
 * Usage: const log = createLogger('FHIR');
 *        log.info({ endpoint }, 'GET request');
 */
function createLogger(component) {
    return wrapWithScrubbing(rootLogger.child({ component }));
}

/**
 * Create a request-scoped logger with correlation ID from Express request.
 * Usage: const log = createRequestLogger('Auth', req);
 */
function createRequestLogger(component, req) {
    const requestId = req?.id || req?.headers?.['x-request-id'] || 'unknown';
    return wrapWithScrubbing(rootLogger.child({ component, requestId }));
}

module.exports = {
    rootLogger: wrapWithScrubbing(rootLogger),
    createLogger,
    createRequestLogger,
};
