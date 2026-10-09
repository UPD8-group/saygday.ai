import { useEffect } from 'react'
import { useDash } from './Dashboard.jsx'
import Billing from './Billing.jsx'

// A permanent destination for payment setup and subscription management.
// The server's billing capabilities still decide which actions are available.
export default function BillingPage() {
  const dash = useDash()
  useEffect(() => { document.title = 'Billing - SayGday' }, [])
  return <div className="settings">
    <div className="section-head"><div><h1>Billing</h1><p className="lead">Set up your card or manage your subscription.</p></div></div>
    <Billing key={dash.business.id} business={dash.business} billing={dash.billing} request={dash.request} refreshBilling={dash.refreshBilling} refreshing={dash.billingRefreshing} refreshError={dash.billingError} />
  </div>
}
