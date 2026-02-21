/**
 * Environment Configuration
 * Validates required env vars at startup and exports typed config.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load .env from api/ directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const REQUIRED_VARS = [
    'HCHB_CLIENT_ID',
    'HCHB_RESOURCE_SECURITY_ID',
    'HCHB_AGENCY_SECRET',
    'HCHB_TOKEN_URL',
    'HCHB_API_BASE_URL',
];

const missing = REQUIRED_VARS.filter(v => !process.env[v]);
if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
}

const config = {
    port: parseInt(process.env.PORT || '3001', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
    isDev: process.env.NODE_ENV !== 'production',

    // Entra ID (Azure AD)
    entra: {
        tenantId: process.env.ENTRA_TENANT_ID || '',
        clientId: process.env.ENTRA_CLIENT_ID || '',
        audience: process.env.ENTRA_AUDIENCE || '',
    },

    // HCHB FHIR
    hchb: {
        clientId: process.env.HCHB_CLIENT_ID,
        resourceSecurityId: process.env.HCHB_RESOURCE_SECURITY_ID,
        agencySecret: process.env.HCHB_AGENCY_SECRET,
        tokenUrl: process.env.HCHB_TOKEN_URL,
        apiBaseUrl: process.env.HCHB_API_BASE_URL,
    },

    // Redis
    redisUrl: process.env.REDIS_URL || null,

    // Python backend (optional fallback — OFF by default)
    pythonBackend: {
        enabled: process.env.USE_PYTHON_BACKEND === 'true',
        url: process.env.PYTHON_BACKEND_URL || 'http://localhost:8000/api/v1',
        timeout: parseInt(process.env.PYTHON_BACKEND_TIMEOUT || '30000', 10),
    },
};

module.exports = config;
