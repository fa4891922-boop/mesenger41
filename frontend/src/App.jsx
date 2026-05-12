import { useState, useEffect } from 'react';
import AuthPage from './AuthPage.jsx';
import Messenger from './Messenger.jsx';
import AdminDiagnostics from './AdminDiagnostics.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './App.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(() => !!localStorage.getItem('token'));
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const handleAuth = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setShowDiagnostics(false);
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
    return (
      <ErrorBoundary>
        <AuthPage onAuth={handleAuth} />
      </ErrorBoundary>
    );
  }

  if (showDiagnostics) {
    return (
      <ErrorBoundary>
        <AdminDiagnostics token={token} onBack={() => setShowDiagnostics(false)} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Messenger
        token={token}
        user={user}
        onLogout={handleLogout}
        onOpenDiagnostics={user.is_admin ? () => setShowDiagnostics(true) : null}
      />
    </ErrorBoundary>
  );
}

export default App;
