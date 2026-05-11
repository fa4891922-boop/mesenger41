import { useState, useEffect, useRef } from 'react';

const STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function CallModal({ socket, user, activeChat, call, onClose }) {
  const [callState, setCallState] = useState(call.incoming ? 'incoming' : 'calling');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [duration, setDuration] = useState(0);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const timerRef = useRef(null);
  const iceCandidatesQueue = useRef([]);

  const isVideo = call.callType === 'video';

  const cleanup = () => {
    clearInterval(timerRef.current);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  };

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(STUN_SERVERS);

    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit('call_ice', {
          to: call.incoming ? call.from : activeChat.id,
          candidate: e.candidate,
        });
      }
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        handleEnd();
      }
    };

    return pc;
  };

  const getMedia = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo,
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    return stream;
  };

  const startCall = async () => {
    try {
      const stream = await getMedia();
      const pc = createPeerConnection();
      pcRef.current = pc;

      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('call_offer', {
        to: activeChat.id,
        offer,
        callType: call.callType,
      });
    } catch (err) {
      console.error('startCall error:', err);
      onClose();
    }
  };

  const acceptCall = async () => {
    setCallState('active');
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);

    try {
      const stream = await getMedia();
      const pc = createPeerConnection();
      pcRef.current = pc;

      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(call.offer));

      iceCandidatesQueue.current.forEach(c => pc.addIceCandidate(c).catch(() => {}));
      iceCandidatesQueue.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('call_answer', {
        to: call.from,
        answer,
      });
    } catch (err) {
      console.error('acceptCall error:', err);
      handleEnd();
    }
  };

  const rejectCall = () => {
    socket.emit('call_reject', { to: call.from });
    onClose();
  };

  const handleEnd = () => {
    const targetId = call.incoming ? call.from : activeChat.id;
    if (socket && callState !== 'incoming') {
      socket.emit('call_end', { to: targetId });
    }
    cleanup();
    onClose();
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = muted; });
      setMuted(!muted);
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = cameraOff; });
      setCameraOff(!cameraOff);
    }
  };

  const formatDuration = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!call.incoming) {
      startCall();
    }

    const handleAnswered = async ({ answer }) => {
      setCallState('active');
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        iceCandidatesQueue.current.forEach(c => pcRef.current.addIceCandidate(c).catch(() => {}));
        iceCandidatesQueue.current = [];
      }
    };

    const handleIce = async ({ candidate }) => {
      if (pcRef.current && pcRef.current.remoteDescription) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        iceCandidatesQueue.current.push(new RTCIceCandidate(candidate));
      }
    };

    const handleEnded = () => {
      cleanup();
      onClose();
    };

    const handleRejected = () => {
      cleanup();
      onClose();
    };

    socket.on('call_answered', handleAnswered);
    socket.on('call_ice', handleIce);
    socket.on('call_ended', handleEnded);
    socket.on('call_rejected', handleRejected);

    return () => {
      socket.off('call_answered', handleAnswered);
      socket.off('call_ice', handleIce);
      socket.off('call_ended', handleEnded);
      socket.off('call_rejected', handleRejected);
      cleanup();
    };
  }, []);

  const callerName = call.incoming ? call.fromName : activeChat?.display_name;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {isVideo && (
          <div style={styles.videoContainer}>
            <video ref={remoteVideoRef} autoPlay playsInline style={styles.remoteVideo} />
            <video ref={localVideoRef} autoPlay playsInline muted style={styles.localVideo} />
          </div>
        )}

        <div style={styles.info}>
          <div style={styles.avatar}>{callerName?.[0]?.toUpperCase()}</div>
          <div style={styles.name}>{callerName}</div>
          <div style={styles.status}>
            {callState === 'incoming' && (isVideo ? 'Входящий видеозвонок' : 'Входящий звонок')}
            {callState === 'calling' && 'Звоним...'}
            {callState === 'active' && formatDuration(duration)}
          </div>
        </div>

        <div style={styles.controls}>
          {callState === 'incoming' ? (
            <>
              <button style={{ ...styles.btn, ...styles.acceptBtn }} onClick={acceptCall} title="Принять">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                  <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
                </svg>
              </button>
              <button style={{ ...styles.btn, ...styles.endBtn }} onClick={rejectCall} title="Отклонить">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                  <path d="M20.3 14.3l-2.9.7c-.4.1-.8-.1-1-.4l-1.3-2.3c-.2-.3-.1-.7.1-1L17 9.1C15.3 6.2 12.9 4 10 2.8L7.8 4.6c-.3.2-.7.3-1 .1L4.3 3.4c-.4-.2-.5-.6-.4-1L4.6 1c.2-.4.6-.5 1-.4 8.1 1.9 14 8.6 14.5 16.7.1.4-.2.9-.6 1L17 18.6l-1.3-2.3c-.2-.3-.1-.7.1-1l1.8-1.8c-.2-.5-.3-.8-.3-1.2z" transform="rotate(135 12 12)" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <button
                style={{ ...styles.btn, ...(muted ? styles.activeToggle : styles.toggleBtn) }}
                onClick={toggleMute}
                title={muted ? 'Включить микрофон' : 'Отключить микрофон'}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                  {muted ? (
                    <>
                      <line x1="1" y1="1" x2="23" y2="23" />
                      <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
                      <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v3M8 23h8" />
                    </>
                  ) : (
                    <>
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 23h8" />
                    </>
                  )}
                </svg>
              </button>

              {isVideo && (
                <button
                  style={{ ...styles.btn, ...(cameraOff ? styles.activeToggle : styles.toggleBtn) }}
                  onClick={toggleCamera}
                  title={cameraOff ? 'Включить камеру' : 'Выключить камеру'}
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    {cameraOff ? (
                      <>
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M21 21H3a2 2 0 01-2-2V8a2 2 0 012-2h3m3-3h6l2 3h4a2 2 0 012 2v9.34" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    ) : (
                      <>
                        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </>
                    )}
                  </svg>
                </button>
              )}

              <button style={{ ...styles.btn, ...styles.endBtn }} onClick={handleEnd} title="Завершить">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                  <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" transform="rotate(135 12 12)" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 500,
  },
  modal: {
    background: '#111525',
    borderRadius: '22px',
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
    minWidth: '280px',
    maxWidth: '480px',
    width: '90%',
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  videoContainer: {
    position: 'relative',
    width: '100%',
    borderRadius: '14px',
    overflow: 'hidden',
    background: '#000',
    aspectRatio: '16/9',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  localVideo: {
    position: 'absolute',
    bottom: '10px',
    right: '10px',
    width: '30%',
    borderRadius: '10px',
    border: '2px solid rgba(255,255,255,0.2)',
    objectFit: 'cover',
  },
  info: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  avatar: {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    background: '#0f3460',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '28px',
    fontWeight: '700',
    color: '#eaeaf0',
  },
  name: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#eaeaf0',
  },
  status: {
    fontSize: '14px',
    color: '#5e6073',
  },
  controls: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    color: '#fff',
  },
  endBtn: {
    background: '#ff4757',
    boxShadow: '0 4px 16px rgba(255,71,87,0.4)',
  },
  acceptBtn: {
    background: '#53d769',
    color: '#0b1a0e',
    boxShadow: '0 4px 16px rgba(83,215,105,0.4)',
  },
  toggleBtn: {
    background: 'rgba(255,255,255,0.1)',
  },
  activeToggle: {
    background: 'rgba(255,71,87,0.2)',
    color: '#ff4757',
  },
};

export default CallModal;
