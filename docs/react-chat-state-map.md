# React Chat State Map

This is the parity map for replacing `chat.html` and `chat.js` with the React user app. The first implementation step is to make the current implicit DOM state explicit, then rebuild the UI on top of the reducer and hooks.

## State Domains

| Domain | State | Legacy source |
| --- | --- | --- |
| Session | `currentUser`, `authToken`, `deviceId` | `sessionStorage.user`, `sessionStorage.authToken`, `sessionStorage.tempUser`, `localStorage.comfi.deviceId` |
| Connection | socket status, reconnect attempts, last error | `socket`, `reconnectAttempts`, `heartbeatTimer` |
| Presence | online flag, status sync timestamps | `/api/temp-users/status/:username`, `beforeunload` offline update |
| Roster | online users, filters, username-to-device map | `/api/temp-users/online`, gender/country/age controls |
| Conversations | `byUsername`, order, active peer, unread flags, hidden chats, blocklist | `activeChats`, `currentChatUser`, `comfi.hiddenChats.*`, `comfi.blocklist.*` |
| Media | pending file, upload status, image expiry timers | `/api/upload`, `[image]`, `[delete-image|manual]`, `[delete-image|expired]` |
| Moderation | report modal, block/report state | `/api/reports/create`, `/api/reports/block` |
| Preferences | notifications, sound, theme, font size, recent emojis | `chatPreferences`, `comfi.theme`, `comfi.recentEmojis` |
| UI | active tab, sidebar, modals, lightbox, emoji/search panels | DOM classes and event listeners in `chat.js` |

## Network Contracts

### WebSocket

Connect to the configured websocket URL and send:

```json
{ "type": "identify", "username": "alice" }
```

Send messages with:

```json
{ "type": "message", "sender": "alice", "recipient": "bob", "message": "hello" }
```

The message field currently carries plain text, image tokens like `[image]/uploads/file.jpg`, and delete tokens like `[delete-image|manual]https://...`.

The server echoes messages to the sender and forwards to the recipient. React state must dedupe messages.

### REST

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `PUT`/`POST` | `/api/temp-users/status/:username` | Presence updates |
| `GET` | `/api/temp-users/online` | Online roster polling |
| `GET` | `/api/messages/history/:userA/:userB` | Conversation history |
| `POST` | `/api/upload` | Image upload |
| `POST` | `/api/reports/create` | Create report |
| `POST` | `/api/reports/block` | Persist block action |
| `POST` | `/api/logoff/:username` | Explicit logout/offline event |

## Reducer Boundary

The reducer in `user-client/src/chat/state.js` owns only serializable app state. Timers, sockets, audio, notifications, fetches, file compression, and browser storage remain in hooks/services that dispatch reducer actions.

Recommended next files:

- `user-client/src/chat/api.js`: REST calls.
- `user-client/src/chat/storage.js`: storage key reads/writes.
- `user-client/src/chat/useChatSocket.js`: websocket lifecycle, backoff, heartbeat, inbound dispatch.
- `user-client/src/chat/usePresence.js`: online/offline lifecycle with `sendBeacon` or `fetch(..., { keepalive: true })`.
- `user-client/src/chat/useOnlineRoster.js`: roster polling and dispatch.
- `user-client/src/chat/messagePipeline.js`: image/delete token parsing, preview labels, emoticon conversion, sanitization.

## Parity Decisions

- Replace synchronous `beforeunload` XHR with `visibilitychange`, `pagehide`, and `sendBeacon`/keepalive fetch.
- Fix the legacy filter bug where `applyFilters` computes filtered users but `updateOnlineUsers` ignores the argument.
- Keep legacy chat available at `/chat` until the React chat reaches feature parity.
- Keep data URL image fallback only as a temporary compatibility path; uploaded files should remain the preferred path.
- Remove the unused legacy `ConnectionManager` instead of porting it.
- Keep hidden chats and blocklists local for now, but route block actions through `/api/reports/block` for admin visibility.
