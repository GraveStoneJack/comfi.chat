import { useEffect } from 'react';
import { fetchOnlineUsers } from './api.js';
import { CHAT_TIMING } from './config.js';
import { CHAT_ACTIONS } from './state.js';

export function useOnlineRoster({ dispatch, enabled = true }) {
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    async function loadRoster() {
      try {
        const users = await fetchOnlineUsers();
        if (!cancelled) {
          dispatch({ type: CHAT_ACTIONS.rosterLoaded, payload: { users } });
        }
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: CHAT_ACTIONS.uiChanged,
            payload: { rosterError: error.message || 'Failed to load online users' }
          });
        }
      }
    }

    loadRoster();
    const timer = window.setInterval(loadRoster, CHAT_TIMING.rosterPollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dispatch, enabled]);
}
