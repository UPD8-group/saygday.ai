import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Icon } from '../app/ui.jsx'
import { STEPS, TRIAL_DAYS, businessesCsv, number, percent, plural, sydneyDay } from './metrics.mjs'

export const host = website => String(website || '').replace(/^https:\/\//, '')

// A headline number: what it is, the number, and a line to read it by.
export function Stat({ label, value, note, tone = '', to }) {
  const body = <><span className="stat__label">{label}</span><span className="stat__value">{value}</span>{note && <span className="stat__note">{note}</span>}</>
  const className = `stat card${tone ? ` stat--${tone}` : ''}`
  return to ? <Link to={to} className={className}>{body}<Icon name="arrow" size={18} className="stat__go" /></Link> : <div className={className}>{body}</div>
}

const STAGE_ICON = { trial: 'clock', ending: 'clock', ended: 'alert', paying: 'check', cancelled: 'close', internal: 'settings' }
// Where a business is, in words with an icon: never colour alone.
export function StageChip({ stage }) {
  return <span className={`chip chip--${stage.key}`}><Icon name={STAGE_ICON[stage.key] || 'clock'} size={14} />{stage.label}</span>
}

// Which of its 14 days a business is on, as a bar and in words.
export function TrialMeter({ stage }) {
  if (!['trial', 'ending', 'ended'].includes(stage.key)) return <StageChip stage={stage} />
  const share = stage.key === 'ended' ? 1 : stage.day / TRIAL_DAYS
  return <span className={`meter meter--${stage.key}`}>
    <span className="meter__track" aria-hidden="true"><span className="meter__fill" style={{ width: `${Math.round(share * 100)}%` }} /></span>
    <span className="meter__label">{stage.key === 'ended' ? stage.label : `${stage.label} · ${plural(stage.daysLeft, 'day')} left`}</span>
  </span>
}

// The six steps to a live chat, as dots, with what's next in words.
export function Pips({ progress, words = true }) {
  return <span className="pips" title={`${progress.done} of ${STEPS.length} steps`}>
    <span className="pips__dots" aria-hidden="true">{STEPS.map((step, index) => <span key={step.key} className={index < progress.done ? 'is-done' : ''} />)}</span>
    {words && <span className="pips__words">{progress.next ? `Next: ${progress.next.todo}` : 'All set up'}</span>}
    {!words && <span className="visually-hidden">{progress.done} of {STEPS.length} steps</span>}
  </span>
}

// Funnel stages are an ordered scale: one green, lighter to darker along the
// way (checked with the dataviz skill's validator: every step clears 2:1 on
// white, and neighbours stay apart).
const RAMP = ['#87bba2', '#6ea38a', '#578a73', '#43705d', '#31584a', '#1f3d32']
export function Funnel({ title, steps }) {
  const top = steps[0]?.count || 0
  return <figure className="funnel">
    <figcaption>{title}</figcaption>
    <ol>{steps.map((step, index) => {
      const width = top ? Math.max((step.count / top) * 100, step.count ? 1.5 : 0) : 0
      return <li key={step.key}>
        <span className="funnel__label">{step.label}</span>
        <span className="funnel__track" aria-hidden="true"><span className="funnel__bar" style={{ width: `${width}%`, background: RAMP[Math.round(((index + 1) * RAMP.length) / steps.length) - 1] }} /></span>
        <span className="funnel__count"><strong>{number(step.count)}</strong><span>{top ? percent(step.count / top) : '–'}</span></span>
      </li>
    })}</ol>
  </figure>
}

// A round top for the scale: 4, then 1, 2, 4, 6, 8 or 10 times a power of
// ten, so the halfway line is a whole number too.
export function niceMax(value) {
  if (!(value > 4)) return 4
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 4, 6, 8, 10]) if (step * power >= value) return step * power
  return 10 * power
}

// Columns over time, one series. Thin columns from one baseline, a hairline
// scale, the last whole period and the current one so far in words above the
// plot (any other column's on hover or focus), the current, unfinished period
// in a lighter green, and every number in a table below.
export function Columns({ title, total, points, format = number, unit, note, empty, current = 'This week' }) {
  const [active, setActive] = useState(null)
  // One stop for the Tab key; the arrow keys, Home and End move between columns.
  const [stop, setStop] = useState(points.length - 1)
  const columns = useRef([])
  const tabStop = Math.min(stop, points.length - 1)
  function move(index, event) {
    const to = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: points.length - 1 }[event.key]
    if (to === undefined) return
    event.preventDefault()
    columns.current[Math.max(0, Math.min(points.length - 1, to))]?.focus()
  }
  const counted = points.filter(point => !point.untracked)
  const max = niceMax(Math.max(0, ...counted.map(point => point.value)))
  const say = point => point.untracked ? `${point.long}: not counted yet` : `${point.long}${point.partial ? ' (so far)' : ''}: ${format(point.value)} ${unit(point.value)}`
  const latest = points.at(-1), before = points.at(-2)
  const main = active !== null ? say(points[active]) : latest?.partial && before ? say(before) : latest ? say(latest) : ''
  const sub = latest?.partial && active !== points.length - 1
    ? `${current} so far: ${latest.untracked ? 'not counted yet' : `${format(latest.value)} ${unit(latest.value)}`}` : ''
  const nothing = !counted.some(point => point.value > 0)
  return <figure className="chart">
    <figcaption className="chart__head"><h3>{title}</h3>{total && <span className="chart__total">{total}</span>}</figcaption>
    <p className="chart__readout" aria-live="polite"><span>{main}</span>{sub && <span className="chart__sub">{sub}</span>}</p>
    <div className="chart__plot">
      <div className="chart__grid" aria-hidden="true">{[max, max / 2, 0].map(tick => <span key={tick}><em>{format(tick)}</em></span>)}</div>
      <div className="chart__cols" role="group" aria-label={`${title}, one column each: the arrow keys move between them`} onMouseLeave={() => setActive(null)}>
        {points.map((point, index) => <button type="button" key={point.key} aria-label={say(point)} ref={element => { columns.current[index] = element }}
          className={`chart__col${point.partial ? ' is-partial' : ''}${point.untracked ? ' is-untracked' : ''}${active === index ? ' is-on' : ''}`}
          tabIndex={index === tabStop ? 0 : -1} onKeyDown={event => move(index, event)}
          onMouseEnter={() => setActive(index)} onFocus={() => { setActive(index); setStop(index) }} onBlur={() => setActive(null)}>
          <span className={`chart__bar${point.value > 0 ? ' has-value' : ''}`} style={{ height: point.untracked ? 0 : `${(point.value / max) * 100}%` }} />
        </button>)}
      </div>
    </div>
    <div className="chart__axis" aria-hidden="true"><span>{points[0]?.label}</span><span>{points.at(-1)?.label}</span></div>
    {(note || (nothing && empty)) && <p className="chart__note">{nothing && empty ? empty : note}</p>}
    <details className="chart__table">
      <summary>Show the numbers</summary>
      <table><tbody>{[...points].reverse().map(point => <tr key={point.key}><th scope="row">{point.long}{point.partial ? ' (so far)' : ''}</th><td>{point.untracked ? 'Not counted yet' : format(point.value)}</td></tr>)}</tbody></table>
    </details>
  </figure>
}

// Every business as a spreadsheet, for a data room or a bank.
export function DownloadCsv({ summary }) {
  function download() {
    const blob = new Blob([`\ufeff${businessesCsv(summary)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `saygday-businesses-${sydneyDay(Date.now())}.csv`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return <Button kind="ghost" icon="download" onClick={download}>Download CSV</Button>
}
