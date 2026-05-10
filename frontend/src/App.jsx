import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';
const socket = io(BACKEND_URL);

function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function App() {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('User' + Math.floor(Math.random() * 1000));
  const chatRef = useRef(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/messages`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setMessages(data);
      })
      .catch(console.error);

    socket.on('receive_message', (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    return () => socket.off('receive_message');
  }, []);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim()) {
      socket.emit('send_message', { username, content: message });
      setMessage('');
    }
  };

  return (
    <div className="messenger">
      <header className="messenger-header">
        <div className="header-brand">
          <span className="header-logo">🍐</span>
          <h1>PearNet</h1>
        </div>
        <div className="header-status">
          <span className="status-dot" />
          <span>online</span>
        </div>
        <div className="header-user">
          <span className="header-user-label">ник</span>
          <input
            type="text"
            className="username-input"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Ваше имя"
          />
        </div>
      </header>

      <main className="messenger-chat" ref={chatRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <span className="chat-empty-icon">🍐</span>
            <span className="chat-empty-text">Пока нет сообщений</span>
            <span className="chat-empty-hint">Напишите первое!</span>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={m.id || i}
              className={`message ${m.username === username ? 'own' : 'other'}`}
            >
              <span className="message-author">{m.username}</span>
              <div className="message-bubble">
                <p className="message-text">{m.content}</p>
              </div>
              <span className="message-time">{formatTime(m.created_at)}</span>
            </div>
          ))
        )}
      </main>

      <form className="messenger-input" onSubmit={sendMessage}>
        <input
          type="text"
          className="message-field"
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Написать сообщение..."
          autoComplete="off"
        />
        <button type="submit" className="send-btn" aria-label="Отправить">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}

export default App;
