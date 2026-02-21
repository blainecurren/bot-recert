/**
 * API Client
 * Axios instance with MSAL token interceptor.
 * All API calls go through this client to get auto-attached Bearer tokens.
 */

import axios from 'axios';
import { msalInstance, loginRequest } from './msal';

const api = axios.create({
  baseURL: '/api',
});

// Attach Bearer token to every request
api.interceptors.request.use(async (config) => {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    try {
      const response = await msalInstance.acquireTokenSilent({
        ...loginRequest,
        account: accounts[0],
      });
      config.headers.Authorization = `Bearer ${response.accessToken}`;
    } catch {
      // Token acquisition failed — let the request proceed without auth
      // The API will return 401 and the UI can handle re-login
    }
  }
  return config;
});

export default api;
