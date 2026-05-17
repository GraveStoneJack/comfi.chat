import { getApiBase } from './config.js';

export async function request(path, options = {}) {
  const headers = options.body instanceof FormData
    ? { ...(options.headers || {}) }
    : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(`${getApiBase()}${path}`, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error((payload && payload.error) || payload || 'Request failed');
  }
  return payload;
}

export function setPresence(username, { isOnline, deviceId }, options = {}) {
  return request(`/api/temp-users/status/${encodeURIComponent(username)}`, {
    method: 'PUT',
    body: JSON.stringify({ isOnline, deviceId }),
    ...options
  });
}

export function sendPresenceBeacon(username, { isOnline, deviceId }) {
  const body = JSON.stringify({ isOnline, deviceId });
  const url = `${getApiBase()}/api/temp-users/status/${encodeURIComponent(username)}`;
  if (navigator.sendBeacon) {
    return navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true
  }).catch(() => {});
  return true;
}

export function fetchOnlineUsers() {
  return request('/api/temp-users/online');
}

export function fetchHistory(userA, userB) {
  return request(`/api/messages/history/${encodeURIComponent(userA)}/${encodeURIComponent(userB)}`);
}

export function uploadChatImage(file, username) {
  const body = new FormData();
  body.append('file', file);
  const suffix = username ? `?u=${encodeURIComponent(username)}` : '';
  return request(`/api/upload${suffix}`, { method: 'POST', body });
}

export function createReport(payload) {
  return request('/api/reports/create', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function recordBlock(payload) {
  return request('/api/reports/block', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function logoff(username) {
  return request(`/api/logoff/${encodeURIComponent(username)}`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}
