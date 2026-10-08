const STRIPE_SCRIPT = 'https://js.stripe.com/dahlia/stripe.js'
let loading
const pendingCheckouts = new WeakMap()

// React StrictMode replays effects. Share only an in-flight request for the
// same request function and business, so that replay cannot race the server's
// checkout lease. Settled responses (and their secrets) are never cached here.
export function requestCheckoutBootstrap(request, businessId) {
  let businesses = pendingCheckouts.get(request)
  if (!businesses) { businesses = new Map(); pendingCheckouts.set(request, businesses) }
  if (businesses.has(businessId)) return businesses.get(businessId)
  const task = Promise.resolve().then(() => request('billingCheckout', { business: businessId }))
  businesses.set(businessId, task)
  const clear = () => { if (businesses.get(businessId) === task) businesses.delete(businessId) }
  task.then(clear, clear)
  return task
}

// Only Stripe's own hosted script handles card details. No client secret is
// included in a URL, saved in storage, or included in an error message.
export function loadCheckoutStripe() {
  if (typeof window.Stripe === 'function') return Promise.resolve(window.Stripe)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = STRIPE_SCRIPT
    script.async = true
    const timer = setTimeout(() => failed(), 20000)
    function failed() {
      clearTimeout(timer)
      script.onload = null; script.onerror = null
      script.remove()
      loading = null
      reject(new Error('Stripe could not load. Check your connection, then reload checkout.'))
    }
    script.onload = () => {
      if (typeof window.Stripe !== 'function') return failed()
      clearTimeout(timer)
      script.onload = null; script.onerror = null
      resolve(window.Stripe)
    }
    script.onerror = failed
    document.head.appendChild(script)
  })
  return loading
}
