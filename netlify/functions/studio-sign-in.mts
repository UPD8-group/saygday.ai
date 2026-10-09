import type { Context } from '@netlify/functions';
import { createServiceClient,errorResponse,json,readJson,HttpError } from './_lib/runtime.mjs';
import { emailConfiguration } from './_lib/email.mjs';
import { sendStudioCode,studioOrigin } from './_lib/studio-sign-in.mjs';

export default async (request:Request,context:Context)=>{
 const origin=request.headers.get('origin')||'';
 if(!studioOrigin(origin))return json(403,{error:'Open sign-in from oo.studio.','code':'ORIGIN_REQUIRED'});
 const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 let response;
 try {
  if(request.method==='GET')response=json(200,{ready:emailConfiguration().configured});
  else {
   if(request.method!=='POST')throw new HttpError(405,'Use POST.','METHOD_NOT_ALLOWED');
   response=json(200,await sendStudioCode({db:createServiceClient(),body:await readJson(request,2048),ip:context.ip}));
  }
 }catch(error){response=errorResponse(error);}
 for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
 return response;
};
export const config={path:'/api/studio-sign-in'};
