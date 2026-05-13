import { Capacitor } from '@capacitor/core';

const isAndroid = Capacitor.getPlatform() === 'android';
const isDevMode = import.meta.env.DEV || import.meta.env.MODE === 'android-debug';

function normalizeBackendUrl(url) {
  return url?.trim().replace(/\/+$/, '');
}

function resolveBackendUrl() {
  const configuredUrl = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL);
  if (configuredUrl) return configuredUrl;

  if (isAndroid && isDevMode) {
    return 'http://10.0.2.2:3000';
  }

  return '';
}

export const BACKEND_URL = resolveBackendUrl();

let accessToken = null;
let refreshToken = localStorage.getItem('refreshToken');
let onTokenRefreshed = null;
let refreshPromise = null;

export function setTokens(access, refresh) {
  accessToken = access;
  refreshToken = refresh;
  if (refresh) {
    localStorage.setItem('refreshToken', refresh);
  } else {
    localStorage.removeItem('refreshToken');
  }
}

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken() {
  return refreshToken;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('refreshToken');
}

export function setOnTokenRefreshed(callback) {
  onTokenRefreshed = callback;
}

async function doRefresh() {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BACKEND_URL}/api/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    if (onTokenRefreshed) onTokenRefreshed(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function apiFetch(path, token, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  if (!BACKEND_URL && !import.meta.env.DEV) {
    return Promise.reject(new Error('Backend URL is not configured. Set VITE_BACKEND_URL before building the app.'));
  }

  const effectiveToken = token || accessToken;

  return fetch(`${BACKEND_URL}${path}`, {
    ...rest,
    headers: {
      ...(effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {}),
      ...extraHeaders,
    },
  }).then(async (res) => {
    if (res.status === 401 && refreshToken && path !== '/api/refresh' && path !== '/api/login' && path !== '/api/register') {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return fetch(`${BACKEND_URL}${path}`, {
          ...rest,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...extraHeaders,
          },
        });
      }
    }
    return res;
  });
}

export async function readJsonResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    const preview = text.trim().slice(0, 120);
    throw new Error(`Expected JSON response, got ${contentType || 'unknown content type'}${preview ? `: ${preview}` : ''}`);
  }

  return res.json();
}
