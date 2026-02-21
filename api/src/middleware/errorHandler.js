/**
 * Global Express Error Handler
 */

const { createLogger } = require('../services/logger');

const log = createLogger('ErrorHandler');

function errorHandler(err, req, res, _next) {
    log.error({ err, method: req.method, url: req.url }, 'Unhandled error');

    const status = err.status || err.statusCode || 500;
    const message = status === 500 ? 'Internal server error' : err.message;

    res.status(status).json({ error: message });
}

module.exports = { errorHandler };
