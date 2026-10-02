# Notes for Claude

SayGday, rebuilt from scratch on 2 October 2026 (the earlier platform is
UPD8-group/saygdayAI and still runs saygday.ai until the domain moves).

## The owner's decisions (don't relitigate in code)

- **No AI answers visitors.** Two businesses independently said they weren't
  ready for an AI chatbot answering their customers. The chat shows only
  answers the business approved, word for word, matched by code
  (`shared/matcher.mjs`, ported from the first SayGday widget). A question it
  can't match is offered to the business, never guessed at.
- **The website scan is the only AI**: one Claude call per scan drafts 20 to
  25 questions and answers, each cited from the website's own pages; an answer
  whose numbers, prices, times or contact details aren't in the cited text
  becomes the cited text word for word. Nothing a scan writes is published
  until the owner approves it.
- **"Please drop an email"**: when the chat can't answer, the visitor leaves
  their email and the business gets the question by email (Reply-To is the
  visitor). Without an email the question still shows in the dashboard.
- The dashboard is simple, big and graphical: web address in → scan → check
  answers → add the chat button.
- The Jay/James rule from the earlier platform still applies to public copy:
  the site names James, never Jay.

- **SayGday sends its own sign-in email** (owner, 2 October 2026, after the
  first sign-in arrived as Supabase's stock "Confirm your email address",
  from "Supabase Auth", with no code and a link to localhost). The server asks
  Supabase for the code with `auth.admin.generateLink` (which sends nothing)
  and emails it through Resend from `SAYGDAY_EMAIL_FROM`; the browser checks
  it with `verifyOtp` type `email`. So no Supabase dashboard setting (email
  templates, SMTP, Site URL) is part of signing in. Never bring back
  `signInWithOtp` (test/sign-in.test.mjs locks it).

## Hard rules

- The Supabase service role key never appears in chat, logs or code.
- The browser never reads a table: every table and function is revoked from
  `anon` and `authenticated` and granted to `service_role` only, and every
  owner function takes the verified user id. Keep it that way for anything new
  (tests/database.test.mjs checks every function and table).
- Critical assertions are proven against deliberately broken source before
  their green is trusted. Run the sabotage with `npm test`, never
  `node --test test/` (that form fails every run and proves nothing).
- Never `git add` while a sabotage script is running.
