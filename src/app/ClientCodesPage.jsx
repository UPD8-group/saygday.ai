import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useDash } from './Dashboard.jsx'
import ComplimentaryCodes from './ComplimentaryCodes.jsx'

export default function ClientCodesPage() {
  const dash = useDash()
  useEffect(() => { if (dash.canManageCodes) document.title = 'Client codes · SayGday' }, [dash.canManageCodes])
  if (!dash.canManageCodes) return <Navigate to={dash.business ? '/app/billing' : '/app'} replace />
  return <div className="settings">
    <div className="section-head"><div><h1>Client codes</h1><p className="lead">Give a client free access to SayGday.</p></div></div>
    <ComplimentaryCodes request={dash.request} />
  </div>
}
