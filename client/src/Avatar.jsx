export default function Avatar({ user, size = 40 }) {
  if (!user) return null;
  const name = user.display_name || user.username || '?';
  const initial = name.charAt(0).toUpperCase();
  const color = user.avatar_color || '#25D366';
  return (
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
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}
