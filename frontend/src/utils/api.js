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

export function apiFetch(path, token, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  if (!BACKEND_URL && !import.meta.env.DEV) {
    return Promise.reject(new Error('Backend URL is not configured. Set VITE_BACKEND_URL before building the app.'));
  }

  return fetch(`${BACKEND_URL}${path}`, {
    ...rest,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
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
