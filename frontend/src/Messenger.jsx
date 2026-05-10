import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Messenger({ token, user, onLogout }) {
  const [socket, setSocket] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [typing, setTyping] = useState(null);
  const chatRef = useRef(null);
  const typingTimeout = useRef(null);

  useEffect(() => {
    const s = io(BACKEND_URL, { auth: { token } });
    setSocket(s);

    s.on('receive_message', (msg) => {
      setMessages(prev => {
        if (activeChat &&
          (msg.sender_id === activeChat.id || msg.receiver_id === activeChat.id)) {
          return [...prev, msg];
        }
        return prev;
      });
      loadConversations();
    });

    s.on('online_users', (users) => setOnlineUsers(users));

    s.on('user_typing', (data) => {
      if (activeChat && data.userId === activeChat.id) {
        setTyping(data.userId);
        clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => setTyping(null), 2000);
      }
    });

    return () => s.disconnect();
  }, [token]);

  useEffect(() => {
    if (socket) {
      socket.off('receive_message');
      socket.on('receive_message', (msg) => {
        if (activeChat &&
          (msg.sender_id === activeChat.id || msg.receiver_id === activeChat.id)) {
          setMessages(prev => [...prev, msg]);
        }
        loadConversations();
      });
    }
  }, [activeChat, socket]);

  useEffect(() => {
    loadConversations();
  }, [token]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const headers = { Authorization: `Bearer ${token}` };

  const loadConversations = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/conversations`, { headers });
      const data = await res.json();
      if (Array.isArray(data)) setConversations(data);
    } catch (err) {
      console.error(err);
    }
  };

  const searchUsers = async (query) => {
    setSearch(query);
    if (!query.trim()) { setAllUsers([]); return; }
    try {
      const res = await fetch(`${BACKEND_URL}/api/users?search=${encodeURIComponent(query)}`, { headers });
      const data = await res.json();
      if (Array.isArray(data)) setAllUsers(data);
    } catch (err) {
      console.error(err);
    }
  };

  const openChat = async (chatUser) => {
    setActiveChat(chatUser);
    setShowSearch(false);
    setSearch('');
    setAllUsers([]);
    try {
      const res = await fetch(`${BACKEND_URL}/api/messages/${chatUser.id}`, { headers });
      const data = await res.json();
      if (Array.isArray(data)) setMessages(data);
    } catch (err) {
      console.error(err);
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim() && activeChat && socket) {
      socket.emit('send_message', { receiverId: activeChat.id, content: message });
      setMessage('');
    }
  };

  const handleTyping = () => {
    if (activeChat && socket) {
      socket.emit('typing', { receiverId: activeChat.id });
    }
  };

  const isOnline = (userId) => onlineUsers.includes(userId);

  return (
    <div className="messenger-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="header-logo">🍐</span>
            <h1>PearNet</h1>
          </div>
          <button
            className="sidebar-search-btn"
            onClick={() => setShowSearch(!showSearch)}
            title="Найти пользователя"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>

        {showSearch && (
          <div className="sidebar-search">
            <input
              type="text"
              className="search-input"
              placeholder="Найти по имени..."
              value={search}
              onChange={e => searchUsers(e.target.value)}
              autoFocus
            />
            {allUsers.length > 0 && (
              <div className="search-results">
                {allUsers.map(u => (
                  <div key={u.id} className="user-item" onClick={() => openChat(u)}>
                    <div className={`user-avatar ${isOnline(u.id) ? 'online' : ''}`}>
                      {u.display_name[0].toUpperCase()}
                    </div>
                    <div className="user-info">
                      <span className="user-name">{u.display_name}</span>
                      <span className="user-username">@{u.username}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="conversations-list">
          {conversations.length === 0 && !showSearch ? (
            <div className="sidebar-empty">
              <p>Нет диалогов</p>
              <p className="sidebar-empty-hint">Найди друзей через поиск</p>
            </div>
          ) : (
            conversations.map(c => (
              <div
                key={c.id}
                className={`conversation-item ${activeChat?.id === c.id ? 'active' : ''}`}
                onClick={() => openChat(c)}
              >
                <div className={`user-avatar ${isOnline(c.id) ? 'online' : ''}`}>
                  {c.display_name[0].toUpperCase()}
                </div>
                <div className="conversation-info">
                  <div className="conversation-top">
                    <span className="conversation-name">{c.display_name}</span>
                    <span className="conversation-time">{formatTime(c.last_message_at)}</span>
                  </div>
                  <p className="conversation-preview">{c.last_message}</p>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-avatar own online">
              {user.display_name?.[0]?.toUpperCase() || user.username[0].toUpperCase()}
            </div>
            <span className="sidebar-user-name">{user.display_name || user.username}</span>
          </div>
          <button className="logout-btn" onClick={onLogout} title="Выйти">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </aside>

      <main className="chat-area">
        {activeChat ? (
          <>
            <div className="chat-header">
              <div className={`user-avatar sm ${isOnline(activeChat.id) ? 'online' : ''}`}>
                {activeChat.display_name[0].toUpperCase()}
              </div>
              <div className="chat-header-info">
                <span className="chat-header-name">{activeChat.display_name}</span>
                <span className="chat-header-status">
                  {typing === activeChat.id
                    ? 'печатает...'
                    : isOnline(activeChat.id) ? 'в сети' : 'не в сети'}
                </span>
              </div>
            </div>

            <div className="chat-messages" ref={chatRef}>
              {messages.map((m, i) => (
                <div
                  key={m.id || i}
                  className={`message ${m.sender_id === user.id ? 'own' : 'other'}`}
                >
                  <div className="message-bubble">
                    <p className="message-text">{m.content}</p>
                    <span className="message-time-inline">{formatTime(m.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>

            <form className="chat-input" onSubmit={sendMessage}>
              <input
                type="text"
                className="message-field"
                value={message}
                onChange={e => { setMessage(e.target.value); handleTyping(); }}
                placeholder="Написать сообщение..."
                autoComplete="off"
              />
              <button type="submit" className="send-btn" aria-label="Отправить">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </form>
          </>
        ) : (
          <div className="chat-placeholder">
            <span className="chat-placeholder-icon">🍐</span>
            <h2>Выбери чат</h2>
            <p>Найди друга через поиск и начни общение</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default Messenger;
