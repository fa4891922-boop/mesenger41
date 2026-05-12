import { formatTime } from '../utils/format';

function MessageBubble({ msg, user, isEditing, editText, setEditText, saveEdit, cancelEdit, editInputRef, showContextMenu, showMsgMenu, retryMessage }) {
  const isOwn = msg.sender_id === user.id;

  return (
    <div className={`message-row ${isOwn ? 'own' : 'other'}`}>
      <div
        className={`message ${isOwn ? 'own' : 'other'}${msg._optimistic ? ' optimistic' : ''}${msg._status === 'failed' ? ' failed' : ''}`}
        onContextMenu={(e) => showContextMenu(e, msg)}
      >
        <div className="message-bubble">
          {isEditing ? (
            <div className="edit-inline">
              <input
                ref={editInputRef}
                type="text"
                className="edit-input"
                value={editText}
                onChange={e => setEditText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveEdit();
                  if (e.key === 'Escape') cancelEdit();
                }}
              />
              <div className="edit-actions">
                <button className="edit-save" onClick={saveEdit}>✓</button>
                <button className="edit-cancel" onClick={cancelEdit}>✕</button>
              </div>
            </div>
          ) : (
            <>
              <p className="message-text">{msg.content}</p>
              <span className="message-meta">
                {msg.edited_at && <span className="edited-label">ред.</span>}
                <span className="message-time-inline">{formatTime(msg.created_at)}</span>
              </span>
            </>
          )}
        </div>
        {!isEditing && !msg._optimistic && (
          <button
            className="msg-action-btn"
            onClick={(e) => showMsgMenu(e, msg)}
            aria-label="Действия"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <circle cx="12" cy="6" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
          </button>
        )}
      </div>
      {msg._status === 'failed' && (
        <button className="retry-btn" onClick={() => retryMessage(msg)}>
          Ошибка отправки. Повторить
        </button>
      )}
    </div>
  );
}

export default MessageBubble;
