import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { database, rpcClient, user } from './helpers/database.mjs'
import { call } from '../netlify/functions/_lib/runtime.mjs'
import { billingCheckout, publicBilling } from '../netlify/functions/_lib/billing.mjs'

const migration = new URL('../supabase/migrations/20261015085648_admin_billing_exemption.sql', import.meta.url)
const applyExemption = async pg => pg.exec(await readFile(migration, 'utf8'))
const create = (db, owner, website, email = owner.email) => call(db, 'create_business', {
  p_user: owner.id, p_email: email, p_website: website,
})

test('verified founder profiles stay free, future profiles inherit it, and checkout never reaches Stripe', async () => {
  const pg = await database(), founder = await user(pg, 'hello@oo.studio'), customer = await user(pg)
  const db = rpcClient(pg)
  const existing = await create(db, founder, 'https://existing.example.com')
  const normal = await create(db, customer, 'https://customer.example.com', 'hello@oo.studio')
  await pg.exec('update billing_settings set enabled=true')
  await applyExemption(pg)
  // Reapplying neither duplicates history nor resets trial dates.
  const before = (await pg.query('select trial_started_at,trial_ends_at from billing_accounts where business_id=$1', [existing.id])).rows[0]
  await applyExemption(pg)
  const future = await create(db, founder, 'https://future.example.com')
  for (const business of [existing, future]) {
    const account = await call(db, 'billing_owner', { p_user: founder.id, p_business: business.id })
    const view = publicBilling(account, { checkoutReady: true }, Date.parse('2100-01-01'))
    assert.equal(view.state, 'internal')
    assert.equal(view.accessAllowed, true)
    assert.equal(view.checkoutAvailable, false)
    assert.equal(await call(db, 'billing_access', { p_business: business.id }), true)
    const stripe = new Proxy({}, { get() { assert.fail('exempt checkout must not call Stripe') } })
    await assert.rejects(billingCheckout({ db, user: founder, business: business.id, configuration: { checkoutReady: true }, stripe }),
      error => error.code === 'BILLING_NOT_ENABLED')
  }
  assert.equal((await pg.query('select plan from businesses where id=$1', [normal.id])).rows[0].plan, 'trial', 'notification email cannot grant an exemption')
  assert.equal(await call(db, 'billing_access', { p_business: normal.id }), false)
  assert.deepEqual((await pg.query('select trial_started_at,trial_ends_at from billing_accounts where business_id=$1', [existing.id])).rows[0], before)
  assert.equal((await pg.query('select count(*)::integer as n from plan_changes where business_id=$1', [existing.id])).rows[0].n, 1)
  await assert.rejects(pg.query('select admin_set_plan($1,$2)', [existing.id, 'paying']), /BILLING_EXEMPT_OWNER/)
  await assert.rejects(pg.query("update businesses set plan='trial' where id=$1", [future.id]), /BILLING_EXEMPT_OWNER/)

  // Runtime changes use only the limited server role, without auth.users reads.
  await pg.exec('set role service_role')
  const serverCreated = await create(db, founder, 'https://server.example.com')
  assert.equal((await call(db, 'billing_owner', { p_user: founder.id, p_business: serverCreated.id })).internal, true)
  await assert.rejects(pg.query('insert into billing_exempt_owners(user_id) values ($1)', [customer.id]), /permission denied/)
  await pg.exec('reset role')
  await pg.query('update businesses set owner_id=$1 where id=$2', [customer.id, future.id])
  assert.equal((await pg.query('select plan from businesses where id=$1', [future.id])).rows[0].plan, 'trial')
  assert.equal(await call(db, 'billing_access', { p_business: future.id }), false)
})

test('an unverified founder email cannot seed the exemption and browser roles cannot grant it', async () => {
  const pg = await database(), unverified = await user(pg, 'HELLO@OO.STUDIO')
  await pg.query('update auth.users set email_confirmed_at=null where id=$1', [unverified.id])
  await applyExemption(pg)
  assert.equal((await pg.query('select count(*)::integer as n from billing_exempt_owners')).rows[0].n, 0)
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`set role ${role}`)
    await assert.rejects(pg.query('select * from billing_exempt_owners'), /permission denied/)
    await assert.rejects(pg.query('insert into billing_exempt_owners(user_id) values ($1)', [unverified.id]), /permission denied/)
    await pg.exec('reset role')
  }
})
