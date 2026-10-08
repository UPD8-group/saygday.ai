import { useDash } from './Dashboard.jsx'
import { CheckoutForBusiness } from './CheckoutForm.jsx'

export { CheckoutForBusiness } from './CheckoutForm.jsx'

export default function Checkout() {
  const { business, email: ownerEmail, request } = useDash()
  return <CheckoutForBusiness key={business.id} business={business} ownerEmail={ownerEmail} request={request} />
}
