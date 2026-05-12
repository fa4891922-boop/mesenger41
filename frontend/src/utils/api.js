export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

export function apiFetch(path, token, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  return fetch(`${BACKEND_URL}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
  });
}
