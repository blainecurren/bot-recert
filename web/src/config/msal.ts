/**
 * MSAL Configuration for Entra ID Authentication
 *
 * Uses PKCE flow (PublicClientApplication) for the SPA.
 * HIPAA: sessionStorage used so tokens clear on tab close.
 *
 * Replace placeholder values with your Entra ID app registration.
 */

import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

const TENANT_ID = import.meta.env.VITE_ENTRA_TENANT_ID || 'your-tenant-id';
const CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID || 'your-client-id';
const API_SCOPE = import.meta.env.VITE_ENTRA_API_SCOPE || `api://${CLIENT_ID}/access_as_user`;

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    // HIPAA: sessionStorage clears on tab close
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: [API_SCOPE],
};

export const msalInstance = new PublicClientApplication(msalConfig);
