import { Component } from 'react';
import { reportError } from '../utils/diagnostics';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    reportError(error, {
      component: 'ErrorBoundary',
      action: 'componentDidCatch',
      metadata: { componentStack: info.componentStack?.slice(0, 1000) },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#ccc', background: '#0b0e14', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h2>Произошла ошибка</h2>
          <p style={{ color: '#888', marginTop: 8 }}>Попробуйте обновить страницу</p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 24px', background: '#7c5cfc', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            Обновить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
