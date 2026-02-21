/**
 * Entra ID (Azure AD) JWT Authentication Middleware
 *
 * Validates Bearer tokens from the React SPA using JWKS endpoint.
 * When Entra ID is not configured (no ENTRA_TENANT_ID), runs in
 * dev mode — extracts email from token without validation.
 */

const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');
const { createLogger } = require('../services/logger');

const log = createLogger('Auth');

const tenantId = process.env.ENTRA_TENANT_ID;
const clientId = process.env.ENTRA_CLIENT_ID;
const audience = process.env.ENTRA_AUDIENCE || clientId;

const isConfigured = !!(tenantId && clientId);

// JWKS client for fetching signing keys from Entra ID
let jwksClient = null;
if (isConfigured) {
    jwksClient = jwksRsa({
        jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 600000, // 10 minutes
    });
}

function getSigningKey(header, callback) {
    jwksClient.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        callback(null, key.getPublicKey());
    });
}

/**
 * Express middleware that validates Entra ID JWT tokens.
 * Attaches `req.user` with { email, name, oid } on success.
 *
 * Dev mode (no Entra config): allows unauthenticated requests
 * with req.user set from X-Dev-Email header or default.
 */
function requireAuth(req, res, next) {
    // Dev mode — no Entra ID configured
    if (!isConfigured) {
        const devEmail = req.headers['x-dev-email'] || 'dev@localhost';
        req.user = {
            email: devEmail,
            name: 'Dev User',
            oid: 'dev-oid',
        };
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);

    jwt.verify(
        token,
        getSigningKey,
        {
            audience: audience,
            issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
            algorithms: ['RS256'],
        },
        (err, decoded) => {
            if (err) {
                log.warn({ err: err.message }, 'JWT validation failed');
                return res.status(401).json({ error: 'Invalid token' });
            }

            req.user = {
                email: decoded.preferred_username || decoded.email || decoded.upn || '',
                name: decoded.name || '',
                oid: decoded.oid || '',
            };

            next();
        }
    );
}

module.exports = { requireAuth, isConfigured };
