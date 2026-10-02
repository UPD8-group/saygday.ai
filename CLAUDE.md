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

- **The scan reads any website, JavaScript included** (owner, 2 October
  2026: "there has to be a way… that the scanner can read any sort of
  website, even with JavaScript… I'm going to leave this with you"). Every
  page is fetched plainly first; a page that reads nearly empty, or only
  through its `<noscript>` fallback, or that turns plain readers away, is
  opened in headless Chromium (`_lib/render.mjs`, at most 8 pages a scan).
  The browser keeps safe-fetch's rules (public HTTPS on 443 only, DNS checked
  for every host, the page never leaves the business's website, no images,
  fonts or media) and keeps web security ON: the serverless package's
  `--disable-web-security` family is filtered out (test/render.test.mjs).
  Chromium itself is `@sparticuz/chromium-min`, downloaded at cold start
  because the full browser is over Netlify's 50 MB function limit.

- **The public website is the design the owner approved on 2 October 2026**
  (a mockup he reviewed page by page, photo by photo, on his phone). It is
  plain pages in `site/`, one an address, sharing one bar, menu and footer
  (`site/chrome.mjs`, filled in at build time by `site/vite-plugin.mjs`).
  His rules for it, locked by test/site.test.mjs: the front page never
  mentions AI ("Looks like a chatbot. Answers like you."); every Unsplash
  photo is credited to its photographer (the Unsplash+ ones need none);
  "Copyright © 2026 SayGday.ai - All rights reserved." and the
  Acknowledgement of Country close every page; the company details
  (HEAR.IS PTY LTD, Civic Quarter 1, ABN) live on the Contact page, not the
  footer; nothing promises "James reads every email". Sign-in is a page of
  the website (`/login`, the card is `src/site/SignIn.jsx`), so the
  dashboard (`app.html`, at `/app`) reaches it with a full page load, never
  a router link.

- **A chat button is one of the mob or one of twelve plain buttons** (owner,
  2 October 2026: "some more versions for people - circles - + symbols").
  `shared/characters.mjs` is the one list (`PLAIN_BUTTONS`, the bubble first
  and the default); `public/widget.js` keeps an exact copy because a
  business's website loads it as a plain script, and that copy stays pure
  ASCII (G’day is `G&#8217;day`). The database check, the widget and the
  Meet the mob page are all held to the list by test/characters.test.mjs and
  test/site.test.mjs: a new look is a new key in the list, a migration, and
  a figure on the page.

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
