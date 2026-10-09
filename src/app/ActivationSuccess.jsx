import { useEffect, useRef, useState } from 'react'
import { Button, Icon } from './ui.jsx'

const COLOURS = ['#bd3c36', '#e9bb62', '#31584a', '#84a997', '#ed8b78', '#f3d69a']
const CONFETTI = Array.from({ length: 72 }, (_, index) => ({
  left: `${(index * 37) % 100}%`,
  backgroundColor: COLOURS[index % COLOURS.length],
  width: `${6 + index % 5}px`,
  height: `${9 + index % 7}px`,
  borderRadius: index % 3 === 0 ? '50%' : '2px',
  '--drift': `${((index * 29) % 161) - 80}px`,
  '--spin': `${(index % 2 ? -1 : 1) * (360 + (index * 47) % 540)}deg`,
  animationDuration: `${3000 + (index * 83) % 1100}ms`,
  animationDelay: `${(index * 53) % 600}ms`,
}))

// Rendered only after the parent receives confirmed subscription access from
// the server. This component is presentation only and never changes billing.
export default function ActivationSuccess({ business, onContinue }) {
  const heading = useRef(null)
  const [confetti, setConfetti] = useState(false)

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    heading.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: preference?.matches ? 'auto' : 'smooth' })
    setConfetti(!preference?.matches)
    const timer = setTimeout(() => setConfetti(false), 4800)
    const reduceMotion = event => { if (event.matches) setConfetti(false) }
    preference?.addEventListener?.('change', reduceMotion)
    return () => {
      clearTimeout(timer)
      preference?.removeEventListener?.('change', reduceMotion)
    }
  }, [])

  return <>
    {confetti && <div className="activation-confetti" aria-hidden="true">
      {CONFETTI.map((style, index) => <i key={index} style={style} />)}
    </div>}
    <section className="card activation-success" aria-labelledby="activation-success-title">
      <span className="activation-success__mark" aria-hidden="true"><Icon name="check" size={38} /></span>
      <p className="eyebrow">All set, {business.name}</p>
      <h2 id="activation-success-title" ref={heading} tabIndex={-1}>You're live!</h2>
      <p className="activation-success__message">Your subscription is confirmed and your assistant is ready to welcome customers.</p>
      <Button kind="celebrate" size="big" icon="check" onClick={onContinue}>You're live — open dashboard</Button>
    </section>
  </>
}
