import { useState, useRef, useEffect, useCallback } from 'react';
import { apiFetch, readJsonResponse } from '../utils/api';
import { diagLog } from '../utils/diagnostics';
import { decryptMessage, encryptMessage } from '../utils/crypto';

export default function useMessages(token, socket, user, activeChat, onConversationUpdate, getSharedKey) {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [editingMessage, setEditingMessage] = useState(null);
  const [editText, setEditText] = useState('');
  const [typing, setTyping] = useState(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const activeChatRef = useRef(null);
  const editInputRef = useRef(null);
  const chatRef = useRef(null);
  const typingTimeout = useRef(null);
  const shouldScrollBottom = useRef(true);
  const sharedKeyRef = useRef(null);
  const getSharedKeyRef = useRef(getSharedKey);

  useEffect(() => {
    getSharedKeyRef.current = getSharedKey;
  }, [getSharedKey]);

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

  async function resolveKey(peerId) {
    if (sharedKeyRef.current) return sharedKeyRef.current;
    if (!getSharedKeyRef.current) return null;
    try {
      return await getSharedKeyRef.current(peerId);
    } catch {
      return null;
    }
  }

  async function decryptIfNeeded(msg, keyOverride) {
    if (!msg.encrypted) return msg;
    const key = keyOverride || sharedKeyRef.current;
    if (!key) {
      const peerId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
      const derived = await resolveKey(peerId);
      if (!derived) return { ...msg, content: '[Не удалось расшифровать]', _decryptFailed: true };
      const plaintext = await decryptMessage(derived, msg.content);
      if (plaintext === null) return { ...msg, content: '[Не удалось расшифровать]', _decryptFailed: true };
      return { ...msg, content: plaintext };
    }
    const plaintext = await decryptMessage(key, msg.content);
    if (plaintext === null) return { ...msg, content: '[Не удалось расшифровать]', _decryptFailed: true };
    return { ...msg, content: plaintext };
  }

  async function decryptMessages(msgs, keyOverride) {
    return Promise.all(msgs.map(m => decryptIfNeeded(m, keyOverride)));
  }

  useEffect(() => {
    if (!socket) return;

    const handleReceiveMessage = async (msg) => {
      const current = activeChatRef.current;
      const decrypted = await decryptIfNeeded(msg);
      if (current && (msg.sender_id === current.id || msg.receiver_id === current.id)) {
        setMessages(prev => {
          const idx = prev.findIndex(m => m._optimistic &&
            m.sender_id === msg.sender_id && m._plainContent === decrypted.content);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = decrypted;
            return next;
          }
          return [...prev, decrypted];
        });
      }
      onConversationUpdate(decrypted);
    };

    const handleMessageDeleted = (data) => {
      if (data.forEveryone) {
        setMessages(prev => prev.filter(m => m.id !== data.messageId));
      }
    };

    const handleMessageEdited = async (updated) => {
      const decrypted = await decryptIfNeeded(updated);
      setMessages(prev => prev.map(m =>
        m.id === updated.id ? { ...m, content: decrypted.content, edited_at: decrypted.edited_at } : m
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

    const handleRateLimited = () => {
      setRateLimited(true);
      setTimeout(() => setRateLimited(false), 3000);
    };

    socket.on('receive_message', handleReceiveMessage);
    socket.on('message_deleted', handleMessageDeleted);
    socket.on('message_edited', handleMessageEdited);
    socket.on('user_typing', handleUserTyping);
    socket.on('rate_limited', handleRateLimited);

    return () => {
      socket.off('receive_message', handleReceiveMessage);
      socket.off('message_deleted', handleMessageDeleted);
      socket.off('message_edited', handleMessageEdited);
      socket.off('user_typing', handleUserTyping);
      socket.off('rate_limited', handleRateLimited);
    };
  }, [socket, onConversationUpdate]);

  const loadMessages = async (chatUser, keyOverride) => {
    if (keyOverride) sharedKeyRef.current = keyOverride;
    setLoadingMessages(true);
    try {
      const res = await apiFetch(`/api/messages/${chatUser.id}?limit=50`, token);
      const data = await readJsonResponse(res);
      const raw = data.messages || [];
      const decrypted = await decryptMessages(raw, sharedKeyRef.current);
      setMessages(decrypted);
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
      const raw = data.messages || [];
      const older = await decryptMessages(raw);
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

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim() || !activeChatRef.current || !socket) return;

    const plainContent = message.trim();
    let key = sharedKeyRef.current;
    if (!key && getSharedKeyRef.current) {
      key = await getSharedKeyRef.current(activeChatRef.current.id);
      if (key) sharedKeyRef.current = key;
    }
    let contentToSend = plainContent;
    let encrypted = false;

    if (key) {
      try {
        contentToSend = await encryptMessage(key, plainContent);
        encrypted = true;
      } catch (err) {
        console.error('Encryption failed, sending plaintext:', err);
      }
    }

    const tempId = `opt_${crypto.randomUUID()}`;
    const optimistic = {
      _optimistic: true,
      _status: 'sending',
      _plainContent: plainContent,
      id: tempId,
      sender_id: user.id,
      receiver_id: activeChatRef.current.id,
      content: plainContent,
      created_at: new Date().toISOString(),
      sender_name: user.display_name || user.username,
    };
    setMessages(prev => [...prev, optimistic]);
    setMessage('');
    diagLog('message-flow', 'send_started', { tempId, receiverId: activeChatRef.current.id });
    setTimeout(() => {
      setMessages(prev => prev.map(m =>
        m.id === tempId && m._status === 'sending' ? { ...m, _status: 'failed' } : m
      ));
    }, 10000);
    socket.emit('send_message', { receiverId: activeChatRef.current.id, content: contentToSend, encrypted });
  };

  const retryMessage = async (msg) => {
    if (!socket || !activeChatRef.current) return;
    const key = sharedKeyRef.current;
    let contentToSend = msg._plainContent || msg.content;
    let encrypted = false;

    if (key) {
      try {
        contentToSend = await encryptMessage(key, msg._plainContent || msg.content);
        encrypted = true;
      } catch {
        contentToSend = msg._plainContent || msg.content;
      }
    }

    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, _status: 'sending' } : m
    ));
    socket.emit('send_message', { receiverId: msg.receiver_id, content: contentToSend, encrypted });
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

    const key = sharedKeyRef.current;
    let contentToSend = editText.trim();
    if (key) {
      try {
        contentToSend = await encryptMessage(key, editText.trim());
      } catch {
        // fallback to plaintext
      }
    }

    try {
      const res = await apiFetch(`/api/messages/${editingMessage.id}`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentToSend }),
      });
      if (res.ok) {
        const updated = await readJsonResponse(res);
        const decrypted = await decryptIfNeeded(updated);
        setMessages(prev => prev.map(m =>
          m.id === editingMessage.id ? { ...m, content: decrypted.content, edited_at: decrypted.edited_at } : m
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
    typing, rateLimited, loadingMessages, hasMore, loadingOlder,
    loadMessages, loadOlderMessages, sendMessage, retryMessage, deleteMessage,
    startEdit, saveEdit, cancelEdit, handleTyping,
  };
}
