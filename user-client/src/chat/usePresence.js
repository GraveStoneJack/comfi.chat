import { useEffect } from 'react';
import { CHAT_TIMING } from './config.js';
import { sendPresenceBeacon, setPresence } from './api.js';

export function usePresence({ currentUser, deviceId, enabled = true }) {
  useEffect(() => {
    if (!enabled || !currentUser?.username) return undefined;
    const username = currentUser.username;

    setPresence(username, { isOnline: true, deviceId }).catch(() => {});

    const refresh = window.setInterval(() => {
      setPresence(username, { isOnline: true, deviceId }).catch(() => {});
    }, CHAT_TIMING.presenceRefreshMs);

    function markOffline() {
      sendPresenceBeacon(username, { isOnline: false, deviceId });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        markOffline();
      } else {
        setPresence(username, { isOnline: true, deviceId }).catch(() => {});
      }
    }

    window.addEventListener('pagehide', markOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(refresh);
      window.removeEventListener('pagehide', markOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      markOffline();
    };
  }, [currentUser?.username, deviceId, enabled]);
}
