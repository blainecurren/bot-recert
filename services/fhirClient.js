/**
 * FHIR Client for HCHB API
 * Handles OAuth2 authentication and HTTP requests to the HCHB FHIR R4 API
 */

const axios = require('axios');

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
            console.log('[FHIR] Using cached token');
            return tokenCache.accessToken;
        }
    }

    console.log('[FHIR] Requesting new access token...');

    const tokenUrl = process.env.HCHB_TOKEN_URL;
    const clientId = process.env.HCHB_CLIENT_ID;
    const agencySecret = process.env.HCHB_AGENCY_SECRET;
    const resourceSecurityId = process.env.HCHB_RESOURCE_SECURITY_ID;

    if (!tokenUrl || !clientId || !agencySecret || !resourceSecurityId) {
        throw new Error('Missing HCHB credentials in environment variables. Required: HCHB_TOKEN_URL, HCHB_CLIENT_ID, HCHB_AGENCY_SECRET, HCHB_RESOURCE_SECURITY_ID');
    }

    try {
        // Match exact Postman format: x-www-form-urlencoded
        const params = new URLSearchParams();
        params.append('grant_type', 'agency_auth');
        params.append('client_id', clientId);
        params.append('scope', 'openid HCHB.api.scope agency.identity hchb.identity');
        params.append('resource_security_id', resourceSecurityId);
        params.append('agency_secret', agencySecret);

        console.log('[FHIR] Token request to:', tokenUrl);

        const response = await axios.post(tokenUrl, params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const { access_token, expires_in } = response.data;

        if (!access_token) {
            console.error('[FHIR] Token response:', response.data);
            throw new Error('No access_token in response');
        }

        // Cache the token
        tokenCache.accessToken = access_token;
        tokenCache.expiresAt = Date.now() + (expires_in * 1000);

        console.log('[FHIR] Access token obtained successfully, expires in', expires_in, 'seconds');
        return access_token;

    } catch (error) {
        console.error('[FHIR] Token request failed:', error.response?.data || error.message);
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

    const url = `${baseUrl}${endpoint}`;
    console.log(`[FHIR] GET ${url}`, params);

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
        console.error('[FHIR] GET request failed:', error.response?.status, error.response?.data || error.message);
        
        // If unauthorized, clear token cache and retry once
        if (error.response?.status === 401) {
            console.log('[FHIR] Token expired, clearing cache and retrying...');
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
 * Make authenticated POST request to FHIR API
 * @param {string} endpoint - API endpoint
 * @param {object} data - Request body
 * @returns {Promise<object>} FHIR response data
 */
async function fhirPost(endpoint, data) {
    const token = await getAccessToken();
    const baseUrl = process.env.HCHB_API_BASE_URL;

    const url = `${baseUrl}${endpoint}`;
    console.log(`[FHIR] POST ${url}`);

    try {
        const response = await axios.post(url, data, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/fhir+json',
                'Accept': 'application/fhir+json'
            }
        });

        return response.data;

    } catch (error) {
        console.error('[FHIR] POST request failed:', error.response?.data || error.message);
        
        // If unauthorized, clear token cache and retry once
        if (error.response?.status === 401) {
            console.log('[FHIR] Token expired, clearing cache and retrying...');
            tokenCache.accessToken = null;
            tokenCache.expiresAt = null;
            
            const newToken = await getAccessToken();
            const retryResponse = await axios.post(url, data, {
                headers: {
                    'Authorization': `Bearer ${newToken}`,
                    'Content-Type': 'application/fhir+json',
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
    console.log('[FHIR] Token cache cleared');
}

/**
 * Test the FHIR connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testConnection() {
    try {
        console.log('[FHIR] Testing connection...');
        await getAccessToken();
        
        // Try a simple metadata request
        const baseUrl = process.env.HCHB_API_BASE_URL;
        const token = tokenCache.accessToken;
        
        const response = await axios.get(`${baseUrl}/metadata`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/fhir+json'
            }
        });
        
        console.log('[FHIR] Connection successful! FHIR version:', response.data.fhirVersion);
        return true;
        
    } catch (error) {
        console.error('[FHIR] Connection test failed:', error.response?.data || error.message);
        return false;
    }
}

/**
 * Get current token status (for debugging)
 */
function getTokenStatus() {
    if (!tokenCache.accessToken) {
        return { status: 'none', message: 'No token cached' };
    }
    
    const now = Date.now();
    const expiresIn = Math.round((tokenCache.expiresAt - now) / 1000);
    
    if (expiresIn <= 0) {
        return { status: 'expired', message: 'Token expired' };
    }
    
    return { 
        status: 'valid', 
        message: `Token valid for ${expiresIn} seconds`,
        expiresIn 
    };
}

module.exports = {
    getAccessToken,
    fhirGet,
    fhirPost,
    clearTokenCache,
    testConnection,
    getTokenStatus
};
