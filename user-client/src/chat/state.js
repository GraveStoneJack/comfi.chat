export const CHAT_STORAGE_KEYS = {
  deviceId: 'comfi.deviceId',
  user: 'user',
  authToken: 'authToken',
  tempUser: 'tempUser',
  preferences: 'chatPreferences',
  recentEmojis: 'comfi.recentEmojis',
  blocklist: username => `comfi.blocklist.${username}`,
  hiddenChats: username => `comfi.hiddenChats.${username}`
};

export const CHAT_STATUS = {
  idle: 'idle',
  connecting: 'connecting',
  connected: 'connected',
  disconnected: 'disconnected',
  reconnecting: 'reconnecting',
  error: 'error'
};

export const CHAT_TABS = {
  online: 'online',
  chats: 'chats'
};

export const CHAT_ACTIONS = {
  sessionRestored: 'chat/sessionRestored',
  sessionCleared: 'chat/sessionCleared',
  connectionChanged: 'chat/connectionChanged',
  rosterLoaded: 'chat/rosterLoaded',
  filtersChanged: 'chat/filtersChanged',
  blockedDevicesLoaded: 'chat/blockedDevicesLoaded',
  hiddenChatsLoaded: 'chat/hiddenChatsLoaded',
  chatOpened: 'chat/chatOpened',
  chatClosed: 'chat/chatClosed',
  historyLoaded: 'chat/historyLoaded',
  messageReceived: 'chat/messageReceived',
  messageSentOptimistic: 'chat/messageSentOptimistic',
  messageSendFailed: 'chat/messageSendFailed',
  messageDeleted: 'chat/messageDeleted',
  chatMarkedRead: 'chat/chatMarkedRead',
  peerBlocked: 'chat/peerBlocked',
  chatHidden: 'chat/chatHidden',
  uploadChanged: 'chat/uploadChanged',
  imageExpiryScheduled: 'chat/imageExpiryScheduled',
  imageExpiryCleared: 'chat/imageExpiryCleared',
  preferencesLoaded: 'chat/preferencesLoaded',
  preferencesChanged: 'chat/preferencesChanged',
  uiChanged: 'chat/uiChanged',
  reportChanged: 'chat/reportChanged'
};

export const initialChatState = {
  session: {
    currentUser: null,
    authToken: '',
    deviceId: ''
  },
  connection: {
    status: CHAT_STATUS.idle,
    reconnectAttempts: 0,
    lastConnectedAt: null,
    lastError: ''
  },
  presence: {
    isOnline: false,
    lastHeartbeatAt: null,
    lastStatusSyncAt: null
  },
  roster: {
    users: [],
    usernameToDeviceId: {},
    loading: false,
    error: '',
    lastLoadedAt: null,
    filters: {
      gender: 'all',
      country: 'all',
      ageMin: '',
      ageMax: ''
    }
  },
  conversations: {
    byUsername: {},
    order: [],
    activeUsername: null,
    hiddenUsernames: [],
    blockedDeviceIds: []
  },
  media: {
    pendingFile: null,
    uploadStatus: 'idle',
    uploadError: '',
    imageExpiryByUrl: {}
  },
  moderation: {
    reportOpen: false,
    reportTarget: null,
    reportStatus: 'idle',
    reportError: ''
  },
  preferences: {
    notifications: false,
    soundEnabled: true,
    theme: 'auto',
    fontSize: 'medium',
    recentEmojis: []
  },
  ui: {
    activeTab: CHAT_TABS.online,
    sidebarOpen: false,
    lightboxUrl: '',
    imageSettingsOpen: false,
    emojiOpen: false,
    searchOpen: false,
    searchQuery: '',
    connectionBannerVisible: false
  }
};

export function chatReducer(state = initialChatState, action) {
  switch (action.type) {
    case CHAT_ACTIONS.sessionRestored:
      return {
        ...state,
        session: {
          ...state.session,
          currentUser: action.payload.currentUser || null,
          authToken: action.payload.authToken || '',
          deviceId: action.payload.deviceId || ''
        }
      };
    case CHAT_ACTIONS.sessionCleared:
      return {
        ...state,
        session: initialChatState.session,
        presence: initialChatState.presence,
        connection: { ...initialChatState.connection, status: CHAT_STATUS.disconnected }
      };
    case CHAT_ACTIONS.connectionChanged:
      return {
        ...state,
        connection: {
          ...state.connection,
          ...action.payload,
          lastConnectedAt: action.payload.status === CHAT_STATUS.connected ? Date.now() : state.connection.lastConnectedAt
        },
        ui: {
          ...state.ui,
          connectionBannerVisible: action.payload.status !== CHAT_STATUS.connected
        }
      };
    case CHAT_ACTIONS.rosterLoaded:
      return applyRoster(state, action.payload.users || []);
    case CHAT_ACTIONS.filtersChanged:
      return {
        ...state,
        roster: {
          ...state.roster,
          filters: { ...state.roster.filters, ...action.payload }
        }
      };
    case CHAT_ACTIONS.blockedDevicesLoaded:
      return {
        ...state,
        conversations: {
          ...state.conversations,
          blockedDeviceIds: action.payload.deviceIds || []
        }
      };
    case CHAT_ACTIONS.hiddenChatsLoaded:
      return {
        ...state,
        conversations: {
          ...state.conversations,
          hiddenUsernames: action.payload.usernames || []
        }
      };
    case CHAT_ACTIONS.chatOpened:
      return openConversation(state, action.payload.peer);
    case CHAT_ACTIONS.chatClosed:
      return {
        ...state,
        conversations: {
          ...state.conversations,
          activeUsername: null
        }
      };
    case CHAT_ACTIONS.historyLoaded:
      return mergeHistory(state, action.payload.username, action.payload.messages || []);
    case CHAT_ACTIONS.messageReceived:
    case CHAT_ACTIONS.messageSentOptimistic:
      return upsertMessage(state, normalizeIncomingMessage(action.payload.message), {
        markUnread: action.type === CHAT_ACTIONS.messageReceived
      });
    case CHAT_ACTIONS.messageSendFailed:
      return markMessageFailed(state, action.payload);
    case CHAT_ACTIONS.messageDeleted:
      return markImageDeleted(state, action.payload);
    case CHAT_ACTIONS.chatMarkedRead:
      return patchConversation(state, action.payload.username, { unread: false });
    case CHAT_ACTIONS.peerBlocked:
      return blockPeer(state, action.payload);
    case CHAT_ACTIONS.chatHidden:
      return hideConversation(state, action.payload.username);
    case CHAT_ACTIONS.uploadChanged:
      return {
        ...state,
        media: { ...state.media, ...action.payload }
      };
    case CHAT_ACTIONS.imageExpiryScheduled:
      return {
        ...state,
        media: {
          ...state.media,
          imageExpiryByUrl: {
            ...state.media.imageExpiryByUrl,
            [action.payload.url]: action.payload.expiresAt
          }
        }
      };
    case CHAT_ACTIONS.imageExpiryCleared: {
      const imageExpiryByUrl = { ...state.media.imageExpiryByUrl };
      delete imageExpiryByUrl[action.payload.url];
      return { ...state, media: { ...state.media, imageExpiryByUrl } };
    }
    case CHAT_ACTIONS.preferencesLoaded:
    case CHAT_ACTIONS.preferencesChanged:
      return {
        ...state,
        preferences: { ...state.preferences, ...action.payload }
      };
    case CHAT_ACTIONS.uiChanged:
      return {
        ...state,
        ui: { ...state.ui, ...action.payload }
      };
    case CHAT_ACTIONS.reportChanged:
      return {
        ...state,
        moderation: { ...state.moderation, ...action.payload }
      };
    default:
      return state;
  }
}

export function getActiveConversation(state) {
  const username = state.conversations.activeUsername;
  return username ? state.conversations.byUsername[username] || null : null;
}

export function getVisibleRoster(state) {
  const { gender, country, ageMin, ageMax } = state.roster.filters;
  const blocked = new Set(state.conversations.blockedDeviceIds);
  const currentUsername = state.session.currentUser?.username;
  return state.roster.users.filter(user => {
    if (!user || user.username === currentUsername) return false;
    if (user.deviceId && blocked.has(user.deviceId)) return false;
    if (gender !== 'all' && user.gender !== gender) return false;
    if (country !== 'all' && user.country !== country) return false;
    if (ageMin && Number(user.age) < Number(ageMin)) return false;
    if (ageMax && Number(user.age) > Number(ageMax)) return false;
    return true;
  });
}

export function getVisibleConversations(state) {
  const hidden = new Set(state.conversations.hiddenUsernames);
  return state.conversations.order
    .map(username => state.conversations.byUsername[username])
    .filter(conversation => conversation && !hidden.has(conversation.username));
}

export function conversationForPeer(peer) {
  return {
    username: peer.username,
    profile: peer,
    messages: [],
    lastMessage: '',
    lastTimestamp: null,
    unread: false
  };
}

export function isImageMessage(message) {
  return typeof message === 'string' && (
    message.startsWith('[image]') ||
    /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(message)
  );
}

export function isDeleteImageToken(message) {
  return typeof message === 'string' && message.startsWith('[delete-image');
}

export function stripImageToken(message) {
  if (!message) return '';
  if (message.startsWith('[image]')) return message.substring(7).trim();
  return message.trim();
}

export function stripDeleteToken(message) {
  return String(message || '').replace(/^\[delete-image(?:\|(expired|manual))?\]/, '').trim();
}

export function previewLabel(message, sender, currentUsername) {
  if (isDeleteImageToken(message)) return 'Message removed';
  if (isImageMessage(message)) return sender === currentUsername ? 'You sent a photo' : 'Photo';
  return message || '';
}

function applyRoster(state, users) {
  const usernameToDeviceId = {};
  for (const user of users) {
    if (user.username && user.deviceId) usernameToDeviceId[user.username] = user.deviceId;
  }
  return {
    ...state,
    roster: {
      ...state.roster,
      users,
      usernameToDeviceId,
      loading: false,
      error: '',
      lastLoadedAt: Date.now()
    }
  };
}

function openConversation(state, peer) {
  if (!peer?.username) return state;
  const existing = state.conversations.byUsername[peer.username] || conversationForPeer(peer);
  return {
    ...state,
    conversations: {
      ...state.conversations,
      activeUsername: peer.username,
      byUsername: {
        ...state.conversations.byUsername,
        [peer.username]: { ...existing, profile: { ...existing.profile, ...peer }, unread: false }
      },
      order: moveUsernameToFront(state.conversations.order, peer.username)
    },
    ui: {
      ...state.ui,
      activeTab: CHAT_TABS.chats,
      sidebarOpen: false
    }
  };
}

function mergeHistory(state, username, messages) {
  if (!username) return state;
  const conversation = state.conversations.byUsername[username] || conversationForPeer({ username });
  const merged = dedupeMessages([...conversation.messages, ...messages.map(normalizeIncomingMessage)]);
  return patchConversation(state, username, {
    messages: merged,
    lastMessage: merged.length ? previewLabel(merged[merged.length - 1].message, merged[merged.length - 1].sender, state.session.currentUser?.username) : conversation.lastMessage,
    lastTimestamp: merged.length ? merged[merged.length - 1].timestamp : conversation.lastTimestamp
  });
}

function upsertMessage(state, message, { markUnread }) {
  const currentUsername = state.session.currentUser?.username;
  const otherUsername = message.sender === currentUsername ? message.recipient : message.sender;
  if (!otherUsername) return state;
  const conversation = state.conversations.byUsername[otherUsername] || conversationForPeer({ username: otherUsername });
  const messages = dedupeMessages([...conversation.messages, message]);
  const unread = markUnread && state.conversations.activeUsername !== otherUsername ? true : conversation.unread;
  return {
    ...state,
    conversations: {
      ...state.conversations,
      byUsername: {
        ...state.conversations.byUsername,
        [otherUsername]: {
          ...conversation,
          messages,
          lastMessage: previewLabel(message.message, message.sender, currentUsername),
          lastTimestamp: message.timestamp,
          unread
        }
      },
      order: moveUsernameToFront(state.conversations.order, otherUsername)
    }
  };
}

function patchConversation(state, username, patch) {
  const conversation = state.conversations.byUsername[username] || conversationForPeer({ username });
  return {
    ...state,
    conversations: {
      ...state.conversations,
      byUsername: {
        ...state.conversations.byUsername,
        [username]: { ...conversation, ...patch }
      },
      order: state.conversations.order.includes(username)
        ? state.conversations.order
        : [...state.conversations.order, username]
    }
  };
}

function markMessageFailed(state, { username, clientId, error }) {
  const conversation = state.conversations.byUsername[username];
  if (!conversation) return state;
  return patchConversation(state, username, {
    messages: conversation.messages.map(message => (
      message.clientId === clientId ? { ...message, status: 'failed', error } : message
    ))
  });
}

function markImageDeleted(state, { username, imageUrl, reason }) {
  const conversation = state.conversations.byUsername[username];
  if (!conversation) return state;
  return patchConversation(state, username, {
    messages: conversation.messages.map(message => {
      if (stripImageToken(message.message) !== imageUrl) return message;
      return { ...message, deleted: true, deleteReason: reason || 'manual' };
    })
  });
}

function blockPeer(state, { username, deviceId }) {
  const blockedDeviceIds = deviceId && !state.conversations.blockedDeviceIds.includes(deviceId)
    ? [...state.conversations.blockedDeviceIds, deviceId]
    : state.conversations.blockedDeviceIds;
  return {
    ...hideConversation(state, username),
    conversations: {
      ...state.conversations,
      ...hideConversation(state, username).conversations,
      blockedDeviceIds
    }
  };
}

function hideConversation(state, username) {
  if (!username) return state;
  const hiddenUsernames = state.conversations.hiddenUsernames.includes(username)
    ? state.conversations.hiddenUsernames
    : [...state.conversations.hiddenUsernames, username];
  return {
    ...state,
    conversations: {
      ...state.conversations,
      hiddenUsernames,
      activeUsername: state.conversations.activeUsername === username ? null : state.conversations.activeUsername
    }
  };
}

function normalizeIncomingMessage(message) {
  return {
    id: message._id || message.id || '',
    clientId: message.clientId || '',
    sender: message.sender || '',
    recipient: message.recipient || '',
    message: message.message || '',
    timestamp: message.timestamp || new Date().toISOString(),
    status: message.status || 'sent'
  };
}

function dedupeMessages(messages) {
  const seen = new Set();
  const result = [];
  for (const message of messages) {
    const key = messageKey(message);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(message);
  }
  return result.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function messageKey(message) {
  if (message.id) return `id:${message.id}`;
  if (message.clientId) return `client:${message.clientId}`;
  return [message.sender, message.recipient, message.message, new Date(message.timestamp).getTime()].join('|');
}

function moveUsernameToFront(order, username) {
  return [username, ...order.filter(item => item !== username)];
}
