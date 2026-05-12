function MessageInput({ message, setMessage, sendMessage, handleTyping, connectionStatus }) {
  return (
    <form className="chat-input" onSubmit={sendMessage}>
      <input
        type="text"
        className="message-field"
        value={message}
        onChange={e => { setMessage(e.target.value); handleTyping(); }}
        placeholder={connectionStatus === 'connected' ? 'Написать сообщение...' : 'Нет соединения...'}
        autoComplete="off"
        disabled={connectionStatus !== 'connected'}
      />
      <button
        type="submit"
        className="send-btn"
        aria-label="Отправить"
        disabled={connectionStatus !== 'connected'}
      >
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </form>
  );
}

export default MessageInput;
