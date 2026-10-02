// Carried over from the earlier SayGday platform (netlify/functions/_platform/
// safe-fetch.mjs): public HTTPS pages only, DNS checked on every redirect and
// the address pinned for TLS, so the scan can never be pointed at a private
// network. Size and time limits on every page.
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { parse } from 'parse5'
import { HttpError } from './runtime.mjs'

const fail = (message = 'Use a public HTTPS website address.', code = 'UNSAFE_WEBSITE') => new HttpError(400, message, code)
export function canonicalWebsite(value) {
  let url
  try { url = new URL(String(value)) } catch { throw fail() }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !url.hostname.includes('.') || isIP(url.hostname.replace(/^\[|\]$/g, '')) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(url.hostname) || url.hostname.endsWith('.')) throw fail()
  return url.origin
}
// Reject special-use addresses, including IPv4 mapped/transition IPv6. DNS is
// validated on every redirect and the selected address is pinned for TLS.
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) === 6) {
    const [a,b] = address.toLowerCase().split(':').map(x => parseInt(x || '0',16))
    return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 && !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8)) && !(a === 0x3fff && b < 0x1000)
  }
  return false
}
export function pinnedRequest(url, address, {timeoutMs,maxBytes}) {
  return new Promise((resolve,reject) => {
    let settled = false
    const finish = (error,result) => { if (settled) return; settled=true; clearTimeout(timer); error ? reject(error) : resolve(result) }
    const req = request(url, {
      method:'GET',agent:false,servername:url.hostname,
      headers:{'User-Agent':'SayGdayWebsiteScan/2.0 (+https://saygday.ai)','Accept':'text/html','Accept-Encoding':'identity'},
      lookup: (_host,options,callback) => options?.all ? callback(null,[address]) : callback(null,address.address,address.family),
    }, response => {
      const chunks=[]; let bytes=0
      response.on('data', chunk => {
        bytes += chunk.length
        if(bytes>maxBytes){req.destroy(); finish(fail('That page is too large to import.','WEBSITE_TOO_LARGE')); return}
        chunks.push(chunk)
      })
      response.on('end',()=>finish(null,{status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')}))
      response.on('error',()=>finish(fail('We couldn’t read that website. Please try again.','WEBSITE_UNAVAILABLE')))
    })
    const timer=setTimeout(()=>{req.destroy();finish(fail('The website took too long to respond. Please try again.','WEBSITE_TIMEOUT'))},timeoutMs)
    req.on('error',()=>finish(fail('We couldn’t read that website. Check it is publicly accessible.','WEBSITE_UNAVAILABLE')))
    req.end()
  })
}
export async function safeHtml(urlValue, dependencies={}) {
  const deadline = dependencies.deadline || Date.now()+8000
  let url=new URL(urlValue); const origin=canonicalWebsite(url)
  for(let redirect=0;redirect<=3;redirect++){
    canonicalWebsite(url)
    if(url.origin!==origin)throw fail(`This website redirects to ${url.origin}. Save that address and try again.`,'REDIRECT_ORIGIN_CHANGED')
    const remaining=deadline-Date.now(); if(remaining<=0)throw fail('The website took too long to respond.','WEBSITE_TIMEOUT')
    let timer
    const records=await Promise.race([
      (dependencies.lookup||lookup)(url.hostname,{all:true,verbatim:true}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('The website took too long to respond.','WEBSITE_TIMEOUT')),remaining)}),
    ]).finally(()=>clearTimeout(timer)).catch(error=>{if(error instanceof HttpError)throw error;throw fail('We couldn’t find this public website.','WEBSITE_UNAVAILABLE')})
    if(!records.length||records.some(record=>!isPublicAddress(record.address)))throw fail()
    const response=await (dependencies.request||pinnedRequest)(url,records[0],{timeoutMs:Math.max(1,deadline-Date.now()),maxBytes:600000})
    if([301,302,303,307,308].includes(response.status)){
      if(!response.headers.location||redirect===3)throw fail('This website redirects too many times.','WEBSITE_REDIRECT')
      url=new URL(response.headers.location,url); continue
    }
    if([404,410].includes(response.status))throw fail('This website page is no longer available.','WEBSITE_REMOVED')
    if([401,403,406,429].includes(response.status))throw fail('This website is not allowing automated reading. No worries — you can paste or upload the important information instead.','WEBSITE_ACCESS_BLOCKED')
    if(response.status!==200)throw fail('We couldn’t read the page. Check it is published and publicly accessible.','WEBSITE_UNAVAILABLE')
    if(!/^text\/html(?:\s*;|$)/i.test(response.headers['content-type']||'')||!['','identity'].includes(response.headers['content-encoding']||''))throw fail('Use a public HTML page for your website.','WEBSITE_NOT_HTML')
    if(Buffer.byteLength(response.body)>600000)throw fail('That page is too large to import.','WEBSITE_TOO_LARGE')
    return {html:response.body,url:url.href}
  }
}
const attr=(node,name)=>node.attrs?.find(a=>a.name===name)?.value
function walk(node,visit){visit(node); for(const child of node.childNodes||[])walk(child,visit)}
const compact = value => String(value || '').replace(/\s+/g, ' ').trim()
const excludedText = new Set(['head','script','style','noscript','template','svg','nav','form','iframe','canvas'])
const blockTags = new Set(['p','div','section','article','li','dt','dd','address','tr','blockquote','h1','h2','h3','h4','h5','h6'])
const hidden = node => node.attrs?.some(a => a.name === 'hidden' || (a.name === 'aria-hidden' && a.value === 'true') || (a.name === 'style' && /(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(a.value)))
const linkPriority = path => /\/(?:contact|hours|visit|location)(?:[./-]|$)/i.test(path) ? 0 : /\/(?:faq|frequently-asked-questions)(?:[./-]|$)/i.test(path) ? 1 : /\/(?:services|menu|about)(?:[./-]|$)/i.test(path) ? 2 : -1

// The website reader follows more of a site than the quick import: every
// same-origin page that could hold customer information, most useful first.
// Account, cart, admin and file links are never followed.
const readerSkip = /\/(?:wp-admin|wp-login|wp-json|login|log-in|signin|sign-in|register|account|my-account|cart|basket|checkout|search|feed|tag|tags|author|category|privacy|privacy-policy|cookies?|cookie-policy)(?:[./-]|$)|\.(?:pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp[34]|mov|ics|xml|json|txt)$/i
export function readerLinkPriority(path) {
  if (readerSkip.test(path)) return -1
  const known = linkPriority(path)
  if (known >= 0) return known
  if (/\/(?:opening-hours|find-us|locations?|faqs?|help|about-us|our-story|pricing|prices|fees|book|booking|bookings|appointments|classes|treatments|products|shop)(?:[./-]|$)/i.test(path)) return 2
  if (/\/(?:shipping|delivery|returns|refunds?|policies|policy|terms|accessibility|parking|events|functions|catering|gift-(?:vouchers?|cards?)|vouchers?|team|staff)(?:[./-]|$)/i.test(path)) return 3
  return path.split('/').filter(Boolean).length <= 2 ? 5 : -1
}

export function extractPublicPage(html,url){
  const document=parse(html),origin=new URL(url).origin,links=[],readerLinks=[],blocks=[]
  let heading='',buffer=[]
  const flush=()=>{const text=compact(buffer.join(' '));buffer=[];if(text)blocks.push({heading,text})}
  function visit(node){
    if(excludedText.has(node.tagName)||hidden(node))return
    const block=blockTags.has(node.tagName),isHeading=/^h[1-6]$/.test(node.tagName||'')
    if(block)flush()
    if(node.nodeName==='#text')buffer.push(node.value)
    if(node.tagName==='br')buffer.push(' ')
    for(const child of node.childNodes||[])visit(child)
    // Contact values often live only in a 'Call us' or 'Email us' link.
    if(node.tagName==='a'){
      const href=attr(node,'href')||'',match=/^(mailto:|tel:)([^?#]+)/i.exec(href)
      if(match){
        const value=match[2]
        const visible=compact(buffer.join(' '))
        if(!visible.includes(value)&&!(match[1].toLowerCase()==='tel:'&&visible.replace(/\D/g,'').endsWith(value.replace(/\D/g,'').replace(/^61/,'').replace(/^0/,''))))buffer.push(value)
      }
    }
    if(block){
      if(isHeading)heading=compact(buffer.join(' '))
      flush()
    }
  }
  visit(document);flush()
  // Discover public links separately: navigation is useful for finding contact
  // pages even though its labels are not business knowledge.
  function discover(node){
    if(['script','style','noscript','template','form','iframe','svg'].includes(node.tagName)||hidden(node))return
    if(node.tagName==='a')try{
      const target=new URL(attr(node,'href'),url),priority=linkPriority(target.pathname)
      target.hash=''
      const eligible=target.origin===origin&&!target.username&&!target.password&&!target.search&&target.href!==new URL(url).href
      if(eligible&&priority>=0)links.push({url:target.href,priority})
      const readerPriority=eligible?readerLinkPriority(target.pathname):-1
      if(readerPriority>=0)readerLinks.push({url:target.href,priority:readerPriority})
    }catch{}
    for(const child of node.childNodes||[])discover(child)
  }
  discover(document)
  const unique=[],seen=new Set()
  for(const block of blocks){
    if(seen.has(block.text.toLowerCase()))continue
    seen.add(block.text.toLowerCase());unique.push(block)
  }
  const text=unique.map(block=>block.text).join(' ').slice(0,18000)
  const sections=unique.filter(block=>block.text.length>=18&&text.includes(block.text)).slice(0,100)
  let title='',description=''
  walk(document,node=>{
    if(node.tagName==='title')title=compact((node.childNodes||[]).map(child=>child.value||'').join(' ')).slice(0,180)
    if(node.tagName==='meta'&&(attr(node,'name')||'').toLowerCase()==='description')description=compact(attr(node,'content')).slice(0,350)
  })
  const ranked=[],rankedSeen=new Set()
  for(const link of readerLinks.sort((a,b)=>a.priority-b.priority))if(!rankedSeen.has(link.url)){rankedSeen.add(link.url);ranked.push(link)}
  return {text,sections,title,description,links:[...new Set(links.sort((a,b)=>a.priority-b.priority).map(link=>link.url))].slice(0,2),readerLinks:ranked.slice(0,40)}
}
