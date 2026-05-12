import { BACKEND_URL } from './api';
const MAX_BUFFER = 200;

const buffer = [];

export function diagLog(area, event, metadata = {}) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      area,
      event,
      ...metadata,
    };
    buffer.push(entry);
    if (buffer.length > MAX_BUFFER) buffer.shift();
  } catch { /* never crash */ }
}

export function getBuffer() {
  return [...buffer];
}

export function reportError(error, context = {}) {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;

    const payload = {
      timestamp: new Date().toISOString(),
      component: context.component || null,
      action: context.action || null,
      screen: context.screen || null,
      errorMessage: error?.message?.slice(0, 500) || String(error).slice(0, 500),
      stack: error?.stack?.slice(0, 2000) || null,
      browser: navigator.userAgent?.slice(0, 200) || null,
      metadata: context.metadata || null,
    };

    fetch(`${BACKEND_URL}/api/admin/diagnostics/frontend-error`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {});

    diagLog('frontend', 'error_reported', { errorMessage: payload.errorMessage, component: payload.component });
  } catch { /* never crash */ }
}
