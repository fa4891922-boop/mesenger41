export function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const dateCache = new Map();

export function formatDate(timestamp) {
  if (!timestamp) return '';
  const key = new Date(timestamp).toDateString();
  if (dateCache.has(key)) return dateCache.get(key);

  const d = new Date(timestamp);
  const now = new Date();
  const diff = now - d;
  const dayMs = 86400000;
  let result;
  if (diff < dayMs && d.getDate() === now.getDate()) {
    result = 'Сегодня';
  } else if (diff < dayMs * 2 && d.getDate() === now.getDate() - 1) {
    result = 'Вчера';
  } else {
    result = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  if (dateCache.size > 100) dateCache.clear();
  dateCache.set(key, result);
  return result;
}
