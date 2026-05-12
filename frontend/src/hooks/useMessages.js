import { useState, useRef, useEffect, useCallback } from 'react';
import { apiFetch, readJsonResponse } from '../utils/api';
import { diagLog } from '../utils/diagnostics';

export default function useMessages(token, socket, user, activeChat, onConversationUpdate) {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [editingMessage, setEditingMessage] = useState(null);
  const [editText, setEditText] = useState('');
  const [typing, setTyping] = useState(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const activeChatRef = useRef(null);
  const editInputRef = useRef(null);
  const chatRef = useRef(null);
  const typingTimeout = useRef(null);
  const shouldScrollBottom = useRef(true);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    if (shouldScrollBottom.current && chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
    shouldScrollBottom.current = true;
  }, [messages]);

  useEffect(() => {
    if (editingMessage && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.setSelectionRange(editText.length, editText.length);
    }
  }, [editingMessage, editText.length]);

  useEffect(() => {
    if (!socket) return;

    const handleReceiveMessage = (msg) => {
      const current = activeChatRef.current;
      if (current && (msg.sender_id === current.id || msg.receiver_id === current.id)) {
        setMessages(prev => {
          const idx = prev.findIndex(m => m._optimistic &&
            m.sender_id === msg.sender_id && m.content === msg.content);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = msg;
            return next;
          }
          return [...prev, msg];
        });
      }
      onConversationUpdate(msg);
    };

    const handleMessageDeleted = (data) => {
      if (data.forEveryone) {
        setMessages(prev => prev.filter(m => m.id !== data.messageId));
      }
    };

    const handleMessageEdited = (updated) => {
      setMessages(prev => prev.map(m =>
        m.id === updated.id ? { ...m, content: updated.content, edited_at: updated.edited_at } : m
      ));
    };

    const handleUserTyping = (data) => {
      const current = activeChatRef.current;
      if (current && data.userId === current.id) {
        setTyping(data.userId);
        clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => setTyping(null), 2000);
      }
    };

    socket.on('receive_message', handleReceiveMessage);
    socket.on('message_deleted', handleMessageDeleted);
    socket.on('message_edited', handleMessageEdited);
    socket.on('user_typing', handleUserTyping);

    return () => {
      socket.off('receive_message', handleReceiveMessage);
      socket.off('message_deleted', handleMessageDeleted);
      socket.off('message_edited', handleMessageEdited);
      socket.off('user_typing', handleUserTyping);
    };
  }, [socket, onConversationUpdate]);

  const loadMessages = async (chatUser) => {
    setLoadingMessages(true);
    try {
      const res = await apiFetch(`/api/messages/${chatUser.id}?limit=50`, token);
      const data = await readJsonResponse(res);
      setMessages(data.messages || []);
      setHasMore(data.hasMore || false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMore || !activeChatRef.current || messages.length === 0) return;
    const firstMsg = messages[0];
    if (!firstMsg || firstMsg._optimistic) return;
    setLoadingOlder(true);
    shouldScrollBottom.current = false;
    const scrollEl = chatRef.current;
    const prevHeight = scrollEl?.scrollHeight || 0;
    try {
      const res = await apiFetch(`/api/messages/${activeChatRef.current.id}?limit=50&before=${firstMsg.id}`, token);
      const data = await readJsonResponse(res);
      const older = data.messages || [];
      setHasMore(data.hasMore || false);
      if (older.length > 0) {
        setMessages(prev => [...older, ...prev]);
        requestAnimationFrame(() => {
          if (scrollEl) {
            scrollEl.scrollTop = scrollEl.scrollHeight - prevHeight;
          }
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, hasMore, messages, token]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!message.trim() || !activeChatRef.current || !socket) return;
    const tempId = `opt_${crypto.randomUUID()}`;
    const optimistic = {
      _optimistic: true,
      _status: 'sending',
      id: tempId,
      sender_id: user.id,
      receiver_id: activeChatRef.current.id,
      content: message.trim(),
      created_at: new Date().toISOString(),
      sender_name: user.display_name || user.username,
    };
    setMessages(prev => [...prev, optimistic]);
    setMessage('');
    diagLog('message-flow', 'send_started', { tempId, receiverId: activeChatRef.current.id, contentLength: optimistic.content.length });
    setTimeout(() => {
      setMessages(prev => prev.map(m =>
        m.id === tempId && m._status === 'sending' ? { ...m, _status: 'failed' } : m
      ));
    }, 10000);
    socket.emit('send_message', { receiverId: activeChatRef.current.id, content: optimistic.content });
  };

  const retryMessage = (msg) => {
    if (!socket || !activeChatRef.current) return;
    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, _status: 'sending' } : m
    ));
    socket.emit('send_message', { receiverId: msg.receiver_id, content: msg.content });
    setTimeout(() => {
      setMessages(prev => prev.map(m =>
        m.id === msg.id && m._status === 'sending' ? { ...m, _status: 'failed' } : m
      ));
    }, 10000);
  };

  const deleteMessage = async (msg, forEveryone) => {
    diagLog('delete-flow', 'delete_started', { messageId: msg.id, forEveryone });
    try {
      const res = await apiFetch(`/api/messages/${msg.id}`, token, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forEveryone }),
      });
      if (res.ok) {
        setMessages(prev => prev.filter(m => m.id !== msg.id));
        diagLog('delete-flow', 'delete_success', { messageId: msg.id });
      } else {
        diagLog('delete-flow', 'delete_api_failed', { messageId: msg.id, status: res.status });
      }
      return res.ok;
    } catch (err) {
      diagLog('delete-flow', 'delete_error', { messageId: msg.id, error: err.message });
      console.error(err);
      return false;
    }
  };

  const startEdit = (msg) => {
    setEditingMessage(msg);
    setEditText(msg.content);
  };

  const saveEdit = async () => {
    if (!editText.trim() || !editingMessage) return;
    try {
      const res = await apiFetch(`/api/messages/${editingMessage.id}`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText.trim() }),
      });
      if (res.ok) {
        const updated = await readJsonResponse(res);
        setMessages(prev => prev.map(m =>
          m.id === editingMessage.id ? { ...m, content: updated.content, edited_at: updated.edited_at } : m
        ));
      }
    } catch (err) {
      console.error(err);
    }
    setEditingMessage(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setEditText('');
  };

  const handleTyping = () => {
    if (activeChatRef.current && socket) {
      socket.emit('typing', { receiverId: activeChatRef.current.id });
    }
  };

  return {
    messages, setMessages, message, setMessage,
    editingMessage, editText, setEditText, editInputRef, chatRef,
    typing, loadingMessages, hasMore, loadingOlder,
    loadMessages, loadOlderMessages, sendMessage, retryMessage, deleteMessage,
    startEdit, saveEdit, cancelEdit, handleTyping,
  };
}
