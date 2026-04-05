import { useState, useRef, useCallback, useEffect } from 'react';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function numId(v) {
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export function useVoiceCall({
  socket,
  userId,
  selectedConversationId,
  otherUser,
  onSwitchConversation,
}) {
  const [phase, setPhase] = useState('idle');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [incoming, setIncoming] = useState(null);

  const remoteAudioRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerUserIdRef = useRef(null);
  const activeConvIdRef = useRef(null);
  const isCallerRef = useRef(false);
  const pendingIceRef = useRef([]);

  const flushIce = useCallback((pc) => {
    const q = pendingIceRef.current;
    pendingIceRef.current = [];
    q.forEach((c) => {
      pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    });
  }, []);

  const stopLocal = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
  }, []);

  const closePc = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingIceRef.current = [];
  }, []);

  const resetUi = useCallback(() => {
    setPhase('idle');
    setIncoming(null);
    setMuted(false);
    peerUserIdRef.current = null;
    activeConvIdRef.current = null;
    isCallerRef.current = false;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, []);

  const teardown = useCallback(
    (opts = {}) => {
      const { notifyPeer } = opts;
      const peer = peerUserIdRef.current;
      const conv = activeConvIdRef.current;
      if (notifyPeer && socket?.connected && peer != null && conv != null) {
        socket.emit('voice:hangup', {
          conversationId: conv,
          targetUserId: peer,
        });
      }
      stopLocal();
      closePc();
      resetUi();
    },
    [socket, stopLocal, closePc, resetUi]
  );

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const teardownRef = useRef(teardown);
  teardownRef.current = teardown;

  const addIceSafe = useCallback(
    (pc, candidate) => {
      if (!candidate) return;
      if (pc.remoteDescription?.type) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        pendingIceRef.current.push(candidate);
      }
    },
    []
  );

  const createPeerConnection = useCallback(
    (targetUserId, convId) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      pc.onicecandidate = (ev) => {
        if (!ev.candidate || !socket?.connected) return;
        socket.emit('voice:ice', {
          conversationId: convId,
          targetUserId,
          candidate: ev.candidate.toJSON(),
        });
      };
      pc.ontrack = (ev) => {
        const [stream] = ev.streams;
        if (remoteAudioRef.current && stream) {
          remoteAudioRef.current.srcObject = stream;
        }
      };
      return pc;
    },
    [socket]
  );

  const attachLocal = useCallback(async (pc) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    localStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
    return stream;
  }, []);

  const startCall = useCallback(async () => {
    setError('');
    const oid = numId(otherUser?.id);
    const cid = numId(selectedConversationId);
    if (phase !== 'idle' || !socket?.connected || oid == null || cid == null) return;
    peerUserIdRef.current = oid;
    activeConvIdRef.current = cid;
    isCallerRef.current = true;
    setPhase('ringing');
    socket.emit('voice:ring', { conversationId: cid, targetUserId: oid });
  }, [socket, phase, otherUser, selectedConversationId]);

  const cancelRing = useCallback(() => {
    const peer = peerUserIdRef.current;
    const conv = activeConvIdRef.current;
    if (socket?.connected && peer != null && conv != null) {
      socket.emit('voice:cancel', { conversationId: conv, targetUserId: peer });
    }
    teardown();
  }, [socket, teardown]);

  const declineCall = useCallback(() => {
    if (!incoming || !socket?.connected) {
      setIncoming(null);
      setPhase('idle');
      return;
    }
    const fromId = numId(incoming.fromUserId);
    const conv = numId(incoming.conversationId);
    if (fromId != null && conv != null) {
      socket.emit('voice:decline', { conversationId: conv, targetUserId: fromId });
    }
    teardown();
  }, [incoming, socket, teardown]);

  const acceptCall = useCallback(async () => {
    if (!incoming || !socket?.connected) return;
    setError('');
    const fromId = numId(incoming.fromUserId);
    const conv = numId(incoming.conversationId);
    if (fromId == null || conv == null) return;

    if (numId(selectedConversationId) !== conv && typeof onSwitchConversation === 'function') {
      onSwitchConversation(conv);
    }

    peerUserIdRef.current = fromId;
    activeConvIdRef.current = conv;
    isCallerRef.current = false;
    setIncoming(null);
    setPhase('connecting');

    try {
      const pc = createPeerConnection(fromId, conv);
      await attachLocal(pc);
      socket.emit('voice:accept', { conversationId: conv, targetUserId: fromId });
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Microphone access denied or unavailable');
      teardown();
    }
  }, [
    incoming,
    socket,
    selectedConversationId,
    onSwitchConversation,
    createPeerConnection,
    attachLocal,
    teardown,
  ]);

  const endCall = useCallback(() => {
    if (phase === 'ringing') {
      cancelRing();
      return;
    }
    teardown({ notifyPeer: phase === 'active' || phase === 'connecting' });
  }, [phase, cancelRing, teardown]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  useEffect(() => {
    if (!socket) return;

    const onIncoming = (payload) => {
      const me = numId(userId);
      const from = numId(payload?.fromUserId);
      const conv = numId(payload?.conversationId);
      if (me == null || from == null || conv == null || from === me) return;
      const ph = phaseRef.current;
      if (ph !== 'idle' && ph !== 'incoming') return;
      setIncoming({
        conversationId: conv,
        fromUserId: from,
        fromUsername: payload.fromUsername || '',
        fromDisplayName: payload.fromDisplayName || null,
      });
      setPhase('incoming');
    };

    const onCancelled = () => {
      if (isCallerRef.current) return;
      teardownRef.current();
    };

    const onAccepted = async (payload) => {
      if (!isCallerRef.current) return;
      const conv = numId(payload?.conversationId);
      const peer = numId(payload?.peerUserId);
      if (conv == null || peer == null) return;
      if (numId(activeConvIdRef.current) !== conv || numId(peerUserIdRef.current) !== peer) return;
      setPhase('connecting');
      setError('');
      try {
        const pc = createPeerConnection(peer, conv);
        await attachLocal(pc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice:offer', {
          conversationId: conv,
          targetUserId: peer,
          sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        });
        flushIce(pc);
        setPhase('active');
      } catch (e) {
        console.error(e);
        setError(e?.message || 'Could not start call');
        teardownRef.current({ notifyPeer: true });
      }
    };

    const onDeclined = () => {
      if (isCallerRef.current) {
        setError('Call declined');
        teardownRef.current();
      }
    };

    const onOffer = async (payload) => {
      if (isCallerRef.current) return;
      const conv = numId(payload?.conversationId);
      const from = numId(payload?.fromUserId);
      if (!payload?.sdp || conv == null || from == null) return;
      if (numId(activeConvIdRef.current) !== conv || numId(peerUserIdRef.current) !== from) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        flushIce(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('voice:answer', {
          conversationId: conv,
          targetUserId: from,
          sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        });
        setPhase('active');
      } catch (e) {
        console.error(e);
        setError('Connection failed');
        teardownRef.current({ notifyPeer: true });
      }
    };

    const onAnswer = async (payload) => {
      if (!isCallerRef.current) return;
      const conv = numId(payload?.conversationId);
      const from = numId(payload?.fromUserId);
      if (!payload?.sdp || conv == null || from == null) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        flushIce(pc);
      } catch (e) {
        console.error(e);
        teardownRef.current({ notifyPeer: true });
      }
    };

    const onIce = (payload) => {
      const conv = numId(payload?.conversationId);
      const from = numId(payload?.fromUserId);
      if (conv == null || from == null || !payload.candidate) return;
      if (numId(activeConvIdRef.current) !== conv || numId(peerUserIdRef.current) !== from) return;
      const pc = pcRef.current;
      if (pc) addIceSafe(pc, payload.candidate);
    };

    const onHangup = () => {
      teardownRef.current();
    };

    socket.on('voice:incoming', onIncoming);
    socket.on('voice:cancelled', onCancelled);
    socket.on('voice:accepted', onAccepted);
    socket.on('voice:declined', onDeclined);
    socket.on('voice:offer', onOffer);
    socket.on('voice:answer', onAnswer);
    socket.on('voice:ice', onIce);
    socket.on('voice:hangup', onHangup);

    return () => {
      socket.off('voice:incoming', onIncoming);
      socket.off('voice:cancelled', onCancelled);
      socket.off('voice:accepted', onAccepted);
      socket.off('voice:declined', onDeclined);
      socket.off('voice:offer', onOffer);
      socket.off('voice:answer', onAnswer);
      socket.off('voice:ice', onIce);
      socket.off('voice:hangup', onHangup);
    };
  }, [socket, userId, createPeerConnection, attachLocal, flushIce, addIceSafe]);

  useEffect(
    () => () => {
      teardownRef.current({ notifyPeer: true });
    },
    []
  );

  return {
    phase,
    muted,
    error,
    incoming,
    remoteAudioRef,
    startCall,
    acceptCall,
    declineCall,
    cancelRing,
    endCall,
    toggleMute,
    clearError: () => setError(''),
  };
}
