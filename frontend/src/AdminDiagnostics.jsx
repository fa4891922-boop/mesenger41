import { useState, useEffect, useCallback } from 'react';
import { apiFetch, readJsonResponse } from './utils/api.js';
import './AdminDiagnostics.css';

const DEFAULT_CONFIG = {
  includeBackendLogs: true,
  includeFrontendErrors: true,
  includeMessageFlow: true,
  includeDeleteFlow: true,
  includeDatabaseStatus: true,
  includeWebSocketStatus: true,
  includeEnvDeploy: true,
  includeAuthEvents: true,
  detailLevel: 'standard',
  timeRange: 'hour',
  format: 'ai-markdown',
  privacyLevel: 'standard',
  aiMode: true,
};

function StatusBadge({ status }) {
  const color = status === 'ok' || status === true ? '#4ade80'
    : status === 'error' || status === false ? '#f87171'
    : '#fbbf24';
  const label = status === true ? 'ok' : status === false ? 'missing' : String(status);
  return <span className="diag-badge" style={{ background: color + '22', color }}>{label}</span>;
}

function LogEntry({ entry }) {
  const levelColors = { error: '#f87171', critical: '#ef4444', warn: '#fbbf24', info: '#60a5fa', debug: '#9ca3af' };
  return (
    <div className="diag-log-entry">
      <span className="diag-log-time">{entry.timestamp?.slice(11, 19)}</span>
      <span className="diag-log-level" style={{ color: levelColors[entry.level] || '#ccc' }}>{entry.level}</span>
      <span className="diag-log-area">[{entry.area}]</span>
      <span className="diag-log-event">{entry.event}</span>
      {entry.errorMessage && <span className="diag-log-error">: {entry.errorMessage}</span>}
      {entry.requestId && <span className="diag-log-reqid">req:{entry.requestId.slice(0, 8)}</span>}
    </div>
  );
}

function ConfigModal({ config, setConfig, onClose }) {
  const toggle = (key) => setConfig(prev => ({ ...prev, [key]: !prev[key] }));
  const set = (key, val) => setConfig(prev => ({ ...prev, [key]: val }));

  return (
    <div className="diag-modal-overlay" onClick={onClose}>
      <div className="diag-modal" onClick={e => e.stopPropagation()}>
        <h3>Настройка диагностического отчёта</h3>

        <div className="diag-config-section">
          <h4>Что включить</h4>
          <label><input type="checkbox" checked={config.includeBackendLogs} onChange={() => toggle('includeBackendLogs')} /> Логи бэкенда</label>
          <label><input type="checkbox" checked={config.includeFrontendErrors} onChange={() => toggle('includeFrontendErrors')} /> Ошибки фронтенда</label>
          <label><input type="checkbox" checked={config.includeMessageFlow} onChange={() => toggle('includeMessageFlow')} /> Отправка сообщений</label>
          <label><input type="checkbox" checked={config.includeDeleteFlow} onChange={() => toggle('includeDeleteFlow')} /> Удаление сообщений</label>
          <label><input type="checkbox" checked={config.includeDatabaseStatus} onChange={() => toggle('includeDatabaseStatus')} /> Статус базы данных</label>
          <label><input type="checkbox" checked={config.includeWebSocketStatus} onChange={() => toggle('includeWebSocketStatus')} /> Статус WebSocket</label>
          <label><input type="checkbox" checked={config.includeEnvDeploy} onChange={() => toggle('includeEnvDeploy')} /> Окружение и деплой</label>
          <label><input type="checkbox" checked={config.includeAuthEvents} onChange={() => toggle('includeAuthEvents')} /> События авторизации</label>
        </div>

        <div className="diag-config-section">
          <h4>Детализация</h4>
          <select value={config.detailLevel} onChange={e => set('detailLevel', e.target.value)}>
            <option value="minimal">Минимальная (20 записей)</option>
            <option value="standard">Стандартная (50 записей)</option>
            <option value="detailed">Подробная (150 записей)</option>
          </select>
        </div>

        <div className="diag-config-section">
          <h4>Временной диапазон</h4>
          <select value={config.timeRange} onChange={e => set('timeRange', e.target.value)}>
            <option value="15min">Последние 15 минут</option>
            <option value="hour">Последний час</option>
            <option value="6hours">Последние 6 часов</option>
            <option value="24hours">Последние 24 часа</option>
          </select>
        </div>

        <div className="diag-config-section">
          <h4>Формат</h4>
          <select value={config.format} onChange={e => set('format', e.target.value)}>
            <option value="ai-markdown">AI-ready Markdown</option>
            <option value="json">JSON</option>
          </select>
        </div>

        <div className="diag-config-section">
          <label><input type="checkbox" checked={config.aiMode} onChange={() => toggle('aiMode')} /> Добавить инструкцию для внешнего ИИ</label>
        </div>

        <div className="diag-modal-actions">
          <button className="diag-btn" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}

function AdminDiagnostics({ token, onBack }) {
  const [health, setHealth] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [logFilter, setLogFilter] = useState('all');
  const [bundleText, setBundleText] = useState(null);

  const headers = useCallback(() => ({
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }), [token]);

  const loadHealth = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/diagnostics/health', token, { headers: headers() });
      if (res.ok) setHealth(await readJsonResponse(res));
    } catch { /* network error */ }
  }, [headers, token]);

  const loadLogs = useCallback(async () => {
    try {
      const area = logFilter !== 'all' ? `&area=${logFilter}` : '';
      const res = await apiFetch(`/api/admin/diagnostics/logs?limit=100${area}`, token, { headers: headers() });
      if (res.ok) {
        const data = await readJsonResponse(res);
        setLogs(data.logs || []);
      }
    } catch { /* network error */ }
  }, [headers, logFilter, token]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadHealth(), loadLogs()]);
    setLoading(false);
  }, [loadHealth, loadLogs]);

  useEffect(() => {
    const h = headers();
    apiFetch('/api/admin/diagnostics/health', token, { headers: h })
      .then(res => res.ok ? readJsonResponse(res) : null)
      .then(data => { if (data) setHealth(data); })
      .catch(() => { /* network error */ });
    const area = logFilter !== 'all' ? `&area=${logFilter}` : '';
    apiFetch(`/api/admin/diagnostics/logs?limit=100${area}`, token, { headers: h })
      .then(res => res.ok ? readJsonResponse(res) : null)
      .then(data => { if (data) setLogs(data.logs || []); })
      .catch(() => { /* network error */ });
  }, [headers, logFilter, token]);

  const copyDiagnostics = async () => {
    setCopyStatus('loading');
    try {
      const params = new URLSearchParams();
      for (const [key, val] of Object.entries(config)) {
        params.set(key, String(val));
      }
      const res = await apiFetch(`/api/admin/diagnostics/bundle?${params}`, token, { headers: headers() });
      if (!res.ok) throw new Error('Failed');
      const text = await res.text();
      try {
        await navigator.clipboard.writeText(text);
        setCopyStatus('success');
      } catch {
        setBundleText(text);
        setCopyStatus('fallback');
      }
    } catch {
      setCopyStatus('error');
    }
    if (copyStatus !== 'fallback') setTimeout(() => setCopyStatus(null), 3000);
  };

  const aiAnalyze = async () => {
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await apiFetch('/api/admin/diagnostics/ai-analyze', token, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ config }),
      });
      const data = await readJsonResponse(res);
      setAiResult(data.analysis || data.error || 'No result');
    } catch (err) {
      setAiResult('Error: ' + err.message);
    }
    setAiLoading(false);
  };

  const areas = ['all', 'api', 'auth', 'message-flow', 'delete-flow', 'websocket', 'database', 'frontend', 'startup'];

  return (
    <div className="diag-page">
      <div className="diag-header">
        <button className="diag-btn diag-btn-back" onClick={onBack}>← Назад</button>
        <h2>PearNet Diagnostics</h2>
        <div className="diag-header-actions">
          <button className="diag-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Загрузка...' : 'Обновить'}
          </button>
          <button className="diag-btn diag-btn-config" onClick={() => setShowConfig(true)}>Настроить</button>
          <button className="diag-btn diag-btn-copy" onClick={copyDiagnostics} disabled={copyStatus === 'loading'}>
            {copyStatus === 'loading' ? 'Копирование...' :
             copyStatus === 'success' ? 'Скопировано!' :
             copyStatus === 'error' ? 'Ошибка' :
             'Копировать диагностику'}
          </button>
          {health?.nvidia?.available ? (
            <button className="diag-btn diag-btn-ai" onClick={aiAnalyze} disabled={aiLoading}>
              {aiLoading ? 'Анализ...' : 'AI Анализ'}
            </button>
          ) : (
            <button className="diag-btn diag-btn-ai" disabled title="NVIDIA_API_KEY не настроен">
              AI Анализ (недоступен)
            </button>
          )}
        </div>
      </div>

      {health && (
        <div className="diag-status-grid">
          <div className="diag-card">
            <h4>Backend</h4>
            <StatusBadge status={health.backend?.status} />
            <p>Uptime: {health.backend?.uptime}s</p>
            <p>RAM: {health.memory?.heap} MB</p>
          </div>
          <div className="diag-card">
            <h4>Database</h4>
            <StatusBadge status={health.database?.status} />
            {health.database?.latencyMs && <p>{health.database.latencyMs}ms</p>}
            {health.database?.error && <p className="diag-error">{health.database.error}</p>}
          </div>
          <div className="diag-card">
            <h4>WebSocket</h4>
            <StatusBadge status={health.websocket?.status} />
            <p>Клиентов: {health.websocket?.connectedClients}</p>
            <p>Онлайн: {health.websocket?.onlineUsers}</p>
          </div>
          <div className="diag-card">
            <h4>Redis</h4>
            <StatusBadge status={health.redis?.status} />
          </div>
          <div className="diag-card">
            <h4>Окружение</h4>
            <p>DATABASE_URL: <StatusBadge status={health.environment?.DATABASE_URL} /></p>
            <p>JWT_SECRET: <StatusBadge status={health.environment?.JWT_SECRET} /></p>
            <p>CORS: <StatusBadge status={health.environment?.corsOpen ? 'open' : 'ok'} /></p>
          </div>
          <div className="diag-card">
            <h4>NVIDIA AI</h4>
            <StatusBadge status={health.nvidia?.available ? 'ok' : 'not set'} />
          </div>
        </div>
      )}

      {health && (
        <div className="diag-counters">
          <span>Ошибок: <b>{health.counters?.errors || 0}</b></span>
          <span>Критических: <b>{health.counters?.criticals || 0}</b></span>
          <span>Сбои сообщений: <b>{health.counters?.messageFlowFailures || 0}</b></span>
          <span>Сбои удаления: <b>{health.counters?.deleteFlowFailures || 0}</b></span>
          <span>Сбои авторизации: <b>{health.counters?.authFailures || 0}</b></span>
          <span>Frontend: <b>{health.counters?.frontendErrors || 0}</b></span>
          <span>Буфер: <b>{health.logBufferSize || 0}</b></span>
        </div>
      )}

      <div className="diag-logs-section">
        <div className="diag-logs-header">
          <h3>Логи</h3>
          <div className="diag-filter-tabs">
            {areas.map(a => (
              <button
                key={a}
                className={`diag-filter-tab${logFilter === a ? ' active' : ''}`}
                onClick={() => setLogFilter(a)}
              >{a}</button>
            ))}
          </div>
        </div>
        <div className="diag-logs-list">
          {logs.length === 0 ? (
            <p className="diag-empty">Нет логов за выбранный период</p>
          ) : (
            logs.slice().reverse().map((entry, i) => <LogEntry key={i} entry={entry} />)
          )}
        </div>
      </div>

      {aiResult && (
        <div className="diag-ai-result">
          <h3>AI Анализ</h3>
          <pre className="diag-ai-text">{aiResult}</pre>
        </div>
      )}

      {bundleText && (
        <div className="diag-modal-overlay" onClick={() => setBundleText(null)}>
          <div className="diag-modal diag-bundle-modal" onClick={e => e.stopPropagation()}>
            <h3>Диагностический отчёт</h3>
            <p>Clipboard API недоступен. Скопируйте текст вручную:</p>
            <textarea className="diag-bundle-text" value={bundleText} readOnly onFocus={e => e.target.select()} />
            <button className="diag-btn" onClick={() => setBundleText(null)}>Закрыть</button>
          </div>
        </div>
      )}

      {showConfig && <ConfigModal config={config} setConfig={setConfig} onClose={() => setShowConfig(false)} />}
    </div>
  );
}

export default AdminDiagnostics;
