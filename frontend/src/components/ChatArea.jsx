import { useCallback } from 'react';
import { formatDate } from '../utils/format';
import ChatHeader from './ChatHeader';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';

function ChatArea({
  activeChat, messages, loadingMessages, hasMore, loadingOlder, loadOlderMessages,
  user, typing, connectionStatus,
  isOnline, isMobile, showSidebar, setShowSidebar,
  message, setMessage, sendMessage, handleTyping,
  editingMessage, editText, setEditText, saveEdit, cancelEdit, editInputRef,
  chatRef, showContextMenu, showMsgMenu, retryMessage,
  requestDeleteChat, setActiveCall,
}) {
  const handleScroll = useCallback((e) => {
    if (e.target.scrollTop < 80 && hasMore && !loadingOlder) {
      loadOlderMessages();
    }
  }, [hasMore, loadingOlder, loadOlderMessages]);

  const renderDateSeparator = (current, prev) => {
    if (!current.created_at) return null;
    const curDate = new Date(current.created_at).toDateString();
    const prevDate = prev ? new Date(prev.created_at).toDateString() : null;
    if (curDate === prevDate) return null;
    return (
      <div className="date-separator">
        <span>{formatDate(current.created_at)}</span>
      </div>
    );
  };

  return (
    <main className={`chat-area${isMobile && showSidebar ? ' chat-area-hidden' : ''}`}>
      {activeChat ? (
        <>
          <ChatHeader
            activeChat={activeChat}
            typing={typing}
            isOnline={isOnline}
            isMobile={isMobile}
            setShowSidebar={setShowSidebar}
            requestDeleteChat={requestDeleteChat}
            setActiveCall={setActiveCall}
          />

          {connectionStatus !== 'connected' && (
            <div className="connection-banner">
              {connectionStatus === 'reconnecting' ? 'Переподключение...' : 'Нет соединения с сервером'}
            </div>
          )}

          <div className="chat-messages" ref={chatRef} onScroll={handleScroll}>
            {loadingOlder && (
              <div className="load-more">
                <div className="chat-loading-spinner" />
              </div>
            )}
            {loadingMessages ? (
              <div className="chat-loading">
                <div className="chat-loading-spinner" />
              </div>
            ) : messages.length === 0 ? (
              <div className="chat-empty">
                <p>Нет сообщений</p>
                <p className="chat-empty-hint">Напишите первое сообщение!</p>
              </div>
            ) : (
              messages.map((m, i) => {
                const prev = i > 0 ? messages[i - 1] : null;
                return (
                  <div key={m.id || i}>
                    {renderDateSeparator(m, prev)}
                    <MessageBubble
                      msg={m}
                      user={user}
                      isEditing={editingMessage?.id === m.id}
                      editText={editText}
                      setEditText={setEditText}
                      saveEdit={saveEdit}
                      cancelEdit={cancelEdit}
                      editInputRef={editInputRef}
                      showContextMenu={showContextMenu}
                      showMsgMenu={showMsgMenu}
                      retryMessage={retryMessage}
                    />
                  </div>
                );
              })
            )}
          </div>

          <MessageInput
            message={message}
            setMessage={setMessage}
            sendMessage={sendMessage}
            handleTyping={handleTyping}
            connectionStatus={connectionStatus}
          />
        </>
      ) : (
        <div className="chat-placeholder">
          <span className="chat-placeholder-icon">🍐</span>
          <h2>Выбери чат</h2>
          <p>Найди друга через поиск и начни общение</p>
        </div>
      )}
    </main>
  );
}

export default ChatArea;
