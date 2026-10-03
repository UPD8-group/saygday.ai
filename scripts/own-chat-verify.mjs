// Runs the ownership check every business gets (netlify/functions/_lib/
// verify-website.mjs) against saygday.ai, and prints the SQL that records it
// when the proof is there:
//
//   node scripts/own-chat-verify.mjs
//
// A business's button switches its chat on by itself the first time it loads
// on the business's website, because the browser names that website in the
// request's Origin. SayGday's own button is on SayGday's own site, where the
// browser sends no Origin, so this records the same check by hand. It reads
// nothing private and writes nothing: run the SQL it prints.
import { checkWebsite } from '../netlify/functions/_lib/verify-website.mjs'
import { OWN_CHAT } from '../site/own-chat.mjs'

const { method, reason } = await checkWebsite({ website: OWN_CHAT.website, slug: OWN_CHAT.slug, token: null })
if (!method) {
  console.error(`Not proven yet (${reason}). Is the button live on ${OWN_CHAT.website}?`)
  process.exit(1)
}
console.log(`-- ${OWN_CHAT.website} carries its own button (checked by ${method}).`)
console.log(`select public.mark_website_verified('${OWN_CHAT.slug}', '${OWN_CHAT.website}', '${method}');`)
