import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Empty, when } from '../app/ui.jsx'
import { Avatar } from '../chat/Chat.jsx'
import { useAdmin } from './AdminApp.jsx'
import { dateLabel, number, plural } from './metrics.mjs'
import { DownloadCsv, Pips, StageChip, TrialMeter, host } from './parts.jsx'

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'trial', label: 'In free trial', test: business => ['trial', 'ending'].includes(business.stage.key) },
  { key: 'ended', label: 'Free days over', test: business => business.stage.key === 'ended' },
  { key: 'paying', label: 'Paying', test: business => business.stage.key === 'paying' },
  { key: 'cancelled', label: 'Cancelled', test: business => business.stage.key === 'cancelled' },
  { key: 'internal', label: 'Ours / test', test: business => business.stage.key === 'internal' },
]
const created = business => Date.parse(business.createdAt) || 0
const SORTS = {
  newest: { label: 'Newest first', compare: (a, b) => created(b) - created(a) },
  trial: { label: 'Free days ending first', compare: (a, b) => Date.parse(a.stage.endsAt) - Date.parse(b.stage.endsAt) },
  read: { label: 'Most answers read', compare: (a, b) => (b.answers?.read || 0) - (a.answers?.read || 0) },
  name: { label: 'Name', compare: (a, b) => a.name.localeCompare(b.name, 'en-AU') },
}

export function Businesses() {
  const { summary } = useAdmin()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('newest')
  useEffect(() => { document.title = 'Businesses · Admin · SayGday' }, [])
  const filter = FILTERS.find(item => item.key === params.get('show')) || FILTERS[0]
  const owners = useMemo(() => new Map(summary.accounts.map(account => [account.id, account])), [summary])
  const rows = useMemo(() => {
    const words = query.trim().toLowerCase()
    return summary.businesses.filter(filter.test)
      .filter(business => !words || [business.name, business.website, business.notifyEmail, owners.get(business.ownerId)?.email]
        .some(value => String(value || '').toLowerCase().includes(words)))
      .sort(SORTS[sort].compare)
  }, [summary, filter, query, sort, owners])
  return <div>
    <div className="section-head">
      <div><h1>Businesses</h1><p className="small">{plural(summary.businesses.length, 'business', 'businesses')} on SayGday, ours included. Open one to see everything about it.</p></div>
      <div className="admin-actions"><DownloadCsv summary={summary} /></div>
    </div>
    <div className="segmented segmented--wrap" role="tablist" aria-label="Show">
      {FILTERS.map(item => <button type="button" role="tab" key={item.key} aria-selected={item === filter}
        onClick={() => setParams(item.key === 'all' ? {} : { show: item.key }, { replace: true })}>
        {item.label}<span>{summary.businesses.filter(item.test).length}</span></button>)}
    </div>
    <div className="admin-tools">
      <label className="visually-hidden" htmlFor="business-search">Search</label>
      <input id="business-search" className="input" type="search" placeholder="Search names, websites and emails" value={query} onChange={event => setQuery(event.target.value)} />
      <label className="admin-tools__sort"><span>Sort</span>
        <select className="input" value={sort} onChange={event => setSort(event.target.value)}>
          {Object.entries(SORTS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select>
      </label>
    </div>
    {rows.length ? <div className="card table-card"><table className="admin-table">
      <thead><tr><th scope="col">Business</th><th scope="col">Owner</th><th scope="col">Added</th><th scope="col">Free trial</th>
        <th scope="col">Getting live</th><th scope="col" className="num">Answers</th><th scope="col" className="num">Read</th><th scope="col" className="num">Asked</th><th scope="col">Last live</th></tr></thead>
      <tbody>{rows.map(business => <tr key={business.id}>
        <td data-label="Business"><Link to={`/admin/businesses/${business.id}`} className="who">
          <Avatar character={business.character} size={32} colour={business.buttonColour} />
          <span><strong>{business.name}</strong><span className="small">{host(business.website)}</span></span></Link></td>
        <td data-label="Owner" className="cut email" title={owners.get(business.ownerId)?.email}>{owners.get(business.ownerId)?.email || <span className="small">Unknown</span>}</td>
        <td data-label="Added" className="nowrap" title={dateLabel(business.createdAt)}>{dateLabel(business.createdAt, { short: true })}</td>
        <td data-label="Free trial"><TrialMeter stage={business.stage} /></td>
        <td data-label="Getting live"><Pips progress={business.progress} /></td>
        <td data-label="Answers" className="num">{number(business.answers?.approved)}{business.answers?.drafts ? <span className="small drafts">+{number(business.answers.drafts)} drafts</span> : null}</td>
        <td data-label="Read" className="num">{number(business.answers?.read)}</td>
        <td data-label="Asked" className="num">{number(business.enquiries?.total)}</td>
        <td data-label="Last live" className="nowrap">{business.buttonSeenAt ? when(business.buttonSeenAt) : <span className="small">Not yet</span>}</td>
      </tr>)}</tbody>
    </table></div> : <div className="card"><Empty icon="search" title="No businesses here">{query ? <p>Nothing matches “{query}”.</p> : <p>None to show yet.</p>}</Empty></div>}
  </div>
}

const ACCOUNT_FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'none', label: 'No website yet', test: account => account.confirmed && !account.businesses.length },
  { key: 'code', label: 'Never entered the code', test: account => !account.confirmed },
]

// Everyone who has asked for a sign-in code, with their websites.
export function SignIns() {
  const { summary } = useAdmin()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  useEffect(() => { document.title = 'Sign-ins · Admin · SayGday' }, [])
  const filter = ACCOUNT_FILTERS.find(item => item.key === params.get('show')) || ACCOUNT_FILTERS[0]
  const words = query.trim().toLowerCase()
  const rows = summary.accounts.filter(filter.test).filter(account => !words || [account.email, ...account.businesses.flatMap(business => [business.name, business.website])]
    .some(value => String(value || '').toLowerCase().includes(words)))
  return <div>
    <div className="section-head">
      <div><h1>Sign-ins</h1><p className="small">Everyone who has asked for a sign-in code, newest first. One sign-in can hold several websites.</p></div>
    </div>
    <div className="segmented segmented--wrap" role="tablist" aria-label="Show">
      {ACCOUNT_FILTERS.map(item => <button type="button" role="tab" key={item.key} aria-selected={item === filter}
        onClick={() => setParams(item.key === 'all' ? {} : { show: item.key }, { replace: true })}>
        {item.label}<span>{summary.accounts.filter(item.test).length}</span></button>)}
    </div>
    <div className="admin-tools">
      <label className="visually-hidden" htmlFor="account-search">Search</label>
      <input id="account-search" className="input" type="search" placeholder="Search emails and websites" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    {rows.length ? <div className="card table-card"><table className="admin-table">
      <thead><tr><th scope="col">Email</th><th scope="col">First asked for a code</th><th scope="col">Last signed in</th><th scope="col">Websites</th></tr></thead>
      <tbody>{rows.map(account => <tr key={account.id}>
        <td data-label="Email" className="cut"><strong>{account.email || 'No email'}</strong></td>
        <td data-label="First asked" className="nowrap">{dateLabel(account.createdAt)}</td>
        <td data-label="Last signed in" className="nowrap">{account.lastSignInAt ? when(account.lastSignInAt) : <span className="small">Never</span>}</td>
        <td data-label="Websites">{!account.confirmed ? <span className="chip chip--muted">Never entered the code</span>
          : account.businesses.length ? <ul className="plain-list">{account.businesses.map(business => <li key={business.id}>
            <Link to={`/admin/businesses/${business.id}`}>{business.name}</Link> <StageChip stage={business.stage} /></li>)}</ul>
          : <span className="chip chip--attention">No website yet</span>}</td>
      </tr>)}</tbody>
    </table></div> : <div className="card"><Empty icon="users" title="Nobody here">{query ? <p>Nothing matches “{query}”.</p> : <p>None to show yet.</p>}</Empty></div>}
  </div>
}
