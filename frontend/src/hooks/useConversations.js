import { useState, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api';

export default function useConversations(token) {
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const searchTimeoutRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await apiFetch('/api/conversations', token);
      const data = await res.json();
      if (Array.isArray(data)) setConversations(data);
    } catch (err) {
      console.error(err);
    }
  }, [token]);

  const searchUsers = (query) => {
    setSearch(query);
    if (!query.trim()) { setAllUsers([]); return; }
    clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/users?search=${encodeURIComponent(query)}`, token);
        const data = await res.json();
        if (Array.isArray(data)) setAllUsers(data);
      } catch (err) {
        console.error(err);
      }
    }, 300);
  };

  const deleteChat = async (userId) => {
    try {
      const res = await apiFetch(`/api/conversations/${userId}`, token, { method: 'DELETE' });
      return res.ok;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  return {
    conversations, setConversations, loadConversations,
    search, setSearch, allUsers, setAllUsers, searchUsers,
    deleteChat,
  };
}
