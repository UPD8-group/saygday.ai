# Full website copy review — current UX retained

Owner direction: retain SayGday's current UX, use the new copy across the public website, and include the A$59 self-managed / A$99 Managed pricing model.

## Review experience

After `npm run build`, open `/content-preview/` on the deploy preview. Ten linked pages use the actual built website's photographs, typography, green/gold palette, character illustrations, cards, mobile Learn more behaviour, theme toggle, menu order and footer. No stylesheet, design token, image or existing runtime UX script is changed.

Pages: Home; Is this AI?; What's different; When it matters; How it works; Getting started; Meet the mob; Pricing; Contact; Sign in/get started. Existing privacy/terms links lead to the unchanged legal pages; they are not rewritten agreements.

The Pricing page reuses the existing price-card and panel components to show two offers. Managed is enquiry-led, includes initial preparation of up to 20 short answers and standard installation on one supported website, with up to 20 minutes of monthly content work. It does not promise unlimited work or a free managed build. The software trial is clearly separated from hands-on work.

The copy removes cheapness-led messaging, the interactive FAQ label, unsupported matching/performance absolutes and automatic-handoff implications. The homepage keeps 'Looks like a chatbot. Answers like you.' and 'Have a week on us'. It does not add an AI-led pitch to the homepage.

## Safety and release status

The review routes are explicitly noindex, display 'Copy preview' in the existing top CTA and include a footer review notice. Contact/sign-in are disabled static facsimiles. The production-powered widget is deliberately absent so this preview cannot show the live bot's old price or send real enquiries. Menu, theme, next-page links and Learn more remain functional using the existing homepage's built scripts.

Existing public routes, Stripe prices, checkout, subscriptions, customer entitlements, saved trial dates, dashboard billing displays and database-backed live chatbot answers are unchanged. There is no migration, price creation, email or charge. This PR is not a production pricing release.

## Implementation

`site/content-preview.mjs` contains a strict, page-by-page copy map, the added Managed/FAQ content and safe review rendering. `site/vite-plugin.mjs` emits the new read-only pages alongside, not instead of, the unchanged live-route pages. Replacements are resolved at build time, not swapped after a customer loads the page. When source wording changes, the build fails rather than silently missing an edit.

`test/content-preview.test.mjs` checks every page, both prices, offer boundaries, unchanged design assets, retained UX hooks, internal preview navigation and inactive form/widget behaviour. The ordinary test/build workflow also still runs against the existing application.

## Promotion to production

Before the new public prices replace the current offer: create and verify the intended new-customer AUD monthly inclusive Stripe price; coordinate server-side price validation and existing agreed-price support; preserve current customer subscriptions and trial dates; align the dashboard/new-customer activation display and database-backed SayGday answers; review the pricing/Managed terms and operator capacity; then run payment, cancellation and access tests. Promote the approved copy into the public route rendering only as part of that coordinated release. Do not globally replace historical prices in customer data.

This implementation supersedes the old alternate-layout HTML preview. The original writing bank remains background material; the content preview is the visual review reference because it uses the real site design.
