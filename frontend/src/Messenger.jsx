import { useState, useEffect, useRef, useCallback } from 'react';
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
  const [contextMenu, setContextMenu] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [editText, setEditText] = useState('');
  const [chatMenu, setChatMenu] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const chatRef = useRef(null);
  const typingTimeout = useRef(null);
  const editInputRef = useRef(null);

  const headers = { Authorization: `Bearer ${token}` };

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/conversations`, { headers });
      const data = await res.json();
      if (Array.isArray(data)) setConversations(data);
    } catch (err) {
      console.error(err);
    }
  }, [token]);

  useEffect(() => {
    const s = io(BACKEND_URL, { auth: { token } });
    setSocket(s);

    s.on('online_users', (users) => setOnlineUsers(users));

    return () => s.disconnect();
  }, [token]);

  useEffect(() => {
    if (socket) {
      socket.off('receive_message');
      socket.off('message_deleted');
      socket.off('message_edited');
      socket.off('user_typing');

      socket.on('receive_message', (msg) => {
        if (activeChat &&
          (msg.sender_id === activeChat.id || msg.receiver_id === activeChat.id)) {
          setMessages(prev => [...prev, msg]);
        }
        loadConversations();
      });

      socket.on('message_deleted', (data) => {
        if (data.forEveryone) {
          setMessages(prev => prev.filter(m => m.id !== data.messageId));
        }
      });

      socket.on('message_edited', (updated) => {
        setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, content: updated.content, edited_at: updated.edited_at } : m));
      });

      socket.on('user_typing', (data) => {
        if (activeChat && data.userId === activeChat.id) {
          setTyping(data.userId);
          clearTimeout(typingTimeout.current);
          typingTimeout.current = setTimeout(() => setTyping(null), 2000);
        }
      });
    }
  }, [activeChat, socket, loadConversations]);

  useEffect(() => {
    loadConversations();
  }, [token, loadConversations]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (editingMessage && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.setSelectionRange(editText.length, editText.length);
    }
  }, [editingMessage]);

  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null);
      setChatMenu(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

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
    setEditingMessage(null);
    setContextMenu(null);
    setChatMenu(false);
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

  const handleContextMenu = (e, msg) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const isOwn = msg.sender_id === user.id;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      message: msg,
      isOwn
    });
  };

  const deleteMessage = async (msg, forEveryone) => {
    try {
      await fetch(`${BACKEND_URL}/api/messages/${msg.id}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ forEveryone })
      });
      if (forEveryone) {
        setMessages(prev => prev.filter(m => m.id !== msg.id));
      } else {
        setMessages(prev => prev.filter(m => m.id !== msg.id));
      }
      loadConversations();
    } catch (err) {
      console.error(err);
    }
    setContextMenu(null);
  };

  const startEdit = (msg) => {
    setEditingMessage(msg);
    setEditText(msg.content);
    setContextMenu(null);
  };

  const saveEdit = async () => {
    if (!editText.trim() || !editingMessage) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/messages/${editingMessage.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText.trim() })
      });
      const updated = await res.json();
      setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, content: updated.content, edited_at: updated.edited_at } : m));
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

  const deleteConversation = async () => {
    if (!activeChat) return;
    try {
      await fetch(`${BACKEND_URL}/api/conversations/${activeChat.id}`, {
        method: 'DELETE',
        headers
      });
      setActiveChat(null);
      setMessages([]);
      loadConversations();
    } catch (err) {
      console.error(err);
    }
    setConfirmDialog(null);
    setChatMenu(false);
  };

  return (
    <div className="messenger-layout" onClick={() => { setContextMenu(null); setChatMenu(false); }}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="header-logo">🍐</span>
            <h1>PearNet</h1>
          </div>
          <button
            className="sidebar-search-btn"
            onClick={(e) => { e.stopPropagation(); setShowSearch(!showSearch); }}
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
              <div className="chat-header-actions">
                <button
                  className="chat-menu-btn"
                  onClick={(e) => { e.stopPropagation(); setChatMenu(!chatMenu); }}
                  title="Меню чата"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
                {chatMenu && (
                  <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
                    <button className="dropdown-item danger" onClick={() => setConfirmDialog({ type: 'deleteChat' })}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                      Удалить чат
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="chat-messages" ref={chatRef}>
              {messages.map((m, i) => {
                const isOwn = m.sender_id === user.id;
                const isEditing = editingMessage?.id === m.id;
                return (
                  <div
                    key={m.id || i}
                    className={`message ${isOwn ? 'own' : 'other'}`}
                    onContextMenu={(e) => handleContextMenu(e, m)}
                    onClick={(e) => {
                      if (window.innerWidth <= 768) {
                        e.stopPropagation();
                        handleContextMenu(e, m);
                      }
                    }}
                  >
                    <div className="message-bubble">
                      {isEditing ? (
                        <div className="edit-inline">
                          <input
                            ref={editInputRef}
                            type="text"
                            className="edit-input"
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                          />
                          <div className="edit-actions">
                            <button className="edit-save" onClick={saveEdit}>✓</button>
                            <button className="edit-cancel" onClick={cancelEdit}>✕</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="message-text">{m.content}</p>
                          <span className="message-meta">
                            {m.edited_at && <span className="edited-label">ред.</span>}
                            <span className="message-time-inline">{formatTime(m.created_at)}</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
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

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.isOwn && (
            <button className="context-item" onClick={() => startEdit(contextMenu.message)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Редактировать
            </button>
          )}
          <button className="context-item" onClick={() => deleteMessage(contextMenu.message, false)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
            Удалить у меня
          </button>
          {contextMenu.isOwn && (
            <button className="context-item danger" onClick={() => deleteMessage(contextMenu.message, true)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              Удалить у всех
            </button>
          )}
        </div>
      )}

      {confirmDialog && (
        <div className="confirm-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="confirm-text">
              {confirmDialog.type === 'deleteChat'
                ? `Удалить чат с ${activeChat?.display_name}? Сообщения будут удалены только у вас.`
                : 'Вы уверены?'}
            </p>
            <div className="confirm-actions">
              <button className="confirm-btn cancel" onClick={() => setConfirmDialog(null)}>Отмена</button>
              <button className="confirm-btn delete" onClick={deleteConversation}>Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Messenger;
