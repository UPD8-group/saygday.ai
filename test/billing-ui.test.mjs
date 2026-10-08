import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { transformWithEsbuild } from 'vite'
import { billingConfirmed, billingDate, billingRedirect, billingReturn, billingView, UNAVAILABLE_BILLING } from '../src/app/billing-view.mjs'

// Use the project's own JSX transformer and React renderer. No browser or
// Stripe account is needed to check what an owner actually sees.
async function jsxModule(url) {
  const source = await readFile(url, 'utf8')
  const { code } = await transformWithEsbuild(source, url.pathname, { jsx: 'automatic', loader: 'jsx' })
  const imports = [...code.matchAll(/from (['"])([^'"]+)\1/g)]
  let compiled = code
  for (const [original, , specifier] of imports) {
    const target = specifier.startsWith('.') ? new URL(specifier, url) : null
    const resolved = target?.pathname.endsWith('.jsx') ? await jsxModule(target) : target?.href || import.meta.resolve(specifier)
    compiled = compiled.replace(original, `from ${JSON.stringify(resolved)}`)
  }
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
}
const { default: Billing, BillingNotice } = await import(await jsxModule(new URL('../src/app/Billing.jsx', import.meta.url)))
function render(billing, search = '') {
  return renderToStaticMarkup(React.createElement(StaticRouter, { location: `/app/settings${search}` }, React.createElement(Billing, {
    billing, request: async () => assert.fail('render cannot start checkout'), refreshBilling: async () => billing,
  })))
}

test('missing, malformed and unavailable billing never claim access or invent an upgrade', () => {
  for (const input of [null, {}, { state: 'unknown', accessAllowed: true, checkoutAvailable: true }, { state: 'unavailable', accessAllowed: true }]) {
    const view = billingView(input)
    assert.equal(view.accessAllowed, false)
    assert.equal(view.checkoutAvailable, false)
    assert.match(view.description, /chat is paused/)
  }
  assert.equal(billingView({ state: 'active', accessAllowed: 'true' }).accessAllowed, false, 'only a real server boolean permits access')
  assert.equal(billingView({ state: 'setup_pending', accessAllowed: true }).accessAllowed, true, 'an explicitly unlaunched rollout preserves existing access')
  assert.equal(billingView({ state: 'unavailable', portalAvailable: true }).portalAvailable, true, 'known customers can still fix payment during a verification failure')
})

test('every billing lifecycle has explicit copy and preserves the server access decision', () => {
  const states = ['setup_pending', 'card_required', 'trial_not_started', 'trial', 'trial_ending', 'trial_expired', 'active', 'canceling', 'past_due', 'unpaid', 'incomplete', 'canceled', 'paused', 'unavailable']
  for (const state of states) {
    const denied = billingView({ state, accessAllowed: false })
    assert.equal(denied.state, state)
    assert.ok(denied.title.length > 10, state)
    assert.match(denied.description, ['card_required', 'trial_not_started'].includes(state) ? /14 free days/ : /edit answers and read enquiries/, state)
  }
  assert.match(billingView({ state: 'canceling', accessAllowed: true, currentPeriodEnd: '2026-11-01T12:00:00Z' }).description, /will not renew/)
  assert.doesNotMatch(billingView({ state: 'active', accessAllowed: true }).description, /paused/)
  assert.equal(billingDate('garbage'), '')
  assert.equal(billingDate(null), '')
})

test('a trial never implies consent to charge; scheduled subscriptions are shown separately', () => {
  for (const state of ['trial', 'trial_ending']) {
    const billing = { state, accessAllowed: true, trialEndsAt: '2026-10-18T12:00:00Z' }
    assert.match(billingView(billing).description, /Monthly billing is not set up for this existing trial/)
    assert.equal(billingConfirmed(billing), false)
    assert.equal(billingConfirmed({ ...billing, portalAvailable: true }), false, 'a Stripe customer alone is not a paid commitment')
    assert.match(billingView({ ...billing, subscriptionScheduled: true }).description, /subscription is scheduled at A\$30 a month \(AUD\) after your free period/)
    assert.equal(billingConfirmed({ ...billing, subscriptionScheduled: true }), true)
    const canceling = billingView({ ...billing, subscriptionScheduled: true, cancelAtPeriodEnd: true }).description
    assert.match(canceling, /will not renew or start monthly billing/)
    assert.doesNotMatch(canceling, /scheduled at A\$30/)
  }
})

test('checkout returns request confirmation and cannot grant a subscription', () => {
  assert.equal(billingReturn('?checkout=success'), 'confirming')
  assert.equal(billingReturn('?checkout=canceled'), 'canceled')
  assert.equal(billingReturn('?billing=returned'), 'returned')
  assert.equal(billingReturn('?checkout=active&subscription=paid'), '')
  const html = render({ state: 'trial_expired', accessAllowed: false, checkoutAvailable: true }, '?checkout=success')
  assert.match(html, /checking your subscription with the server/)
  assert.match(html, /customer chat is paused/)
  assert.doesNotMatch(html, /subscription is active|status has been confirmed/)
  assert.match(html, /disabled=""/, 'actions cannot race the initial confirmation')
})

test('Checkout and portal destinations must be server-returned Stripe HTTPS URLs', () => {
  assert.equal(billingRedirect('https://checkout.stripe.com/c/pay/cs_test_example', 'billingCheckout'), 'https://checkout.stripe.com/c/pay/cs_test_example')
  assert.equal(billingRedirect('https://billing.stripe.com/p/session/example', 'billingPortal'), 'https://billing.stripe.com/p/session/example')
  for (const url of ['javascript:alert(1)', 'http://checkout.stripe.com/a', 'https://checkout.stripe.com.evil.test/a', 'https://evil.test/?next=checkout.stripe.com', 'https://user:password@checkout.stripe.com/a', 'https://checkout.stripe.com:444/a', '/app/settings']) {
    assert.throws(() => billingRedirect(url, 'billingCheckout'), /couldn’t open billing/)
  }
  assert.throws(() => billingRedirect('https://checkout.stripe.com/c/pay/example', 'billingPortal'))
})

test('rendered billing controls honour server capability flags and explain price, cancellation and recovery', () => {
  const expired = render({ state: 'trial_expired', accessAllowed: false, checkoutAvailable: true, portalAvailable: false })
  assert.match(expired, /Upgrade — A\$30\/month/)
  assert.match(expired, /month AUD/)
  assert.match(expired, /Card details are required to activate a new chat/)
  assert.doesNotMatch(expired, />Manage billing</)
  const active = render({ state: 'active', accessAllowed: true, portalAvailable: true, checkoutAvailable: false })
  assert.match(active, />Manage billing</)
  assert.match(active, /update your payment method, see invoices or cancel/)
  assert.doesNotMatch(active, /Upgrade —/)
  const failure = render({ ...UNAVAILABLE_BILLING, portalAvailable: true })
  assert.match(failure, /Refresh billing status/)
  assert.match(failure, />Manage billing</)
  assert.doesNotMatch(failure, /Upgrade —/)
  const ending = render({ state: 'trial_ending', accessAllowed: true, checkoutAvailable: false })
  assert.match(ending, /Card setup will be available when it ends/)
  assert.doesNotMatch(ending, /Upgrade —/)
})

test('billing explains card collection after verification and automatic monthly renewal', () => {
  const activation = render({ state: 'card_required', accessAllowed: false, checkoutAvailable: true })
  assert.match(activation, /Activate.*14 days free/)
  assert.match(activation, /Nothing to pay today/)
  const start = /verify your website first/
  assert.match(billingView({ state: 'trial_not_started', accessAllowed: false }).description, start)
  const html = render({ state: 'trial_not_started', accessAllowed: false, checkoutAvailable: false })
  assert.match(html, /Build and preview for free/)
  assert.match(html, /Verify your website, then add your card securely through Stripe/)
  assert.match(html, /Card details are required to activate a new chat/)
  assert.match(html, /automatically unless you cancel/)
})

test('dashboard notice links directly to billing without hiding owner tools', () => {
  const html = renderToStaticMarkup(React.createElement(StaticRouter, { location: '/app' }, React.createElement(BillingNotice, { billing: { state: 'past_due', accessAllowed: false } })))
  assert.match(html, /href="\/app\/settings#billing"/)
  assert.match(html, /payment needs attention/)
  assert.match(html, /edit answers and read enquiries/)
})

test('billing refresh is authoritative, bounded and used by both live indicators', async () => {
  const dashboard = await readFile(new URL('../src/app/Dashboard.jsx', import.meta.url), 'utf8')
  const billing = await readFile(new URL('../src/app/Billing.jsx', import.meta.url), 'utf8')
  const button = await readFile(new URL('../src/app/ChatButton.jsx', import.meta.url), 'utf8')
  assert.match(dashboard, /request\('billingStatus'\)/)
  assert.match(dashboard, /billing: \{ \.\.\.UNAVAILABLE_BILLING, portalAvailable: current\.billing\?\.portalAvailable === true \}/, 'a refresh failure removes stale access and preserves payment recovery')
  assert.match(dashboard, /addEventListener\('focus', refreshVisible\)/)
  assert.match(dashboard, /const available = verified && billing\.accessAllowed/)
  assert.match(dashboard, /: !billing\.accessAllowed \? \{/)
  assert.match(button, /!billing\.accessAllowed \? \(billing\.state === 'card_required'/)
  assert.match(billing, /!billingConfirmed\(next\) && attempts < 6/)
  assert.match(billing, /clearTimeout\(timer\)/)
  assert.doesNotMatch(billing, /setBilling|state: 'active'|localStorage|sessionStorage/)
})

test('billing and cancellation remain reachable while a website scan is running', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const dashboard = await readFile(new URL('../src/app/Dashboard.jsx', import.meta.url), 'utf8')
  assert.match(app, /path="settings" element=\{<RequireBusiness allowWhileScanning><Settings \/><\/RequireBusiness>\}/)
  for (const page of ['questions', 'asked', 'button']) assert.match(app, new RegExp(`path="${page}" element=\\{<RequireBusiness>`), `${page} keeps the existing scan gate`)
  assert.match(dashboard, /RequireBusiness\(\{ children, allowWhileScanning = false \}\)/)
  assert.match(dashboard, /!dash\.business \|\| \(!allowWhileScanning && SCANNING\.includes\(dash\.scan\?\.status\)\)/)
  assert.match(dashboard, /\{dash\.business && <nav className="tabs"/)
  assert.match(dashboard, /<\/NavLink>\s*<\/>\}\s*<NavLink to="\/app\/settings">/, 'Settings stays visible outside the scan-gated editing links')
})

