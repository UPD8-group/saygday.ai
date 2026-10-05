import { useId } from 'react'

const PATHS = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  back: 'M19 12H5M11 18l-6-6 6-6',
  check: 'M5 12.5l4.5 4.5L19 7',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3.6 9h16.8M3.6 15h16.8M12 3c2.5 2.7 3.6 5.7 3.6 9s-1.1 6.3-3.6 9c-2.5-2.7-3.6-5.7-3.6-9S9.5 5.7 12 3z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  inbox: 'M4 13l2.5-7.5A2 2 0 018.4 4h7.2a2 2 0 011.9 1.5L20 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5zM4 13h4.5l1.5 2.5h4l1.5-2.5H20',
  chat: 'M20 12a8 8 0 01-11.6 7.1L4 20l1-4.1A8 8 0 1120 12z',
  settings: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7.4 7.4 0 01-2 1.2l-.3 2h-3.6l-.3-2a7.4 7.4 0 01-2-1.2l-1.9.7-1.8-3.1 1.6-1.2a7.6 7.6 0 010-2.9L3.4 9.3l1.8-3.1 1.9.7a7.4 7.4 0 012-1.2l.3-2h3.6l.3 2a7.4 7.4 0 012 1.2l1.9-.7 1.8 3.1-1.6 1.2a7.6 7.6 0 010 2.9z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  plus: 'M12 5v14M5 12h14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  close: 'M6 6l12 12M18 6L6 18',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  // The admin page's (src/admin/).
  chart: 'M3 20h18M6 20v-8M11 20V5M16 20v-5M20.5 20V9',
  users: 'M15.5 19v-1.4a3.6 3.6 0 00-3.6-3.6H7.1a3.6 3.6 0 00-3.6 3.6V19M9.5 10.8a3.4 3.4 0 100-6.8 3.4 3.4 0 000 6.8zM20.5 19v-1.4a3.6 3.6 0 00-2.6-3.45M15.4 4.1a3.4 3.4 0 010 6.6',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.5V12l3.2 2',
  alert: 'M12 4.5l8.5 15h-17zM12 10.5v4M12 17.4h.01',
}
export function Icon({ name, size = 22, className = '' }) {
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name] || PATHS.chat} /></svg>
}

export function Logo({ small = false }) {
  return <span className={`logo${small ? ' logo--small' : ''}`}><span className="logo__mark" aria-hidden="true"><Icon name="chat" size={small ? 16 : 19} /></span><span className="logo__word">SayGday<span>.ai</span></span></span>
}

export function Button({ children, kind = 'primary', size = '', icon, iconAfter, busy = false, ...props }) {
  return <button type={props.type || 'button'} className={`btn btn--${kind}${size ? ` btn--${size}` : ''}`} aria-busy={busy || undefined} {...props} disabled={props.disabled || busy}>
    {icon && <Icon name={icon} size={size === 'big' ? 22 : 18} />}<span>{children}</span>{iconAfter && <Icon name={iconAfter} size={size === 'big' ? 22 : 18} />}
  </button>
}

export function Field({ label, hint, error, children }) {
  const id = useId()
  return <div className={`field${error ? ' field--error' : ''}`}>
    <label htmlFor={id}>{label}</label>
    {children(id, hint || error ? `${id}-note` : undefined)}
    {(error || hint) && <p className="field__note" id={`${id}-note`}>{error || hint}</p>}
  </div>
}

export function Notice({ kind = 'info', children, onClose }) {
  if (!children) return null
  return <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    <Icon name={kind === 'error' ? 'close' : kind === 'success' ? 'check' : 'sparkle'} size={18} />
    <div>{children}</div>
    {onClose && <button type="button" className="notice__close" onClick={onClose} aria-label="Dismiss"><Icon name="close" size={16} /></button>}
  </div>
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="spinner" role="status"><span className="spinner__dot" aria-hidden="true" /><span>{label}</span></div>
}

export function Empty({ icon = 'inbox', title, children }) {
  return <div className="empty"><span className="empty__icon"><Icon name={icon} size={30} /></span><h3>{title}</h3>{children}</div>
}

// "2 minutes ago", "yesterday", "3 Oct": dates in plain words.
export function when(value, now = Date.now()) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  const minutes = Math.round((now - time) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  if (hours < 48) return 'yesterday'
  return new Date(time).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
