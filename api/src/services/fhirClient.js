/**
 * FHIR Client for HCHB API
 * Handles OAuth2 authentication and HTTP requests to the HCHB FHIR R4 API
 */

const axios = require('axios');
const { createLogger } = require('./logger');

const log = createLogger('FHIR');

// Token cache
let tokenCache = {
    accessToken: null,
    expiresAt: null
};

/**
 * Get OAuth2 access token from HCHB IDP
 * Uses agency_auth grant type
 * @returns {Promise<string>} Access token
 */
async function getAccessToken() {
    // Check if we have a valid cached token (with 5 min buffer)
    if (tokenCache.accessToken && tokenCache.expiresAt) {
        const bufferMs = 5 * 60 * 1000; // 5 minutes
        if (Date.now() < tokenCache.expiresAt - bufferMs) {
            log.debug('Using cached token');
            return tokenCache.accessToken;
        }
    }

    log.info('Requesting new access token');

    const tokenUrl = process.env.HCHB_TOKEN_URL;
    const clientId = process.env.HCHB_CLIENT_ID;
    const agencySecret = process.env.HCHB_AGENCY_SECRET;
    const resourceSecurityId = process.env.HCHB_RESOURCE_SECURITY_ID;

    if (!tokenUrl || !clientId || !agencySecret || !resourceSecurityId) {
        throw new Error('Missing HCHB credentials in environment variables. Required: HCHB_TOKEN_URL, HCHB_CLIENT_ID, HCHB_AGENCY_SECRET, HCHB_RESOURCE_SECURITY_ID');
    }

    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'agency_auth');
        params.append('client_id', clientId);
        params.append('scope', 'openid HCHB.api.scope agency.identity hchb.identity');
        params.append('resource_security_id', resourceSecurityId);
        params.append('agency_secret', agencySecret);

        log.debug({ tokenUrl }, 'Token request');

        const response = await axios.post(tokenUrl, params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const { access_token, expires_in } = response.data;

        if (!access_token) {
            log.error('No access_token in token response');
            throw new Error('No access_token in response');
        }

        // Cache the token
        tokenCache.accessToken = access_token;
        tokenCache.expiresAt = Date.now() + (expires_in * 1000);

        log.info({ expiresIn: expires_in }, 'Access token obtained');
        return access_token;

    } catch (error) {
        log.error({ err: error }, 'Token request failed');
        throw new Error(`Failed to obtain FHIR access token: ${error.response?.data?.error_description || error.message}`);
    }
}

/**
 * Make authenticated GET request to FHIR API
 * @param {string} endpoint - API endpoint (e.g., '/Patient')
 * @param {object} params - Query parameters
 * @returns {Promise<object>} FHIR response data
 */
async function fhirGet(endpoint, params = {}) {
    const token = await getAccessToken();
    const baseUrl = process.env.HCHB_API_BASE_URL;

    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
    log.info({ endpoint, paramKeys: Object.keys(params) }, 'GET request');

    try {
        const response = await axios.get(url, {
            params,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/fhir+json'
            }
        });

        return response.data;

    } catch (error) {
        log.error({ err: error, endpoint, status: error.response?.status }, 'GET request failed');

        // If unauthorized, clear token cache and retry once
        if (error.response?.status === 401) {
            log.info('Token expired, clearing cache and retrying');
            tokenCache.accessToken = null;
            tokenCache.expiresAt = null;

            const newToken = await getAccessToken();
            const retryResponse = await axios.get(url, {
                params,
                headers: {
                    'Authorization': `Bearer ${newToken}`,
                    'Accept': 'application/fhir+json'
                }
            });
            return retryResponse.data;
        }

        throw error;
    }
}

/**
 * Clear the token cache (useful for testing)
 */
function clearTokenCache() {
    tokenCache.accessToken = null;
    tokenCache.expiresAt = null;
    log.info('Token cache cleared');
}

/**
 * Test the FHIR connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testConnection() {
    try {
        log.info('Testing connection');
        await getAccessToken();

        const baseUrl = process.env.HCHB_API_BASE_URL;
        const token = tokenCache.accessToken;

        const response = await axios.get(`${baseUrl}/metadata`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/fhir+json'
            }
        });

        log.info({ fhirVersion: response.data.fhirVersion }, 'Connection successful');
        return true;

    } catch (error) {
        log.error({ err: error }, 'Connection test failed');
        return false;
    }
}

module.exports = {
    getAccessToken,
    fhirGet,
    clearTokenCache,
    testConnection
};
