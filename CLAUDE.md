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
  until the owner approves it. **A re-scan brings only what is new** (the
  owner's end-to-end audit, 4 October 2026: a second scan drafted fifteen
  rewordings of questions just approved): the job reads the business's known
  questions (`scan_known_questions`) and drops only equivalent questions
  with the same answer. Visitor matching is not duplicate detection: a
  specific exception must still reach the owner for review. `createBusiness` asked twice FOR THE SAME WEBSITE returns the
  business it has and never starts a second scan (a different website is
  another business under the same sign-in; the bullet below).
- **"Please drop an email"**: when the chat can't answer, the visitor leaves
  their email and the business gets the question by email (Reply-To is the
  visitor). Without an email the question still shows in the dashboard.
  An enquiry and its email job are saved together; transient delivery
  failures retry with the same provider idempotency key. Confirmations and
  the dashboard distinguish saved, pending and sent (provider accepted).
  Never queue old enquiries as part of a deployment. The inbox filters by
  status before applying its page limit, so old unanswered questions remain
  accessible.
- **Already-open chats read the current approved answers before every new
  reply.** The visitor's question stays in the browser. Refresh failure
  pauses answers instead of falling back to stale content; an old question
  button resolves its ID against current answers before displaying one.
- The dashboard is simple, big and graphical: web address in → scan → check
  answers → add the chat button.

- **One sign-in, many businesses** (owner, 4 October 2026: "it's important that
  hello@oo.studio has the ability to manage and add many different profiles —
  I'll use this as a feature when building websites for new clients"). Until
  then a business WAS its owner: `businesses.owner_id` was unique and every
  owner function found "the business" from the signed-in user alone.
  Migration 20261004130000 lifts the constraint and gives every owner function
  a `p_business` beside `p_user`, resolved in ONE place (`owned_business`): a
  sign-in with one business needn't name it, a sign-in with several must
  (`CHOOSE_BUSINESS` otherwise), and someone else's business reads as no
  business at all. The dashboard API (`_lib/owner.mjs`) takes `business` on
  every request and `me` returns `businesses` (all of them, `my_businesses`)
  beside the one named; the dashboard names the business being worked on on
  every request (remembered by slug in localStorage and `?business=`), shows a
  switcher in the bar once there are two, and adds the next one at `/app/add`
  (Settings lists them). `createBusiness` for a website the sign-in already
  has is still the business it has, no second scan. The browser still never
  picks whose data it reads: it can only name a business it owns. Locked by
  test/database.test.mjs and test/server.test.mjs. The migration is run by
  hand in the SQL editor like the others (docs/setup.md).
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
  and the chat's GET uses no-store in the browser and CDN so subscription
  changes cannot serve cached access or answers. Locked by
  test/verification.test.mjs.

- **Spam limits keep no one's address** (the privacy page's promise, 2
  October 2026). `rateLimit(db, kind, subject, …)` in
  `netlify/functions/_lib/runtime.mjs` sends the database only the kind of
  limit and an HMAC of the subject (internet address, email, owner id), and
  `rate_limit()` clears rows older than a day. Never pass an address, email
  or anything readable into a rate-limit key; test/rate-limits.test.mjs
  checks the stored keys and the page's wording.

- **A chat button is one of the mob or one of fifteen chat and symbol buttons** (owner,
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
  a business pastes (`OWN_BUTTON` in site/chrome.mjs). All buttons now have a
  faint ring for three pulses at the start of a visit, stopping immediately
  when opened, never under reduced motion. Simple buttons use their saved
  colour; animal buttons keep their artwork and use a gold ring. Existing
  embed code works unchanged; `data-pulse="off"` disables the introduction.
  SayGday.ai passes the ownership check every business does
  (`scripts/own-chat-verify.mjs` runs it; the button can't trigger it itself,
  because a same-site request carries no Origin, so widget.js also names the
  page it's on with `site=`, which the server reads only when there's no
  Origin). Locked by test/own-chat.test.mjs, which also asks the chat about
  140 questions the way visitors type them: change an answer's wording or
  variants and run it. Writing those found `does` singularised to `doe` and
  slipping past the stopwords (like `this` → `thi`); `doe` is a stopword now.

- **No privacy-policy paragraph in the dashboard** (owner, 9 October 2026).
  Remove the optional "Tell your customers" copy-and-paste card from the
  Chat button setup page. The public privacy page and its commitments stay
  in place; do not reintroduce this extra setup step.
- **The chat window fetches nothing from Google** (4 October 2026, caught by
  hear.is's Google-free sweep the day its Privacy statement went to name
  SayGday). chat.html opens inside other businesses' websites, and it was
  loading Outfit from fonts.googleapis.com, so every visitor who opened a
  chat sent their internet address to Google from the business's own site.
  The typeface is bundled now (`@fontsource/outfit`, imported in
  src/chat/main.jsx), and chat.html's content security policy allows no
  Google host. The dashboard (app.html) and the public site still load
  Outfit and Caveat from Google; they are SayGday's own pages, not a
  client's, and moving them is a separate decision. Locked by
  test/chat-look.test.mjs.

- **The chat wears the front page's example card** (owner, 3 October 2026:
  "Can we make it look like the one on the front screen? It just looks
  awesome, especially when somebody wants to inquire and add the email
  address"). Green questions; mint answers; a gold, dashed "That's one for
  Sam" box with the email field and Send side by side and "Goes straight to
  Sam's inbox". Answers carry no handwritten name or "Signed off by" stamp:
  the owner took them off saygday.ai's own chat, then every client's, the
  same day ("please remove… also the Signed off by James", "every client
  chat also removes this as well"). The header still says "Answers from Sam
  and the team". The
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
  says what SayGday is ("Think of it as an interactive FAQ", the phrase his
  friend understood at once; he first asked to avoid it, then: "I'm happy
  for it to say it's an interactive FAQ… people understand"), one paragraph
  on what that's like, and two ticked cards, What your business gets and What
  your customers get. The side-by-side table is gone. The examples on When
  it matters are made up and say so. Up to 600px wide each of those pages
  shows its photo and few lines, a big button to the next page
  (`<!-- site:phone-next -->`, filled by `phoneNext`), and Learn more, which
  opens everything marked `more`; Pricing's button is Start your free 14
  days. The front page's button says "Next: The honest answer", because the
  front page never mentions AI. Desktop shows every page whole, and its
  calls to action stand out the way the phone's big button does (owner, same
  day: "the CTAs on the desktop don't stand out as much as they do on the
  mobile"): every page's closing Next is a big gold button beside a white
  Try it free, and the front page's second button is the phone's "Next: The
  honest answer", to Is this AI?. Without
  JavaScript a phone gets the whole page (a `<noscript>` style). Contact, the
  legal pages and sign-in are read whole. Locked by test/site.test.mjs.

- **Below the photo, every page is rooms, not a run** (owner, 4 October
  2026, after his daughter read the site: "the first image that we have on
  each page looks amazing. But then when you scroll down… it's the same
  colour, similar background colour to the text, it just is a bit too much…
  break it up perhaps with boxes that have a light colour in it and the text
  over the top"; "I'll leave the styling with you… I don't need to approve
  anything"). The ground is a touch darker and warmer (`--paper`), every part
  of a page below its photo sits in its own light panel (class `panel` in
  site/*.html, styles at the end of src/site/site.css), and the panels take
  turns: white, then `panel--mint`, then `panel--cream`. A card inside a panel
  takes the opposite fill, so a box never sits on a box of its own colour. The
  photo, the words on it, the phone's Next button and the green Next block are
  untouched; Our story, Contact and the legal pages are reading pages and keep
  their layout on the new ground.

- **Day or night is the reader's choice, and day is the default** (owner, 4
  October 2026, after his desktop, set to dark, showed him a different site
  from his phone: "let's do both… an icon at the very top that allows people
  to swap between nighttime and daytime"). The public site no longer reads
  the system's dark setting: every reader gets the approved light design
  first, and a moon button in the bar (between Try it free and the menu)
  swaps to night, a sun swaps back, and `public/theme.js` (a plain script of
  the site's own, before the stylesheet, so a remembered night never flashes
  day; the content security policy allows no inline script) applies the
  choice from localStorage on the next page. Night is `:root[data-theme="dark"]`
  in site.css, redesigned so the panels still read as boxes: the ground the
  darkest, a panel a clear step above it, mint and cream tinted. The
  dashboard and the chat window stay light. Locked by test/site.test.mjs.

- **A phone gets a phone-sized photo** (owner, 4 October 2026, on his phone:
  "the images are loading way too slow… compress them all so they load faster
  on mobile"). Every page opens on a photo, and a phone was downloading the
  original (1400–2000 px, up to 240 KB) to show a 390 px slice of it.
  `scripts/site-photos.mjs` (sharp, a dev dependency) writes
  `public/site/<name>-phone.webp` beside each original, 1100 px wide at a
  lower quality, and never rewrites an original. Each photo element names
  both (`--photo-wide`, `--photo-phone`; the Story page's `<img>` has a
  `<picture>` source), site.css reads the phone copy up to 600 px wide and the
  original beyond, `composePage` preloads the right one from the head so it
  starts with the first request instead of after the stylesheet, and Netlify
  caches `/site/*` for a week. A new or changed photo gets a NEW NAME (the
  week-long cache) and a run of the script; test/site.test.mjs fails on a
  photo without its phone copy or a phone copy wider than 1100 px.

- **SayGday's own admin page, behind one password** (owner, 5 October 2026:
  "I'm unable to see how many businesses have actually signed up… where they
  might be up to in the 14-day free trial… I will put the password required to
  access it in an [environment variable] on netlify… add extra that you feel
  would be needed in order to provide insights into future VCs"). `/admin`
  (`admin.html`, `src/admin/`) and `/api/admin` (`_lib/admin.mjs`). The
  password is `SAYGDAY_ADMIN_PASSWORD` (12 characters or more, or the page
  stays switched off), compared in constant time, ten tries an hour a
  connection and fifty in all (scrambled keys, like every limit); the right one
  gets a signed twelve-hour cookie (HttpOnly, Secure, SameSite=Strict, sent to
  /api/admin only) that a new password revokes, and another website's page is
  refused. The browser never holds the password; the page fetches nothing from
  Google and is never indexed. The free 14 days run from when the website was
  added (`src/admin/metrics.mjs`). Billing is by hand, so the owner marks each
  business trial, paying, cancelled or ours/test (`businesses.plan`, every
  change kept in `plan_changes`): revenue, trial to paid and paying month by
  month count from that, and ours/test (the `saygday` business from the start)
  counts in no total. Use by the day is `business_activity` (answers opened,
  hours the button loaded: counts only, added by `faq_viewed` and
  `button_seen`). Sign-ins come from Supabase Auth's admin API (the server's
  database role can't read `auth.users`). The page sees every sign-in and
  business but never a customer's question or email address: only when one came
  in and whether the email reached the business. The CSV it downloads can't run
  a formula. Locked by test/admin.test.mjs; migration 20261005100000 is run by
  hand like the others.

## Current package (owner, 9 October 2026)

- One SayGday Assistant subscription is A$40/month AUD per business.
  It includes the website assistant, owner-approved answers, enquiry capture
  and the SayGday dashboard. Website creation, hosting and content updates
  belong to the separate oo.studio service; they are not included or advertised
  as benefits of a SayGday subscription. The oo.studio request dashboard runs
  separately at oo.studio/dashboard/; it is not a SayGday feature.
  Preserve website verification, card activation and the 14-day trial.

## Hard rules

- **Guided setup (owner, 9 October 2026):** new customers follow
  `/app/setup/answers` -> `appearance` -> `install` -> `verify` -> `preview` -> `billing`.
  Each screen has a clear next action. The sidebar shows evidence-based completion ticks. The final preview shows the saved icon and real chat; the owner explicitly approves it before continuing to billing. This acknowledgement is presentation only and never changes access. Payment follows testing the chat;
  verification remains server-owned. Billing also has a permanent
  `/app/billing` destination and stays reachable during scans. Do not hide
  an unavailable payment action without explaining its prerequisite.

- **Billing is server-owned.** Owner decision, 8 October 2026: build, scan,
  approve and preview free without a card. A new business must verify its
  website and complete Stripe Checkout with a payment method before public
  activation. Its full 14 days begin with the confirmed Stripe subscription,
  then A$40/month AUD is charged automatically unless cancelled. Existing
  started trials retain their original dates and no-card access. Apply
  supabase/billing-card-activation.sql after billing-upgrade.sql; do not
  replay the original migration on production (applied under the combined
  20261008073543 migration). docs/billing.md describes the rollout.
  Neither browser state nor a Checkout return URL grants service. Webhooks
  verify the raw signature, reconcile current Stripe state under a fenced
  database lease, and save state plus the event receipt atomically. All
  visitor entry points enforce entitlement in the database; owners can still
  manage answers, enquiries and cancellation when service is paused. Trial
  dates are immutable through retries, cancellation and domain changes.
  The custom `/app/checkout` uses Stripe's Payment Element and shows Stripe's
  first billing date instead of a rounded trial countdown (owner, 8 October
  2026). Client secrets stay in memory only. Expire any unfinished hosted
  session before replacement; a completion race must block a second purchase.

- The Supabase service role key never appears in chat, logs or code.
- The browser never reads a table: every table and function is revoked from
  `anon` and `authenticated` and granted to `service_role` only, and every
  owner function takes the verified user id. Keep it that way for anything new
  (tests/database.test.mjs checks every function and table).
- Critical assertions are proven against deliberately broken source before
  their green is trusted. Run the sabotage with `npm test`, never
  `node --test test/` (that form fails every run and proves nothing).
- Never `git add` while a sabotage script is running.


- **Appearance picker (owner, 10 October 2026):** keep the full chat preview only in final approval, not Choose appearance. Show colour choices openly, and group icons as The Mob, Classic Chat & Greetings, and Symbols & Shapes. Waving hand, Information and Lifebuoy are included; avoid robot/AI/live-agent imagery.

- **Appearance menu navigation (owner, 10 October 2026):** save pending icon, colour and greeting edits before following dashboard links, switching businesses or signing out. Wait for the existing updateBusiness response; a failed or invalid save keeps the editor and its choices on screen. Final approval must show saved choices.
