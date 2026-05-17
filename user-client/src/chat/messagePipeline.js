import { isDeleteImageToken, isImageMessage, stripDeleteToken, stripImageToken } from './state.js';

const EMOTICONS = new Map([
  [':)', '😊'],
  [':-)', '😊'],
  [':(', '☹️'],
  [':-(', '☹️'],
  [';)', '😉'],
  [';-)', '😉'],
  [':D', '😄'],
  [':-D', '😄'],
  ['<3', '❤️']
]);

export function convertEmoticonsToEmoji(message) {
  let result = message || '';
  for (const [token, emoji] of EMOTICONS.entries()) {
    result = result.split(token).join(emoji);
  }
  return result;
}

export function createClientMessage({ sender, recipient, message }) {
  return {
    clientId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sender,
    recipient,
    message: convertEmoticonsToEmoji(message.trim()),
    timestamp: new Date().toISOString(),
    status: 'pending'
  };
}

export function createImageMessage(url) {
  return `[image]${url}`;
}

export function createDeleteImageMessage(url, reason = 'manual') {
  return `[delete-image|${reason}]${url}`;
}

export function resolveImageUrl(message, origin = window.location.origin) {
  const raw = stripImageToken(message);
  if (!raw) return '';
  if (/^data:image\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  const suffix = raw.startsWith('/') ? raw : `/${raw}`;
  return `${origin}${suffix}`;
}

export function getImageCandidates(message, origin = window.location.origin) {
  if (!isImageMessage(message)) return [];
  const raw = stripImageToken(message);
  if (!raw) return [];
  if (/^data:image\//i.test(raw)) return [raw];
  const candidates = [];
  if (/^https?:\/\//i.test(raw)) candidates.push(raw);
  else candidates.push(`${origin}${raw.startsWith('/') ? raw : `/${raw}`}`);
  candidates.push(`${origin}/api/upload/resolve?src=${encodeURIComponent(raw)}`);
  return Array.from(new Set(candidates));
}

export function describeDeleteReason(message) {
  if (!isDeleteImageToken(message)) return '';
  const match = /^\[delete-image(?:\|(expired|manual))?\]/.exec(message || '');
  return match?.[1] === 'expired' ? 'Image expired' : 'Message removed';
}

export function parseDeleteImageToken(message) {
  if (!isDeleteImageToken(message)) return null;
  return {
    url: stripDeleteToken(message),
    reason: describeDeleteReason(message)
  };
}

export function sanitizeText(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}
