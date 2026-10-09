// A separate email-code entry point for the oo.studio portal. Existing
// SayGday sign-in stays unchanged. Uses the same verified sender and Auth.
import { HttpError, rateLimit } from './runtime.mjs';
import { emailConfiguration } from './email.mjs';

export function studioOrigin(origin) {
 return ['https://oo.studio','https://www.oo.studio','https://oo-studio.netlify.app'].includes(origin)
 || /^https:\/\/deploy-preview-\d+--oo-studio\.netlify\.app$/.test(origin || '');
}
export function studioCodeEmail(code) {
 const digits=String(code);
 if(!/^\d{6,10}$/.test(digits))throw new HttpError(503,'We couldn’t send a code. Try again shortly.','CODE_UNAVAILABLE');
 return {
  subject:'Your oo.studio sign-in code',
  text:`Your oo.studio sign-in code is ${digits}.\n\nEnter it on the oo.studio client sign-in screen to open your private client space.\n\nKeep this code to yourself. We’ll never ask you to send it to us. If it has expired, request a fresh code at https://oo.studio/dashboard/.\n\nIf you didn’t request this email, you can safely ignore it.\n\noo.studio · Canberra & beyond.`,
  html:`<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your oo.studio sign-in code</title></head><body style="margin:0;background:#f6f3ec;color:#343039;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px"><tr><td style="font-size:35px;letter-spacing:-2px;padding-bottom:30px">oo.studio</td></tr><tr><td style="padding:32px;background:#cbb8f5;border-radius:12px"><p style="margin:0 0 16px;font-size:11px;letter-spacing:2px">YOUR CLIENT SPACE</p><h1 style="font-size:37px;font-weight:400;letter-spacing:-1px;margin:0 0 20px">Good to have you here.</h1><p style="font-size:16px;line-height:1.7;margin:0">Enter this code on the oo.studio sign-in screen.</p></td></tr><tr><td style="padding:30px 0"><p style="font-size:32px;letter-spacing:5px;font-family:monospace;margin:0;padding:25px;background:#fffdf8;border:1px solid #d8d2c8;text-align:center;border-radius:10px">${digits}</p></td></tr><tr><td style="font-size:14px;line-height:1.8"><p>Keep this code to yourself. We’ll never ask you to send it to us.</p><p>If it has expired, <a href="https://oo.studio/dashboard/" style="color:#343039">request a fresh code</a>. Didn’t request this email? You can safely ignore it.</p><p style="padding-top:20px;font-size:12px;color:#706a73">oo.studio · Canberra &amp; beyond.</p></td></tr></table></td></tr></table></body></html>`
 };
}
export async function sendStudioCode({db,body,ip,configuration=emailConfiguration(),fetchImpl=fetch}) {
 if(!configuration.configured)throw new HttpError(503,'Sign-in is temporarily unavailable. Please try again shortly.','NOT_CONFIGURED');
 const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
 if(email.length>254||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new HttpError(400,'Enter your email address.','INVALID_EMAIL');
 await rateLimit(db,'oo-sign-in:ip',ip,20,3600);
 await rateLimit(db,'oo-sign-in:minute',email,1,60);
 await rateLimit(db,'oo-sign-in:hour',email,5,3600);
 const [admin,members]=await Promise.all([
  db.from('oo_portal_admins').select('user_id').eq('email',email).eq('active',true).limit(1),
  db.from('oo_portal_members').select('workspace_id,oo_portal_workspaces!inner(active)').eq('email',email).eq('oo_portal_workspaces.active',true).limit(1)
 ]);
 if(admin.error||members.error)throw new HttpError(503,'We couldn’t check access just now. Try again shortly.','ACCESS_UNAVAILABLE');
 // Same outward response for addresses without access. Never send to them.
 if(!admin.data?.length&&!members.data?.length)return {sent:true};
 const result=await db.auth.admin.generateLink({type:'magiclink',email});
 if(result.error)throw new HttpError(503,'We couldn’t send a code. Try again shortly.','CODE_UNAVAILABLE');
 const message=studioCodeEmail(result.data?.properties?.email_otp);
 const address=String(configuration.from).match(/<([^<>]+)>/)?.[1]||configuration.from;
 const hash=String(result.data?.properties?.hashed_token||'').replace(/[^a-z0-9]/gi,'').slice(0,120);
 let response;
 try {response=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${configuration.key}`,'Content-Type':'application/json',...(hash?{'Idempotency-Key':`oo-sign-in-${hash}`}:{})},body:JSON.stringify({...message,from:`oo.studio <${address}>`,reply_to:'hello@oo.studio',to:[email]}),signal:AbortSignal.timeout(8000)});}catch{throw new HttpError(503,'We couldn’t send a code. Try again shortly.','EMAIL_UNAVAILABLE');}
 if(!response.ok)throw new HttpError(503,'We couldn’t send a code. Try again shortly.','EMAIL_UNAVAILABLE');
 return {sent:true};
}
