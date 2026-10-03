// Prints the SQL that sets SayGday up as a business on its own platform, with
// the answers in site/own-chat.mjs, owned by the account whose id is given:
//
//   node scripts/own-chat-sql.mjs <owner-user-id>
//
// Run the output in the Supabase SQL editor (or through the Supabase tools).
// It adds what isn't there and never overwrites what is: an answer the owner
// has since edited in his dashboard keeps his words. The business's
// notification email is the owner's sign-in email, as for any business.
//
// It leaves the website unverified, so the chat stays hidden until
// saygday.ai passes the same ownership check as everyone's: once the button
// is live there, scripts/own-chat-verify.mjs runs that check.
import { OWN_ANSWERS, OWN_CHAT } from '../site/own-chat.mjs'

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const text = value => `'${String(value).replace(/'/g, "''")}'`
export const textArray = values => (values.length ? `array[${values.map(text).join(', ')}]::text[]` : `'{}'::text[]`)

export function ownChatSql(ownerId) {
  if (!USER_ID.test(ownerId || '')) throw new Error('Usage: node scripts/own-chat-sql.mjs <owner-user-id>')
  const rows = OWN_ANSWERS.map((faq, index) => `  (${text(faq.question)}, ${text(faq.answer)}, ${textArray(faq.variants)}, ${faq.featured ? 'true' : 'false'}, ${index})`)
  return `begin;

insert into public.businesses (owner_id, slug, name, website, notify_email, character, greeting, signed_by)
select u.id, ${text(OWN_CHAT.slug)}, ${text(OWN_CHAT.name)}, ${text(OWN_CHAT.website)}, u.email, ${text(OWN_CHAT.character)}, ${text(OWN_CHAT.greeting)}, ${text(OWN_CHAT.signedBy)}
from auth.users u where u.id = ${text(ownerId)}
on conflict do nothing;

insert into public.faqs (business_id, question, answer, variants, status, featured, source, position)
select b.id, v.question, v.answer, v.variants, 'approved', v.featured, 'owner', v.position
from public.businesses b
cross join (values
${rows.join(',\n')}
) as v(question, answer, variants, featured, position)
where b.slug = ${text(OWN_CHAT.slug)} and b.owner_id = ${text(ownerId)}
on conflict (business_id, (lower(btrim(question)))) do nothing;

commit;
`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(ownChatSql(process.argv[2])) } catch (error) { console.error(error.message); process.exit(1) }
}
