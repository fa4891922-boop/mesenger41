import { useState, useEffect, useCallback, useRef } from 'react';
import useSocket from './hooks/useSocket';
import useConversations from './hooks/useConversations';
import useMessages from './hooks/useMessages';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ContextMenu from './components/ContextMenu';
import ConfirmDialog from './components/ConfirmDialog';
import SearchOverlay from './components/SearchOverlay';
import CallModal from './CallModal.jsx';
import { apiFetch, readJsonResponse } from './utils/api.js';
import {
  loadPrivateKey, generateKeyPair, savePrivateKey,
  exportPublicKey, importPublicKey, deriveSharedKey,
} from './utils/crypto.js';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

function Messenger({ token, user, onLogout, onOpenDiagnostics }) {
  const { socket, connectionStatus, onlineUsers } = useSocket(token, onLogout);
  const {
    conversations, setConversations, loadConversations,
    search, setSearch, allUsers, setAllUsers, searchUsers,
    deleteChat,
  } = useConversations(token);

  const [activeChat, setActiveChat] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [contextMenu, setContextMenu] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [sharedKey, setSharedKey] = useState(null);
  const [e2eeReady, setE2eeReady] = useState(false);
  const isMobile = useIsMobile();
  const privateKeyRef = useRef(null);
  const sharedKeyCache = useRef(new Map());

  useEffect(() => {
    (async () => {
      try {
        let privKey = await loadPrivateKey();
        if (!privKey) {
          const keyPair = await generateKeyPair();
          privKey = keyPair.privateKey;
          await savePrivateKey(privKey);
          const pubJwk = await exportPublicKey(keyPair.publicKey);
          await apiFetch('/api/keys', token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicKey: JSON.stringify(pubJwk) }),
          });
        }
        privateKeyRef.current = privKey;
        setE2eeReady(true);
      } catch (err) {
        console.error('E2EE init failed:', err);
        setE2eeReady(true);
      }
    })();
  }, [token]);

  const getSharedKey = useCallback(async (peerId) => {
    if (!privateKeyRef.current) return null;
    if (sharedKeyCache.current.has(peerId)) {
      return sharedKeyCache.current.get(peerId);
    }
    try {
      const res = await apiFetch(`/api/keys/${peerId}`, token);
      const data = await readJsonResponse(res);
      if (!data.publicKey) return null;
      const peerPubKey = await importPublicKey(JSON.parse(data.publicKey));
      const derived = await deriveSharedKey(privateKeyRef.current, peerPubKey);
      sharedKeyCache.current.set(peerId, derived);
      return derived;
    } catch {
      return null;
    }
  }, [token]);

  const handleNewMessage = useCallback((msg) => {
    const otherUserId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
    setConversations(prev => {
      const existing = prev.find(c => c.id === otherUserId);
      if (existing) {
        return [
          { ...existing, last_message: msg.encrypted ? '...' : msg.content, last_message_at: msg.created_at },
          ...prev.filter(c => c.id !== otherUserId),
        ];
      }
      loadConversations();
      return prev;
    });
  }, [user.id, setConversations, loadConversations]);

  const {
    messages, message, setMessage,
    editingMessage, editText, setEditText, editInputRef, chatRef,
    typing, loadingMessages, hasMore, loadingOlder,
    loadMessages, loadOlderMessages, sendMessage, retryMessage, deleteMessage,
    startEdit, saveEdit, cancelEdit, handleTyping,
  } = useMessages(token, socket, user, activeChat, handleNewMessage, sharedKey);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (!socket) return;
    const handleCallIncoming = (data) => setActiveCall({ incoming: true, ...data });
    const handleConversationDeleted = (data) => {
      setConversations(prev => prev.filter(c => c.id !== data.userId));
      if (activeChat?.id === data.userId) setActiveChat(null);
    };
    socket.on('call_incoming', handleCallIncoming);
    socket.on('conversation_deleted', handleConversationDeleted);
    return () => {
      socket.off('call_incoming', handleCallIncoming);
      socket.off('conversation_deleted', handleConversationDeleted);
    };
  }, [socket, activeChat, setConversations]);

  useEffect(() => {
    if (connectionStatus === 'connected') loadConversations();
  }, [connectionStatus, loadConversations]);

  const closeAllMenus = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    const handler = () => closeAllMenus();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [closeAllMenus]);

  const isOnline = (userId) => onlineUsers.includes(userId);

  const openChat = async (chatUser) => {
    setActiveChat(chatUser);
    setShowSearch(false);
    setShowMobileSearch(false);
    setSearch('');
    setAllUsers([]);
    closeAllMenus();
    if (isMobile) setShowSidebar(false);

    const key = await getSharedKey(chatUser.id);
    setSharedKey(key);

    await loadMessages(chatUser);
  };

  const showContextMenu = (e, msg) => {
    e.preventDefault();
    e.stopPropagation();
    const isOwn = msg.sender_id === user.id;
    let x = e.clientX || e.currentTarget.getBoundingClientRect().right;
    let y = e.clientY || e.currentTarget.getBoundingClientRect().top;
    if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
    if (y + 180 > window.innerHeight) y = window.innerHeight - 190;
    if (x < 10) x = 10;
    setContextMenu({ x, y, message: msg, isOwn });
  };

  const showMsgMenu = (e, msg) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const isOwn = msg.sender_id === user.id;
    let x = isOwn ? rect.left - 190 : rect.right + 10;
    let y = rect.top;
    if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
    if (x < 10) x = 10;
    if (y + 180 > window.innerHeight) y = window.innerHeight - 190;
    setContextMenu({ x, y, message: msg, isOwn });
  };

  const requestDeleteChat = (userId, name) => {
    closeAllMenus();
    setConfirmDialog({ type: 'deleteChat', userId, name });
  };

  const confirmAction = async (forBoth) => {
    if (!confirmDialog) return;
    if (confirmDialog.type === 'deleteChat') {
      const ok = await deleteChat(confirmDialog.userId, forBoth);
      if (ok) {
        if (activeChat?.id === confirmDialog.userId) {
          setActiveChat(null);
        }
        loadConversations();
      }
    } else if (confirmDialog.type === 'deleteMessageForEveryone') {
      await deleteMessage(confirmDialog.message, true);
      loadConversations();
    }
    setConfirmDialog(null);
  };

  const copyMessage = (msg) => {
    navigator.clipboard.writeText(msg.content).catch(() => {});
    closeAllMenus();
  };

  const handleEdit = (msg) => {
    startEdit(msg);
    closeAllMenus();
  };

  const handleDeleteForMe = (msg) => {
    deleteMessage(msg, false);
    closeAllMenus();
  };

  const handleDeleteForEveryone = (msg) => {
    closeAllMenus();
    setConfirmDialog({
      type: 'deleteMessageForEveryone',
      message: msg,
      name: activeChat?.display_name,
    });
  };

  return (
    <div className="messenger-layout" onClick={closeAllMenus}>
      <Sidebar
        conversations={conversations}
        activeChat={activeChat}
        openChat={openChat}
        isOnline={isOnline}
        showSearch={showSearch}
        setShowSearch={setShowSearch}
        search={search}
        searchUsers={searchUsers}
        allUsers={allUsers}
        setShowMobileSearch={setShowMobileSearch}
        requestDeleteChat={requestDeleteChat}
        user={user}
        onLogout={onLogout}
        onOpenDiagnostics={onOpenDiagnostics}
        isMobile={isMobile}
        showSidebar={showSidebar}
      />

      <ChatArea
        activeChat={activeChat}
        messages={messages}
        loadingMessages={loadingMessages}
        hasMore={hasMore}
        loadingOlder={loadingOlder}
        loadOlderMessages={loadOlderMessages}
        user={user}
        typing={typing}
        connectionStatus={connectionStatus}
        isOnline={isOnline}
        isMobile={isMobile}
        showSidebar={showSidebar}
        setShowSidebar={setShowSidebar}
        message={message}
        setMessage={setMessage}
        sendMessage={sendMessage}
        handleTyping={handleTyping}
        editingMessage={editingMessage}
        editText={editText}
        setEditText={setEditText}
        saveEdit={saveEdit}
        cancelEdit={cancelEdit}
        editInputRef={editInputRef}
        chatRef={chatRef}
        showContextMenu={showContextMenu}
        showMsgMenu={showMsgMenu}
        retryMessage={retryMessage}
        requestDeleteChat={requestDeleteChat}
        setActiveCall={setActiveCall}
      />

      <SearchOverlay
        show={showMobileSearch}
        onClose={() => setShowMobileSearch(false)}
        search={search}
        searchUsers={searchUsers}
        allUsers={allUsers}
        isOnline={isOnline}
        openChat={openChat}
      />

      {contextMenu && (
        <ContextMenu
          contextMenu={contextMenu}
          onCopy={copyMessage}
          onEdit={handleEdit}
          onDeleteForMe={handleDeleteForMe}
          onDeleteForEveryone={handleDeleteForEveryone}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          confirmDialog={confirmDialog}
          onConfirm={confirmAction}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {activeCall && (
        <CallModal
          socket={socket}
          token={token}
          user={user}
          activeChat={activeChat}
          call={activeCall}
          onClose={() => setActiveCall(null)}
        />
      )}
    </div>
  );
}

export default Messenger;
