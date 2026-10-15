import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { database, rpcClient, user } from './helpers/database.mjs'
import { call } from '../netlify/functions/_lib/runtime.mjs'
import { ownerAction } from '../netlify/functions/_lib/owner.mjs'
import { billingCheckout, billingConfiguration, publicBilling } from '../netlify/functions/_lib/billing.mjs'
import { createComplimentaryCode, redeemComplimentaryCode } from '../netlify/functions/_lib/complimentary.mjs'
import { billingView } from '../src/app/billing-view.mjs'
import { setupChecklist } from '../src/app/setup-flow.mjs'
import { stageOf, summarise } from '../src/admin/metrics.mjs'

const configuration = billingConfiguration(name => ({ SAYGDAY_STRIPE_SECRET_KEY:'sk_test_example', SAYGDAY_STRIPE_MODE:'test',
  SAYGDAY_STRIPE_PRICE_ID:'price_monthly', SAYGDAY_STRIPE_PUBLISHABLE_KEY:'pk_test_example', SAYGDAY_STRIPE_WEBHOOK_SECRET:'whsec_example',
  SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID:'bpc_safe', SAYGDAY_PUBLIC_URL:'https://saygday.ai' })[name])
const hash = code => createHash('sha256').update(code).digest('hex')
async function setup() {
  const pg=await database(), founder=await user(pg,'hello@oo.studio'), client=await user(pg), stranger=await user(pg)
  const db=rpcClient(pg)
  await pg.exec(await readFile(new URL('../supabase/migrations/20261015085648_admin_billing_exemption.sql',import.meta.url),'utf8'))
  await pg.exec('update billing_settings set enabled=true')
  const add = (owner,site) => call(db,'create_business',{p_user:owner.id,p_email:owner.email,p_website:site})
  const business=await add(client,'https://client.example.com'), second=await add(client,'https://second.example.com'), foreign=await add(stranger,'https://stranger.example.com')
  const issue = email => createComplimentaryCode({db,user:founder,email:email || client.email})
  const redeem = (code,options={}) => redeemComplimentaryCode({db,user:client,business:business.id,configuration,code,...options})
  return {pg,db,founder,client,stranger,business,second,foreign,issue,redeem}
}

test('only founder can issue codes; a single email-bound code grants one website free access with no Stripe purchase',async()=>{
  const s=await setup()
  await assert.rejects(createComplimentaryCode({db:s.db,user:s.client,email:s.client.email}),error=>error.code==='CODE_ADMIN_REQUIRED')
  const issued=await s.issue()
  assert.match(issued.code,/^SG-[A-F0-9]{32}$/)
  const stored=(await s.pg.query('select code_hash from billing_complimentary_codes')).rows[0].code_hash
  assert.equal(stored,hash(issued.code)); assert.notEqual(stored,issued.code)
  assert.doesNotMatch(JSON.stringify(await call(s.db,'billing_code_list',{p_user:s.founder.id})),/code_hash|SG-/)
  await assert.rejects(s.redeem(issued.code,{user:s.stranger,business:s.foreign.id}),error=>error.code==='INVALID_COMPLIMENTARY_CODE')
  await assert.rejects(s.redeem(issued.code,{business:s.foreign.id}),error=>error.code==='NO_BUSINESS')
  const stripe=new Proxy({},{get(){assert.fail('no customer means no provider call or purchase')}})
  const result=await s.redeem(issued.code,{stripe})
  assert.equal(result.billing.state,'complimentary'); assert.equal(result.billing.accessAllowed,true)
  assert.equal(result.billing.checkoutAvailable,false); assert.equal(result.billing.portalAvailable,false)
  assert.equal((await s.redeem(issued.code.toLowerCase(),{stripe})).billing.state,'complimentary','same website retries are idempotent')
  await assert.rejects(s.redeem(issued.code,{business:s.second.id}),error=>error.code==='INVALID_COMPLIMENTARY_CODE')
  await assert.rejects(billingCheckout({db:s.db,user:s.client,business:s.business.id,configuration,stripe}),error=>error.code==='BILLING_NOT_ENABLED')
  assert.equal(await call(s.db,'billing_access',{p_business:s.business.id}),true)
  assert.equal(await call(s.db,'billing_access',{p_business:s.second.id}),false)
  assert.equal(await call(s.db,'widget',{p_slug:s.business.slug}),null,'complimentary code never bypasses website verification')
  const before=(await s.pg.query('select trial_started_at,trial_ends_at from billing_accounts where business_id=$1',[s.business.id])).rows[0]
  await call(s.db,'mark_website_verified',{p_slug:s.business.slug,p_website:s.business.website,p_method:'button'})
  assert.ok(await call(s.db,'widget',{p_slug:s.business.slug}))
  assert.deepEqual((await s.pg.query('select trial_started_at,trial_ends_at from billing_accounts where business_id=$1',[s.business.id])).rows[0],before)
  assert.equal(publicBilling(await call(s.db,'billing_owner',{p_user:s.client.id,p_business:s.business.id}),configuration,Date.parse('2100-01-01')).state,'complimentary')
  await assert.rejects(call(s.db,'billing_code_revoke',{p_user:s.client.id,p_code:issued.item.id}),error=>error.code==='CODE_ADMIN_REQUIRED')
  await call(s.db,'billing_code_revoke',{p_user:s.founder.id,p_code:issued.item.id})
  assert.equal(await call(s.db,'billing_access',{p_business:s.business.id}),false)
  await assert.rejects(s.redeem(issued.code),error=>error.code==='INVALID_COMPLIMENTARY_CODE')
})

test('expired, revoked and guessed codes fail; concurrent redemptions cannot grant a second website',async()=>{
  const s=await setup(), expired=await s.issue(), revoked=await s.issue(), current=await s.issue()
  await s.pg.query("update billing_complimentary_codes set expires_at=now()-interval '1 second' where id=$1",[expired.item.id])
  await call(s.db,'billing_code_revoke',{p_user:s.founder.id,p_code:revoked.item.id})
  for(const code of [expired.code,revoked.code,'SG-'+'0'.repeat(32)])
    await assert.rejects(s.redeem(code),error=>error.code==='INVALID_COMPLIMENTARY_CODE')
  const attempts=await Promise.allSettled([s.redeem(current.code),s.redeem(current.code,{business:s.second.id})])
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1)
  assert.equal((await s.pg.query('select count(*)::integer as n from billing_accounts where complimentary')).rows[0].n,1)
  for(const role of ['anon','authenticated']) {
    await s.pg.exec(`set role ${role}`)
    await assert.rejects(s.pg.query('select * from billing_complimentary_codes'),/permission denied/)
    await assert.rejects(s.pg.query('select billing_code_create($1,$2,$3)',[s.client.id,s.client.email,hash(current.code)]),/permission denied/)
    await s.pg.exec('reset role')
  }
})

function provider({failCancel=false,completeRace=false}={}) {
  const calls=[],customer='cus_client'
  let open=true,status='active'
  const subscription=()=>({id:'sub_client',customer,livemode:false,status,created:1,items:{data:[{price:{},current_period_end:2000000000}],has_more:false}})
  return {calls,client:{
    checkout:{sessions:{list:async()=>({data:open?[{id:'cs_client',customer,mode:'subscription',livemode:false}]:[],has_more:false}),
      expire:async()=>{calls.push('expire');open=false;if(completeRace)throw Error('completed')},
      retrieve:async()=>({status:'complete',customer,livemode:false})}},
    subscriptions:{list:async()=>({data:[subscription()],has_more:false}),cancel:async(_id,params)=>{calls.push(['cancel',params]);if(failCancel)throw Error('offline');status='canceled';return subscription()}},
  }}
}

test('existing subscriptions and open checkouts stop before free access; provider failure remains retryable without a free grant',async()=>{
  const s=await setup(),issued=await s.issue()
  await s.pg.query("update billing_accounts set stripe_customer_id='cus_client',stripe_subscription_id='sub_client',subscription_status='active' where business_id=$1",[s.business.id])
  const failed=provider({failCancel:true})
  await assert.rejects(s.redeem(issued.code,{stripe:failed.client}),error=>error.code==='COMPLIMENTARY_PENDING')
  assert.equal(await call(s.db,'billing_access',{p_business:s.business.id}),false)
  assert.equal((await s.pg.query('select redeemed_at from billing_complimentary_codes where id=$1',[issued.item.id])).rows[0].redeemed_at,null)
  await assert.rejects(s.redeem(issued.code,{business:s.second.id}),error=>error.code==='INVALID_COMPLIMENTARY_CODE')
  const stripe=provider({completeRace:true})
  assert.equal((await s.redeem(issued.code,{stripe:stripe.client})).billing.state,'complimentary')
  assert.deepEqual(stripe.calls,['expire',['cancel',{invoice_now:false,prorate:false}]])
  const account=await call(s.db,'billing_owner',{p_user:s.client.id,p_business:s.business.id})
  assert.equal(account.subscription_status,'canceled'); assert.equal(account.complimentary,true)
  await call(s.db,'billing_code_revoke',{p_user:s.founder.id,p_code:issued.item.id})
  assert.equal((await call(s.db,'billing_owner',{p_user:s.client.id,p_business:s.business.id})).subscription_status,'canceled','revocation never restarts charges')
})

test('owner actions use authenticated identity, and complimentary clients count as clients with zero recurring revenue',async()=>{
  const s=await setup(),issued=await s.issue()
  const request=new Request('https://saygday.ai/api/app',{headers:{authorization:'Bearer signed-in'}})
  const act=(person,body)=>ownerAction({request,db:rpcClient(s.pg,{user:person}),body,origin:'https://saygday.ai',dependencies:{billing:{configuration}}})
  await assert.rejects(act(s.stranger,{action:'redeemComplimentaryCode',business:s.foreign.id,code:issued.code,email:s.client.email}),error=>error.code==='INVALID_COMPLIMENTARY_CODE')
  assert.equal((await act(s.client,{action:'redeemComplimentaryCode',business:s.business.id,code:issued.code})).billing.state,'complimentary')
  assert.equal((await act(s.founder,{action:'me'})).canManageCodes,true)
  assert.equal((await act(s.client,{action:'me'})).canManageCodes,false)
  await assert.rejects(act(s.client,{action:'listComplimentaryCodes'}),error=>error.code==='CODE_ADMIN_REQUIRED')
  const business=(await call(s.db,'admin_business',{p_business:s.business.id})).business
  await s.pg.query("update billing_accounts set price_override_id='price_agreed',price_override_amount=6000 where business_id=$1",[s.second.id])
  const agreed=(await call(s.db,'admin_business',{p_business:s.second.id})).business
  assert.equal(agreed.billing.monthlyAmount,6000,'complimentary reporting preserves agreed business prices')
  assert.equal(stageOf(business).key,'complimentary')
  const totals=summarise({businesses:[business],accounts:[]}).totals
  assert.equal(totals.businesses,1);assert.equal(totals.complimentary,1);assert.equal(totals.mrr,0);assert.equal(totals.paying,0)
  const view=billingView({state:'complimentary',accessAllowed:true,checkoutAvailable:false})
  assert.equal(view.title,'Complimentary access');assert.equal(view.needsAttention,false)
  assert.equal(setupChecklist({billing:{state:'complimentary'}}).find(item=>item.id==='billing').complete,true)
  await s.pg.query('update businesses set owner_id=$1 where id=$2',[s.stranger.id,s.business.id])
  assert.equal(await call(s.db,'billing_access',{p_business:s.business.id}),false,'a transfer cannot pass free access to another owner')
  assert.ok((await call(s.db,'billing_code_list',{p_user:s.founder.id}))[0].revokedAt)
})

test('checkout rechecks a concurrent free grant under its lease, and revocation waits for an active billing operation',async()=>{
  const s=await setup(),issued=await s.issue()
  await call(s.db,'mark_website_verified',{p_slug:s.business.slug,p_website:s.business.website,p_method:'button'})
  let intercepted=false
  const racingDb={...s.db,rpc:async(name,args)=>{
    if(name==='billing_acquire'&&!intercepted){intercepted=true;await s.redeem(issued.code)}
    return s.db.rpc(name,args)
  }}
  const stripe=new Proxy({},{get(){assert.fail('a concurrent complimentary grant must block Stripe Checkout')}})
  await assert.rejects(billingCheckout({db:racingDb,user:s.client,business:s.business.id,configuration,stripe}),error=>error.code==='BILLING_NOT_ENABLED')
  const locked=await call(s.db,'billing_acquire',{p_business:s.business.id})
  await assert.rejects(call(s.db,'billing_code_revoke',{p_user:s.founder.id,p_code:issued.item.id}),error=>error.code==='BILLING_CODE_BUSY')
  await call(s.db,'billing_release',{p_business:s.business.id,p_lease:locked.lease})
  assert.equal(await call(s.db,'billing_access',{p_business:s.business.id}),true)
})

test('foreign and paginated provider records cannot cancel another customer or grant free access',async()=>{
  const s=await setup(),issued=await s.issue()
  await s.pg.query("update billing_accounts set stripe_customer_id='cus_client' where business_id=$1",[s.business.id])
  for(const page of [{has_more:true,data:[]},{has_more:false,data:[{id:'cs_foreign',customer:'cus_other',livemode:false,mode:'subscription'}]}]) {
    const stripe={checkout:{sessions:{list:async()=>page}}}
    await assert.rejects(s.redeem(issued.code,{stripe}),error=>error.code==='COMPLIMENTARY_PENDING')
    assert.equal(await call(s.db,'billing_access',{p_business:s.business.id}),false)
  }
})
