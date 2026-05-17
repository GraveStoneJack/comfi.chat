# User React Migration Plan

## Goal
Move the unfinished user-facing app flows into React while keeping the working admin portal isolated and preserving the current static landing page until it needs a redesign.

## Scope
- Keep `admin-client` and `admin-dist` dedicated to the admin portal.
- Add `user-client` and `user-dist` for signup, verification, profile, and eventually chat.
- Keep the current homepage static for now.
- Move chat after the account/profile flow is reliable.

## Milestones
1. User React foundation
   - Add a Vite React app for user-facing routes.
   - Add shared API, session, theme, and navigation helpers.
   - Serve the built app from Express routes such as `/signup`, `/verify`, `/profile`, and `/app`.

2. Account and profile flow
   - Rebuild email signup, email verification, and profile completion in React.
   - Restore authenticated sessions from `sessionStorage`.
   - Support editing an existing profile through `/api/users/me`.
   - Keep Google and Apple entry points visible but clearly marked as not configured until backend OAuth is completed.

3. Chat migration
   - Extract the current chat behavior into React state: connection status, online users, active chats, unread state, messages, media, blocking, reports, filters, and preferences.
   - Use `docs/react-chat-state-map.md` and `user-client/src/chat/state.js` as the parity map before rebuilding the UI.
   - Keep API/WebSocket behavior compatible with the existing backend first.
   - Replace the legacy `chat.html` route only after the React chat reaches feature parity.

4. Cleanup
   - Remove legacy profile/signup/verify scripts after React routes are confirmed.
   - Decide whether to migrate the static landing page into React or keep it as a lightweight marketing page.

## Current Slice
This branch starts with milestone 1 and the first part of milestone 2: React signup, verify, and profile screens.
