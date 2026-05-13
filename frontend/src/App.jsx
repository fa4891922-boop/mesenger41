import { useState, useEffect } from 'react';
import AuthPage from './AuthPage.jsx';
import Messenger from './Messenger.jsx';
import AdminDiagnostics from './AdminDiagnostics.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { apiFetch, readJsonResponse, setTokens, getAccessToken, getRefreshToken, clearTokens, setOnTokenRefreshed } from './utils/api.js';
import './App.css';

function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!getRefreshToken());
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const handleAuth = (accessToken, refreshTokenVal, newUser) => {
    setTokens(accessToken, refreshTokenVal);
    setToken(accessToken);
    setUser(newUser);
  };

  const handleLogout = async () => {
    const rt = getRefreshToken();
    if (rt && token) {
      apiFetch('/api/logout', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      }).catch(() => {});
    }
    clearTokens();
    setToken(null);
    setUser(null);
    setShowDiagnostics(false);
  };

  useEffect(() => {
    setOnTokenRefreshed((newToken) => {
      setToken(newToken);
    });
  }, []);

  useEffect(() => {
    const rt = getRefreshToken();
    if (!rt) {
      setLoading(false);
      return;
    }

    apiFetch('/api/me', null)
      .then(res => {
        if (!res.ok) throw new Error('Invalid token');
        return readJsonResponse(res);
      })
      .then(data => {
        setToken(getAccessToken());
        setUser(data);
      })
      .catch(() => {
        clearTokens();
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

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
