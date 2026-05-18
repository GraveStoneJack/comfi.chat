import { CHAT_STORAGE_KEYS } from './state.js';

export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

export function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function readSessionJson(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

export function writeSessionJson(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

export function getDeviceId() {
  let id = localStorage.getItem(CHAT_STORAGE_KEYS.deviceId);
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CHAT_STORAGE_KEYS.deviceId, id);
  }
  return id;
}

export function restoreChatSession() {
  const registeredUser = readSessionJson(CHAT_STORAGE_KEYS.user, null);
  const tempUser = readSessionJson(CHAT_STORAGE_KEYS.tempUser, null);
  return {
    currentUser: tempUser || (registeredUser ? { username: registeredUser.username, ...registeredUser } : null),
    authToken: sessionStorage.getItem(CHAT_STORAGE_KEYS.authToken) || '',
    deviceId: getDeviceId()
  };
}

export function clearChatSession() {
  sessionStorage.removeItem(CHAT_STORAGE_KEYS.tempUser);
  sessionStorage.removeItem(CHAT_STORAGE_KEYS.user);
  sessionStorage.removeItem(CHAT_STORAGE_KEYS.authToken);
}

export function clearLocalChatState(username) {
  if (!username) return;
  localStorage.removeItem(CHAT_STORAGE_KEYS.blocklist(username));
  localStorage.removeItem(CHAT_STORAGE_KEYS.hiddenChats(username));
}

export function loadPreferences() {
  return {
    notifications: false,
    soundEnabled: true,
    theme: localStorage.getItem('comfi.theme') || 'auto',
    fontSize: 'medium',
    ...readJson(CHAT_STORAGE_KEYS.preferences, {}),
    recentEmojis: readJson(CHAT_STORAGE_KEYS.recentEmojis, [])
  };
}

export function savePreferences(preferences) {
  const { recentEmojis, ...rest } = preferences;
  writeJson(CHAT_STORAGE_KEYS.preferences, rest);
  if (recentEmojis) writeJson(CHAT_STORAGE_KEYS.recentEmojis, recentEmojis);
  if (rest.theme) localStorage.setItem('comfi.theme', rest.theme);
}

export function loadBlockedDevices(username) {
  if (!username) return [];
  return readJson(CHAT_STORAGE_KEYS.blocklist(username), []);
}

export function saveBlockedDevices(username, deviceIds) {
  if (!username) return;
  writeJson(CHAT_STORAGE_KEYS.blocklist(username), Array.from(new Set(deviceIds.filter(Boolean))));
}

export function loadHiddenChats(username) {
  if (!username) return [];
  return readJson(CHAT_STORAGE_KEYS.hiddenChats(username), []);
}

export function saveHiddenChats(username, hiddenUsernames) {
  if (!username) return;
  writeJson(CHAT_STORAGE_KEYS.hiddenChats(username), Array.from(new Set(hiddenUsernames.filter(Boolean))));
}
