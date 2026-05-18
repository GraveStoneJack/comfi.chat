export function getApiBase() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (window.location.hostname === 'localhost' && window.location.port === '5174') {
    return 'http://localhost:10000';
  }
  if (window.location.hostname === 'comfi.chat') {
    return 'https://luxeonchat-backend.onrender.com';
  }
  return '';
}

export function getWebSocketUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/^http/i, 'ws');
  }
  if (window.location.hostname === 'localhost' && window.location.port === '5174') {
    return 'ws://localhost:10000';
  }
  if (window.location.hostname === 'comfi.chat') {
    return 'wss://luxeonchat-backend.onrender.com';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export const CHAT_TIMING = {
  rosterPollMs: 3000,
  presenceRefreshMs: 60000,
  heartbeatMs: 25000,
  reconnectBaseMs: 1000,
  reconnectMaxMs: 30000
};
