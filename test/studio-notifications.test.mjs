import test from 'node:test'
import assert from 'node:assert/strict'
import { studioNotificationMessage, sendStudioNotification, processStudioNotifications } from '../netlify/functions/_lib/studio-notifications.mjs'
const configuration = { configured:true, key:'test-only', from:'SayGday <notifications@example.com>' }
const job = { id:'event-one', lease:'lease-one', kind:'new_request', email:'client@example.com', payload:{ business:'A & B <script>', status:'waiting', body:'PRIVATE MESSAGE', title:'PRIVATE TITLE' } }
test('all event emails are branded, escaped, private and link to the authenticated dashboard', () => {
  for (const kind of ['new_request','client_reply','studio_reply','status']) {
    const message = studioNotificationMessage({ ...job, kind }, configuration)
    assert.equal(message.from,'oo.studio <notifications@example.com>')
    assert.deepEqual(message.to,['client@example.com'])
    assert.equal(message.reply_to,'hello@oo.studio')
    assert.match(message.html,/A &amp; B &lt;script&gt;/)
    assert.match(message.html,/https:\/\/oo.studio\/dashboard\//)
    assert.match(message.html,/<html lang="en-AU">/)
    assert.doesNotMatch(message.html,/<script>/)
    assert.doesNotMatch(JSON.stringify(message),/PRIVATE MESSAGE|PRIVATE TITLE/)
  }
  assert.match(studioNotificationMessage({...job,kind:'status'},configuration).text,/Waiting on you/)
})
test('provider acceptance stores an ID and retries keep the same key and payload', async () => {
  const message = studioNotificationMessage(job,configuration), requests=[]
  const fetchImpl = async (url, options) => { requests.push({url,...options});return new Response(JSON.stringify({id:'provider-id'})) }
  for(let i=0;i<2;i++) assert.deepEqual(await sendStudioNotification({job,message,configuration,fetchImpl}),{sent:true,retryable:false,id:'provider-id'})
  assert.equal(requests[0].headers['Idempotency-Key'],'oo-notification-event-one')
  assert.equal(requests[0].body,requests[1].body)
  assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key'])
})
test('transient failures retry, permanent refusals fail, and provider bodies never leak', async () => {
  for (const status of [400,401,403,422,429,500,503]) {
    const result=await sendStudioNotification({job,message:{},configuration,fetchImpl:async()=>new Response('SECRET',{status})})
    assert.equal(result.retryable,status===429||status>=500)
    assert.doesNotMatch(JSON.stringify(result),/SECRET|test-only/)
  }
  assert.equal((await sendStudioNotification({job,message:{},configuration,fetchImpl:async()=>{throw new Error('SECRET')}})).code,'EMAIL_NETWORK')
})
test('lost access cancels even a retry with a frozen message', async () => {
  let sent=false; const called=[]
  const db={rpc:async(name,args)=>{called.push({name,args});return {data:name==='oo_claim_notifications'?[{...job,message:{to:[job.email]}}]:null,error:null}}}
  const result=await processStudioNotifications({db,configuration,send:async()=>{sent=true}})
  assert.equal(sent,false);assert.equal(result[0].status,'cancelled');assert.equal(called[1].name,'oo_prepare_notification')
})
test('worker sends exactly the frozen payload and persists the provider result with its lease', async () => {
  const frozen={to:[job.email],html:'Previously rendered'};const called=[]
  const db={rpc:async(name,args)=>{called.push({name,args});return {data:name==='oo_claim_notifications'?[job]:name==='oo_prepare_notification'?frozen:'sent',error:null}}}
  const result=await processStudioNotifications({db,configuration,send:async({message})=>{assert.equal(message,frozen);return {sent:true,id:'provider-id'}}})
  assert.equal(result[0].status,'sent');assert.equal(called[2].args.p_lease,job.lease);assert.equal(called[2].args.p_provider_id,'provider-id')
})
test('missing configuration never claims jobs',async()=>{
  await assert.rejects(processStudioNotifications({db:{rpc:()=>assert.fail('must not claim')},configuration:{configured:false}}),/not configured/)
})
test('worker failures are retried with a safe code and no secret error text',async()=>{
  const called=[];const db={rpc:async(name,args)=>{called.push({name,args});return {data:name==='oo_claim_notifications'?[job]:name==='oo_prepare_notification'?{}:'pending',error:null}}}
  await processStudioNotifications({db,configuration,send:async()=>{throw new Error('SECRET')}})
  assert.equal(called[2].args.p_retryable,true);assert.equal(called[2].args.p_code,'EMAIL_NETWORK');assert.doesNotMatch(JSON.stringify(called),/SECRET/)
})
