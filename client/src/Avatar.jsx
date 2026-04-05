export default function Avatar({ user, size = 40, presence }) {
  if (!user) return null;
  const name = user.display_name || user.username || '?';
  const initial = name.charAt(0).toUpperCase();
  const color = user.avatar_color || '#25D366';
  const showPresence = presence !== undefined && presence !== null;

  return (
    <span
      className="avatar-with-presence"
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        position: 'relative',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    >
      <div
        className="avatar"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 600,
          fontSize: size * 0.45,
          color: '#fff',
        }}
      >
        {initial}
      </div>
      {showPresence && (
        <span
          className={`presence-dot ${presence ? 'presence-dot--online' : 'presence-dot--offline'}`}
          style={{
            width: Math.max(8, size * 0.26),
            height: Math.max(8, size * 0.26),
          }}
          title={presence ? 'Online' : 'Offline'}
          aria-label={presence ? 'Online' : 'Offline'}
        />
      )}
    </span>
  );
}
