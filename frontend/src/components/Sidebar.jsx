import { formatTime } from '../utils/format';

function Sidebar({
  conversations, activeChat, openChat, isOnline,
  showSearch, setShowSearch, search, searchUsers, allUsers,
  setShowMobileSearch, requestDeleteChat,
  user, onLogout, onOpenDiagnostics, isMobile, showSidebar,
}) {
  return (
    <aside className={`sidebar${isMobile && !showSidebar ? ' sidebar-hidden' : ''}${isMobile && showSidebar ? ' sidebar-mobile' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="header-logo">🍐</span>
          <h1>PearNet</h1>
        </div>
        <button
          className="sidebar-search-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (isMobile) {
              searchUsers('');
              setShowMobileSearch(true);
            } else {
              setShowSearch(!showSearch);
            }
          }}
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
              <button
                className="conv-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  requestDeleteChat(c.id, c.display_name);
                }}
                title="Удалить чат"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
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
        {onOpenDiagnostics && (
          <button className="logout-btn" onClick={onOpenDiagnostics} title="Диагностика" style={{ marginLeft: 4 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
