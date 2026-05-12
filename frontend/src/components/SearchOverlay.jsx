function SearchOverlay({ show, onClose, search, searchUsers, allUsers, isOnline, openChat }) {
  if (!show) return null;

  return (
    <div className="mobile-search-overlay" onClick={onClose}>
      <div className="mobile-search-panel" onClick={e => e.stopPropagation()}>
        <div className="mobile-search-header">
          <button className="mobile-search-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <input
            type="text"
            className="search-input"
            placeholder="Найти по имени..."
            value={search}
            onChange={e => searchUsers(e.target.value)}
            autoFocus
          />
        </div>
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
      </div>
    </div>
  );
}

export default SearchOverlay;
