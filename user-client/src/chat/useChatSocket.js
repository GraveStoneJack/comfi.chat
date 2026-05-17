import { useEffect, useRef } from 'react';
import { CHAT_ACTIONS, CHAT_STATUS } from './state.js';
import { CHAT_TIMING, getWebSocketUrl } from './config.js';

export function useChatSocket({ currentUser, authToken, dispatch, enabled = true }) {
  const socketRef = useRef(null);
  const heartbeatRef = useRef(null);
  const reconnectRef = useRef(null);
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!enabled || !currentUser?.username) return undefined;
    let cancelled = false;

    function cleanupSocket() {
      window.clearInterval(heartbeatRef.current);
      window.clearTimeout(reconnectRef.current);
      heartbeatRef.current = null;
      reconnectRef.current = null;
      if (socketRef.current) {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onerror = null;
        socketRef.current.onclose = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    }

    function scheduleReconnect() {
      if (cancelled) return;
      const delay = Math.min(
        CHAT_TIMING.reconnectMaxMs,
        Math.round(CHAT_TIMING.reconnectBaseMs * Math.pow(1.5, Math.max(1, attemptsRef.current)))
      );
      attemptsRef.current += 1;
      dispatch({
        type: CHAT_ACTIONS.connectionChanged,
        payload: { status: CHAT_STATUS.reconnecting, reconnectAttempts: attemptsRef.current }
      });
      reconnectRef.current = window.setTimeout(connect, delay);
    }

    function connect() {
      if (cancelled) return;
      const url = new URL(getWebSocketUrl());
      if (authToken) url.searchParams.set('token', authToken);
      dispatch({ type: CHAT_ACTIONS.connectionChanged, payload: { status: CHAT_STATUS.connecting, lastError: '' } });
      const socket = new WebSocket(url.toString());
      socketRef.current = socket;

      socket.onopen = () => {
        attemptsRef.current = 0;
        dispatch({
          type: CHAT_ACTIONS.connectionChanged,
          payload: { status: CHAT_STATUS.connected, reconnectAttempts: 0, lastError: '' }
        });
        socket.send(JSON.stringify({ type: 'identify', username: currentUser.username }));
        heartbeatRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'heartbeat' }));
          }
        }, CHAT_TIMING.heartbeatMs);
      };

      socket.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          if (!data || data.type === 'heartbeat' || data.type === 'pong') return;
          if (data.type === 'message') {
            dispatch({ type: CHAT_ACTIONS.messageReceived, payload: { message: data } });
          }
        } catch (error) {
          dispatch({
            type: CHAT_ACTIONS.connectionChanged,
            payload: { status: CHAT_STATUS.error, lastError: error.message || 'Failed to parse socket message' }
          });
        }
      };

      socket.onerror = () => {
        dispatch({
          type: CHAT_ACTIONS.connectionChanged,
          payload: { status: CHAT_STATUS.error, lastError: 'WebSocket error' }
        });
      };

      socket.onclose = () => {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
        if (!cancelled) scheduleReconnect();
      };
    }

    connect();

    return () => {
      cancelled = true;
      cleanupSocket();
      dispatch({ type: CHAT_ACTIONS.connectionChanged, payload: { status: CHAT_STATUS.disconnected } });
    };
  }, [currentUser?.username, authToken, dispatch, enabled]);

  return {
    sendMessage(payload) {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error('Chat is not connected');
      }
      socket.send(JSON.stringify({ type: 'message', ...payload }));
    }
  };
}
