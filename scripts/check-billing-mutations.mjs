// Run after a green npm test. Deliberately break independent billing safeguards,
// require their named tests to fail, then restore every file even on failure.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const mutations = [
  {
    file: 'netlify/functions/_lib/billing.mjs',
    from: "if (!configuration.portalReady) throw unavailable()\n  const account = await call(db, 'billing_owner', { p_user: user.id, p_business: business })",
    to: "if (!configuration.portalReady) throw unavailable()\n  const account = await call(db, 'billing_owner', { p_user: user.id, p_business: null })",
    test: 'billing ownership names one website and rejects missing or foreign selections',
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
    originals.set(mutation.file, source)
    writeFileSync(mutation.file, normalized.replace(mutation.from, mutation.to))
  }
  const run = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], {
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

