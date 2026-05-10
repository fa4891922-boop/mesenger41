import { useState, useEffect } from 'react';
import io from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';
const socket = io(BACKEND_URL);

function App() {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('User' + Math.floor(Math.random() * 1000));

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

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim()) {
      socket.emit('send_message', { username, content: message });
      setMessage('');
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', background: '#f5f5f5', minHeight: '100vh' }}>
      <div style={{ background: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
        <h1 style={{ color: '#0088cc', margin: '0 0 20px 0' }}>💬 Telegram Clone</h1>
        <div style={{ marginBottom: '15px' }}>
          <input 
            type="text" 
            value={username} 
            onChange={e => setUsername(e.target.value)}
            placeholder="Ваше имя"
            style={{ padding: '8px', borderRadius: '5px', border: '1px solid #ddd', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ height: '400px', border: '1px solid #eee', borderRadius: '5px', overflowY: 'auto', padding: '15px', marginBottom: '15px', background: '#fafafa' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: '10px', padding: '8px 12px', background: m.username === username ? '#e3f2fd' : 'white', borderRadius: '15px', display: 'inline-block', maxWidth: '80%', clear: 'both', float: m.username === username ? 'right' : 'left', border: '1px solid #eee' }}>
              <strong style={{ color: m.username === username ? '#1565c0' : '#d32f2f', fontSize: '0.8em', display: 'block', marginBottom: '2px' }}>{m.username}</strong> 
              <span>{m.content}</span>
            </div>
          ))}
          <div style={{ clear: 'both' }}></div>
        </div>
        <form onSubmit={sendMessage} style={{ display: 'flex', gap: '10px' }}>
          <input 
            type="text" 
            value={message} 
            onChange={e => setMessage(e.target.value)} 
            placeholder="Написать сообщение..."
            style={{ flexGrow: 1, padding: '10px', borderRadius: '20px', border: '1px solid #ddd', outline: 'none' }}
          />
          <button type="submit" style={{ padding: '10px 20px', borderRadius: '20px', border: 'none', background: '#0088cc', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>Отправить</button>
        </form>
      </div>
    </div>
  );
}

export default App;
