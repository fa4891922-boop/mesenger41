function ChatHeader({ activeChat, typing, isOnline, isMobile, setShowSidebar, requestDeleteChat, setActiveCall }) {
  return (
    <div className="chat-header">
      {isMobile && (
        <button className="back-btn" onClick={() => setShowSidebar(true)} aria-label="Назад">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
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
          onClick={(e) => { e.stopPropagation(); setActiveCall({ incoming: false, callType: 'audio' }); }}
          title="Голосовой звонок"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.63A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.9a16 16 0 006.29 6.29l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
          </svg>
        </button>
        <button
          className="chat-menu-btn"
          onClick={(e) => { e.stopPropagation(); setActiveCall({ incoming: false, callType: 'video' }); }}
          title="Видеозвонок"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </button>
        <button
          className="chat-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            requestDeleteChat(activeChat.id, activeChat.display_name);
          }}
          title="Удалить чат"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default ChatHeader;
