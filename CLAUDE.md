# Notes for Claude

SayGday, rebuilt from scratch on 2 October 2026 (the earlier platform is
UPD8-group/saygdayAI). saygday.ai moved to this site the same day: it is a
custom domain on the Netlify project `saygdayai`, the only project that
deploys this repo, and the old `saygday` project was deleted. A second
project building this repo would serve the pages without the server's
settings, which is how sign-in broke on saygday.ai before the move.

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
  Acknowledgement of Country close every page; the company details live on
  the Contact page, not the footer, as SayGday.ai, the address, then the ABN
  (no "business name of" line, owner 3 October 2026); nothing promises
  "James reads every email". Contact is a Netlify form (`name="contact"`,
  posting to `/thanks`, sent in place by `src/site/site.js`) for businesses
  joining and anyone else, and hello@saygday.ai appears only on the privacy
  page; the privacy page says what the form keeps and that Netlify holds it. Sign-in is a page of
  the website (`/login`, the card is `src/site/SignIn.jsx`), so the
  dashboard (`app.html`, at `/app`) reaches it with a full page load, never
  a router link.

- **A chat runs only on a website its business has proved it owns** (owner,
  3 October 2026: "Somebody has to prove they own the website before they
  put the code into it"; his picks: the button proves it, a DNS TXT record
  is the backup, and the chat stays hidden until then). The proof is the
  business's own `<script src="…/widget.js" data-business="<slug>">` as a
  real script tag on its home page (www or not), or a TXT record
  `saygday-verification=<token>` on its domain
  (`netlify/functions/_lib/verify-website.mjs`). The server looks when the
  owner presses Check my website, and by itself the first time the button
  loads on the registered website (twelve checks an hour per business).
  Until then `widget`, `ask_team`, `faq_viewed` and `button_seen` serve
  nothing. A different website (www aside) starts again, and a website can
  be verified by one business only. Once verified, the button only runs
  where its request's Origin is that website, and the chat window only
  opens inside it: it reports the page that holds it (`location.ancestorOrigins`,
  or the referrer, which widget.js forces with `referrerpolicy="origin"`),
  and the chat's GET is cached per Origin. Locked by
  test/verification.test.mjs.

- **Spam limits keep no one's address** (the privacy page's promise, 2
  October 2026). `rateLimit(db, kind, subject, …)` in
  `netlify/functions/_lib/runtime.mjs` sends the database only the kind of
  limit and an HMAC of the subject (internet address, email, owner id), and
  `rate_limit()` clears rows older than a day. Never pass an address, email
  or anything readable into a rate-limit key; test/rate-limits.test.mjs
  checks the stored keys and the page's wording.

- **A chat button is one of the mob or one of twelve plain buttons** (owner,
  2 October 2026: "some more versions for people - circles - + symbols").
  `shared/characters.mjs` is the one list (`PLAIN_BUTTONS`, the bubble first
  and the default); `public/widget.js` keeps an exact copy because a
  business's website loads it as a plain script, and that copy stays pure
  ASCII (G’day is `G&#8217;day`). The database check, the widget and the
  Meet the mob page are all held to the list by test/characters.test.mjs and
  test/site.test.mjs: a new look is a new key in the list, a migration, and
  a figure on the page.

- **saygday.ai runs SayGday's own chat, as a business on its own platform**
  (owner, 3 October 2026: "put a say g'day icon for us in the bottom
  right-hand corner… more than 20 [questions], we'll really pack this thing
  out… use the G'day icon… put a pulse around it"). Business `saygday`, owned
  by the owner's own account, so its answers live in his dashboard like any
  business's; `site/own-chat.mjs` is where they started (57, every fact one
  the site already states) and `scripts/own-chat-sql.mjs` loaded them
  without ever overwriting an edited answer. Every page carries the same line
  a business pastes (`OWN_BUTTON` in site/chrome.mjs, with `data-pulse`: a gold
  ring until the chat is first opened that visit, never under reduced motion),
  so saygday.ai passes the ownership check every business does
  (`scripts/own-chat-verify.mjs` runs it; the button can't trigger it itself,
  because a same-site request carries no Origin, so widget.js also names the
  page it's on with `site=`, which the server reads only when there's no
  Origin). Locked by test/own-chat.test.mjs, which also asks the chat about
  140 questions the way visitors type them: change an answer's wording or
  variants and run it. Writing those found `does` singularised to `doe` and
  slipping past the stopwords (like `this` → `thi`); `doe` is a stopword now.

- **The chat wears the front page's example card** (owner, 3 October 2026:
  "Can we make it look like the one on the front screen? It just looks
  awesome, especially when somebody wants to inquire and add the email
  address"). Green questions; mint answers signed off in handwriting with a
  "Signed off by Sam" stamp; a gold, dashed "That's one for Sam" box with the
  email field and Send side by side and "Goes straight to Sam's inbox". The
  name is the business's own `signed_by` (the Chat button page, optional; set
  by `set_signed_by`, migration 20261003120000); without one the chat names
  the business, never a made-up person, and never guesses a pronoun. An email
  address typed into the question box ("Please message me jo@…", his
  screenshot) is caught before any matching and comes back filled in, with
  the question the chat had just offered to pass on. The words are
  `src/chat/words.mjs`; locked by test/chat-look.test.mjs.

- **On a phone, every page is its short version first** (owner, 3 October
  2026, after a friend read the site on her phone: "there's way too much
  information… a big button that shows people to go to the next page… the
  next one should probably be Is this AI?… learn more… opens all the other
  information"). The site reads in one order, the menu's: front page, Is
  this AI?, What's different, When it matters, How it works, Getting started,
  Meet the mob, Our story, Pricing (`JOURNEY` in site/chrome.mjs). When it
  matters (the Riverbend Vet example) was a section of What's different until
  the owner made it a page of its own the same day ("so that can be its own
  full page"). What's different no longer sets SayGday beside other chatbots
  (his call, the same day: "keep it almost bullet points… how we do things
  differently instead of comparing us to someone else"): above the button it
  says what SayGday does in four ticked lines, and the side-by-side table is
  gone. Above the lines, one paragraph explains the idea his friend got at
  once when he called it an interactive FAQ ("it works like the questions
  and answers on your website, except customers don't have to go looking"),
  but the site never uses that phrase, at his request ("don't say that it's
  an interactive FAQ but maybe we can explain that to them"). The examples on When it matters are made up and say so. Up to 600px wide each of
  those pages shows its photo and few lines, a big button to the next page
  (`<!-- site:phone-next -->`, filled by `phoneNext`), and Learn more, which
  opens everything marked `more`; Pricing's button is Start your free 14
  days. The front page's button says "Next: The honest answer", because the
  front page never mentions AI. Desktop shows every page whole. Without
  JavaScript a phone gets the whole page (a `<noscript>` style). Contact, the
  legal pages and sign-in are read whole. Locked by test/site.test.mjs.

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
