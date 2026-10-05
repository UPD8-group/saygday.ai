import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Notice } from '../app/ui.jsx'
import { Avatar } from '../chat/Chat.jsx'
import { useAdmin } from './AdminApp.jsx'
import { PRICE, SCAN_COST, TRIAL_DAYS, dateLabel, dollars, investorSummary, number, percent, plural } from './metrics.mjs'
import { Columns, DownloadCsv, Funnel, Pips, Stat, TrialMeter, host } from './parts.jsx'

// The first screen: the numbers, the free trials, the road to a live chat,
// week by week, and what it costs.
export default function Overview() {
  const { summary } = useAdmin()
  useEffect(() => { document.title = 'Admin · SayGday' }, [])
  const t = summary.totals
  const asked = t.questions ? `${percent(t.questionsWithEmail / t.questions)} of all ${number(t.questions)} left an email` : 'none yet'
  return <div className="admin-overview">
    <div className="section-head">
      <div>
        <h1>How SayGday is going</h1>
        <p className="small">SayGday’s own and test businesses are left out of every number. Days and weeks run on Canberra time.</p>
      </div>
      <div className="admin-actions"><DownloadCsv summary={summary} /></div>
    </div>

    <section className="kpis" aria-label="The numbers">
      <Stat label="Businesses" value={number(t.businesses)} note={`${t.businesses7 ? `+${t.businesses7}` : 'None new'} in the last 7 days`} to="/admin/businesses" />
      <Stat label="Signed in" value={number(t.signIns)} note={`${t.signIns7 ? `+${t.signIns7}` : 'None new'} in the last 7 days`} to="/admin/sign-ins" />
      <Stat label="In their free 14 days" value={number(t.inTrial)} note={t.endingSoon ? `${t.endingSoon} end in the next 3 days` : 'None end in the next 3 days'} to="/admin/businesses?show=trial" />
      <Stat label="Free days over, not paying" value={number(t.trialEnded)} tone={t.trialEnded ? 'gold' : ''} note={t.trialEnded ? `${dollars(t.waiting)} a month if they all pay` : 'Nobody waiting'} to="/admin/businesses?show=ended" />
      <Stat label="Monthly revenue" value={dollars(t.mrr)} note={`${plural(t.paying, 'business', 'businesses')} paying · ${dollars(t.arr)} a year`} to="/admin/businesses?show=paying" />
      <Stat label="Chats live" value={number(t.live7)} note={`On a website in the last 7 days · ${number(t.proved)} proved`} />
      <Stat label="Answers read" value={number(t.answersRead)} note={t.answersRead7 ? `${number(t.answersRead7)} in the last 7 days` : 'By customers, all time'} />
      <Stat label="Customer questions" value={number(t.questions30)} note={`In the last 30 days · ${asked}`} />
    </section>

    <Trials />

    <section className="card">
      <div className="card-head">
        <h2>From sign-up to a live chat</h2>
        <p className="small">How far everyone has got, step by step. A business counts at a step once it has done that step and every one before it.</p>
      </div>
      <div className="admin-split">
        <Funnel title="People" steps={summary.funnels.accounts} />
        <Funnel title="Websites" steps={summary.funnels.businesses} />
      </div>
    </section>

    <Trends />
    <Costs />
    <Snapshot />
  </div>
}

function Trials() {
  const { summary } = useAdmin()
  const { trial, ended } = summary.pipeline
  const { trialToPaid, paying, trialFinished } = summary.totals
  return <section className="card">
    <div className="card-head">
      <h2>Free trials</h2>
      <p className="small">{TRIAL_DAYS} days from when the website was added. Trial to paid so far: <strong>{percent(trialToPaid)}</strong>{trialToPaid !== null && ` (${number(paying)} paying, of ${plural(trialFinished, 'business', 'businesses')} whose free days are over or that already pay)`}.</p>
    </div>
    <div className="admin-split">
      <div>
        <h3>In their free days</h3>
        {trial.length ? <ul className="trial-list">{trial.map(business => <TrialRow key={business.id} business={business} />)}</ul>
          : <p className="small">No business is in its free days right now.</p>}
      </div>
      <div>
        <h3>Free days over, not marked paying</h3>
        {ended.length ? <><p className="small">Mark each one paying or cancelled on its page once you know.</p>
          <ul className="trial-list">{ended.map(business => <TrialRow key={business.id} business={business} />)}</ul></>
          : <p className="small">Nobody’s waiting. Every business past its free days is marked paying or cancelled.</p>}
      </div>
    </div>
  </section>
}

function TrialRow({ business }) {
  return <li><Link to={`/admin/businesses/${business.id}`} className="trial-row">
    <Avatar character={business.character} size={36} colour={business.buttonColour} />
    <span className="trial-row__name"><strong>{business.name}</strong><span className="small">{host(business.website)}</span></span>
    <span className="trial-row__state"><TrialMeter stage={business.stage} /><Pips progress={business.progress} /></span>
  </Link></li>
}

function Trends() {
  const { summary } = useAdmin()
  const t = summary.totals
  const weeks = (pick, { tracked = false } = {}) => summary.weeks.map((week, index, all) => ({
    key: week.week, label: dateLabel(week.week, { short: true }), long: `Week of ${dateLabel(week.week, { short: true })}`,
    value: pick(week), partial: index === all.length - 1, untracked: tracked && !week.tracked,
  }))
  const months = summary.months.map((month, index, all) => ({
    key: month.month, label: dateLabel(month.month, { short: true }).replace(/^\d+ /, ''), long: dateLabel(month.month).replace(/^\d+ /, ''),
    value: month.mrr, partial: index === all.length - 1,
  }))
  const since = summary.trackingSince ? `Counted from ${dateLabel(summary.trackingSince)}, when day-by-day counting began.` : 'Counting begins with the first answer read or button seen.'
  return <section className="admin-charts" aria-label="Week by week">
    <div className="card"><Columns title="Sign-ins each week" total={`${number(t.signIns)} in all`} points={weeks(week => week.signIns)}
      unit={n => n === 1 ? 'sign-in' : 'sign-ins'} empty="No sign-ins in these twelve weeks." /></div>
    <div className="card"><Columns title="New businesses each week" total={`${number(t.businesses)} in all`} points={weeks(week => week.businesses)}
      unit={n => n === 1 ? 'new business' : 'new businesses'} empty="No new businesses in these twelve weeks." /></div>
    <div className="card"><Columns title="Chats in use each week" total="Seen on a website, or an answer read" points={weeks(week => week.liveBusinesses, { tracked: true })}
      unit={n => n === 1 ? 'chat' : 'chats'} note={since} /></div>
    <div className="card"><Columns title="Answers read each week" total={`${number(t.answersRead)} all time`} points={weeks(week => week.answersRead, { tracked: true })}
      unit={n => n === 1 ? 'answer read' : 'answers read'} note={since} /></div>
    <div className="card"><Columns title="Customer questions each week" total="Passed on to the business" points={weeks(week => week.enquiries)}
      unit={n => n === 1 ? 'question' : 'questions'} empty="No questions passed on in these twelve weeks." /></div>
    <div className="card"><Columns title="Monthly revenue" total={`${dollars(t.mrr)} now`} points={months} format={dollars} current="This month"
      unit={() => 'a month'} note={`Businesses marked paying at the end of each month, at ${dollars(PRICE)} each.`} /></div>
  </section>
}

function Costs() {
  const { summary } = useAdmin()
  const t = summary.totals
  const { sent, pending, failed } = summary.delivery
  const finished = t.scansDone + t.scansFailed
  return <section className="card">
    <div className="card-head"><h2>What it costs, and what gets through</h2></div>
    <div className="facts">
      <div><span className="facts__label">Website scans</span><strong>{number(t.scans)}</strong>
        <span className="small">{finished ? `${percent(t.scansDone / finished)} finished · ${number(t.scansFailed)} couldn’t finish` : 'None finished yet'}</span></div>
      <div><span className="facts__label">AI cost so far</span><strong>{dollars(t.aiCost[0], { cents: true })} – {dollars(t.aiCost[1], { cents: true })}</strong>
        <span className="small">About {dollars(SCAN_COST[0])} to {dollars(SCAN_COST[1])} a scan. The scan is the only AI SayGday uses.</span></div>
      <div><span className="facts__label">One month’s fee</span><strong>{dollars(PRICE)}</strong>
        <span className="small">Pays for about {Math.floor(PRICE / SCAN_COST[1])} scans at the dearest estimate. Answering customers costs nothing: no AI.</span></div>
      <div><span className="facts__label">Emails to businesses, 30 days</span><strong>{number(sent)} sent</strong>
        <span className="small">{number(pending)} waiting to send · {number(failed)} couldn’t be sent</span></div>
    </div>
  </section>
}

// The numbers in a few lines, to paste into an investor update.
function Snapshot() {
  const { summary } = useAdmin()
  const [copied, setCopied] = useState('')
  const text = investorSummary(summary)
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied('Copied. Paste it into your update.') }
    catch { setCopied('Your browser wouldn’t copy it. Select the words and copy them instead.') }
  }
  return <section className="card">
    <div className="card-head">
      <h2>For an investor update</h2>
      <p className="small">Today’s numbers in a few lines.</p>
    </div>
    <Notice kind="success" onClose={() => setCopied('')}>{copied}</Notice>
    <textarea className="input snapshot" readOnly rows={text.split('\n').length} value={text} aria-label="Today’s numbers" onFocus={event => event.target.select()} />
    <Button kind="dark" icon="copy" onClick={copy}>Copy</Button>
  </section>
}
