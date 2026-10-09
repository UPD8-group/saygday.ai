// Run after a green npm test. Deliberately break independent billing safeguards,
// require their named tests to fail, then restore every file even on failure.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const mutations = [
  {
    file: 'src/app/billing-view.mjs',
    from: '&& billing?.accessAllowed === true && billingConfirmed(billing)',
    to: '&& billingConfirmed(billing)',
    test: 'activation celebration requires a verified website and server-confirmed subscription access after checkout',
  },
  {
    file: 'src/app/checkout-stripe.mjs',
    from: "return actions.confirm({\n    ...(!emailLocked ? { email: email.trim() } : {}),",
    to: "return actions.confirm({\n    returnUrl: 'https://saygday.ai/app/billing',\n    ...(!emailLocked ? { email: email.trim() } : {}),",
    test: 'checkout confirmation uses the server return URL and forwards an editable billing email',
  },
  {
    file: 'netlify/functions/_lib/billing.mjs',
    from: 'price.unit_amount === (legacy ? 3000 : MONTHLY_AMOUNT)',
    to: '(price.unit_amount === 3000 || price.unit_amount === (legacy ? 3000 : MONTHLY_AMOUNT))',
    test: 'configuration pins the SDK API, secret mode, origin and exact AUD monthly inclusive price',
  },
  {
    file: 'netlify/functions/_lib/billing.mjs',
    from: "if (session?.status === 'open' && !retiresPrice && session.ui_mode === 'elements' && session.expires_at > current)",
    to: "if (session?.status === 'open' && session.ui_mode === 'elements' && session.expires_at > current)",
    test: 'an unfinished A$30 Elements checkout is retired before A$40, including lost create responses',
  },
  {
    file: 'supabase/billing-card-activation.sql',
    from: 'if a.trial_started_at is not null or a.card_required then return; end if;',
    to: 'if a.trial_started_at is not null then return; end if;',
    test: 'new card activation requires verification and a confirmed payment method before any public access',
  },
  {
    file: 'netlify/functions/_lib/billing.mjs',
    from: "if (!configuration.portalReady) throw unavailable()\n  const account = await call(db, 'billing_owner', { p_user: user.id, p_business: business })",
    to: "if (!configuration.portalReady) throw unavailable()\n  const account = await call(db, 'billing_owner', { p_user: user.id, p_business: null })",
    test: 'billing ownership names one website and rejects missing or foreign selections',
  },
  {
    file: 'netlify/functions/_lib/billing.mjs',
    from: "if (session?.status === 'complete' && !(TERMINAL.has(snapshot.subscription_status)",
    to: "if (false && session?.status === 'complete' && !(TERMINAL.has(snapshot.subscription_status)",
    test: 'a customer completing the hosted link during migration blocks replacement until current Stripe state is known',
  },
  {
    file: 'supabase/billing-upgrade.sql',
    from: 'from public.businesses b where b.slug = p_slug and b.website_verified_at is not null and public.billing_access(b.id)',
    to: 'from public.businesses b where b.slug = p_slug and b.website_verified_at is not null',
    test: 'all latest public entry points enforce billing without losing colours or activity counters',
  },
  {
    file: 'src/admin/metrics.mjs',
    from: "const paid = billing.subscriptionStatus === 'active' && billing.priceValid === true",
    to: "const paid = business.plan === 'paying' || billing.subscriptionStatus === 'active' && billing.priceValid === true",
    test: 'admin uses verification trial dates and counts only fresh paid subscriptions',
  },
]
const originals = new Map()
try {
  for (const mutation of mutations) {
    const source = readFileSync(mutation.file, 'utf8')
    const normalized = source.replaceAll('\r\n', '\n')
    assert.equal(normalized.split(mutation.from).length, 2, 'mutation must match exactly once: ' + mutation.file)
    if (!originals.has(mutation.file)) originals.set(mutation.file, source)
    writeFileSync(mutation.file, normalized.replace(mutation.from, mutation.to))
  }
  // npm.cmd cannot be spawned directly on Windows. Use npm's Node entry
  // point when run by npm, with an explicit TAP reporter for stable parsing.
  const npmCli = process.env.npm_execpath
  const command = npmCli ? process.execPath : process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm'
  const args = npmCli ? [npmCli, 'test', '--', '--test-reporter=tap']
    : process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd test -- --test-reporter=tap'] : ['test', '--', '--test-reporter=tap']
  const run = spawnSync(command, args, {
    env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--test-reporter=tap'].filter(Boolean).join(' ') },
    encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024,
  })
  assert.ifError(run.error)
  assert.equal(run.signal, null, 'test process must finish normally')
  assert.equal(run.status, 1, 'deliberately broken safeguards must fail npm test')
  const failed = (run.stdout || '').split('\n').filter(line => /^not ok \d+ - /.test(line))
  for (const mutation of mutations) {
    assert.ok(failed.some(line => line.endsWith(mutation.test)), 'missing expected failure: ' + mutation.test + '\n' + failed.join('\n'))
    console.log('Mutation detected: ' + mutation.test)
  }
} finally {
  for (const [file, source] of originals) writeFileSync(file, source)
}
console.log('Original source restored.')

