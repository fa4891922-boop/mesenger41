import { useState, useEffect } from 'react';
import AuthPage from './AuthPage.jsx';
import Messenger from './Messenger.jsx';
import './App.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(() => !!localStorage.getItem('token'));

  const handleAuth = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  useEffect(() => {
    if (token) {
      fetch(`${BACKEND_URL}/api/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => {
          if (!res.ok) throw new Error('Invalid token');
          return res.json();
        })
        .then(data => setUser(data))
        .catch(() => handleLogout())
        .finally(() => setLoading(false));
    }
  }, [token]);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" />
        <span className="app-loading-text">PearNet</span>
      </div>
    );
  }

  if (!token || !user) {
    return <AuthPage onAuth={handleAuth} />;
  }

  return <Messenger token={token} user={user} onLogout={handleLogout} />;
}

export default App;
