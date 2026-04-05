import Avatar from './Avatar';

function PhoneIcon() {
  return (
    <svg className="voice-call-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
    </svg>
  );
}

export default function VoiceCallOverlay({ voice, peerUser }) {
  const {
    phase,
    muted,
    error,
    incoming,
    remoteAudioRef,
    acceptCall,
    declineCall,
    cancelRing,
    endCall,
    toggleMute,
    clearError,
  } = voice;

  const peerName =
    peerUser?.display_name || peerUser?.username || 'Contact';
  const incomingName =
    incoming?.fromDisplayName || incoming?.fromUsername || 'Someone';

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline className="voice-remote-audio" />

      {phase === 'incoming' && incoming && (
        <div className="voice-call-backdrop" role="dialog" aria-modal="true" aria-label="Incoming call">
          <div className="voice-call-card">
            <div className="voice-call-pulse" />
            <Avatar
              user={{
                username: incoming.fromUsername,
                display_name: incoming.fromDisplayName,
                avatar_color: null,
              }}
              size={88}
            />
            <h2 className="voice-call-title">{incomingName}</h2>
            <p className="voice-call-sub">Incoming voice call</p>
            <div className="voice-call-actions">
              <button type="button" className="voice-btn voice-btn-decline" onClick={declineCall} aria-label="Decline">
                <span className="voice-decline-x" aria-hidden>×</span>
              </button>
              <button type="button" className="voice-btn voice-btn-accept" onClick={acceptCall} aria-label="Accept">
                <PhoneIcon />
              </button>
            </div>
          </div>
        </div>
      )}

      {(phase === 'ringing' || phase === 'connecting' || phase === 'active') && (
        <div className="voice-call-bar">
          <div className="voice-call-bar-inner">
            <PhoneIcon />
            <span className="voice-call-bar-text">
              {phase === 'ringing' && `Calling ${peerName}…`}
              {phase === 'connecting' && 'Connecting…'}
              {phase === 'active' && `On call with ${peerName}`}
            </span>
            <div className="voice-call-bar-actions">
              {phase === 'active' && (
                <button
                  type="button"
                  className={`voice-bar-mute ${muted ? 'on' : ''}`}
                  onClick={toggleMute}
                  title={muted ? 'Unmute' : 'Mute'}
                >
                  {muted ? 'Unmute' : 'Mute'}
                </button>
              )}
              {phase === 'ringing' && (
                <button type="button" className="voice-bar-cancel" onClick={cancelRing}>
                  Cancel
                </button>
              )}
              {(phase === 'active' || phase === 'connecting') && (
                <button type="button" className="voice-bar-end" onClick={endCall}>
                  End
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="voice-call-toast">
          <span>{error}</span>
          <button type="button" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
