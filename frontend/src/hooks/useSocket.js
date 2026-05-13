import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { BACKEND_URL, getAccessToken } from '../utils/api';

export default function useSocket(token) {
  const [socket, setSocket] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const tokenRef = useRef(token);
  const socketRef = useRef(null);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    const s = io(BACKEND_URL, {
      auth: { token: tokenRef.current || getAccessToken() },
    });
    socketRef.current = s;

    s.on('connect', () => {
      setSocket(s);
      setConnectionStatus('connected');
    });
    s.on('disconnect', () => setConnectionStatus('disconnected'));
    s.io.on('reconnect_attempt', () => {
      setConnectionStatus('reconnecting');
      s.auth = { token: getAccessToken() || tokenRef.current };
    });
    s.io.on('reconnect', () => setConnectionStatus('connected'));
    s.on('online_users', (users) => setOnlineUsers(users));

    return () => s.disconnect();
  }, []);

  return { socket, connectionStatus, onlineUsers };
}
