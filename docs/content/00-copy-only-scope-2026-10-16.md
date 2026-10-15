# SayGday: existing design, new copy

Owner clarification, 16 October 2026: **“I wanted to keep my current look and feel - just with your new copy.”**

This clarification takes precedence over any structural or visual recommendations in `saygday-content-overhaul-2026-10-16.md`. The earlier standalone, long-page visual concept is withdrawn. It is not an approved replacement design.

## Fixed design boundaries

- Keep the existing photo-led, page-by-page website. Do not turn the homepage into a long scrolling landing page.
- Retain all existing photos, illustrations, characters, logo, green/gold palette, Outfit and Caveat typography, signed-answer chat cards, buttons, backgrounds and light/dark themes.
- Retain the existing navigation labels, order and routes, including **Is this AI?**, **What’s different**, **When it matters**, **How it works**, **Getting started**, **Meet the mob**, **Pricing** and **Contact**. Do not replace the menu with a new top navigation.
- Keep the existing desktop composition, mobile photo treatment, next-page buttons and mobile Learn more behaviour.
- Retain the footer structure, acknowledgement and oo.studio credit.
- No stylesheet, visual token, asset, component-style, animation or layout changes are authorised by this content proposal. Shorten or adapt the writing to fit the existing components rather than redesigning components around the writing.
- The homepage remains free of AI-led sales language; put the explanation of AI-assisted drafting on the existing Is this AI? page.

## What changes

Headings, paragraph text, button wording, explanatory captions, suitable metadata and pricing descriptions may be improved inside their existing locations. Keep the substantive owner-approved-answer positioning and the proposed A$59 self-managed / A$99 Managed direction. Keep **Have a week on us**. Remove cheapness-led language and unsupported reliability claims.

The longer original copy pack is a writing bank, not a mandate to add sections or move content. Distribute it across existing relevant pages. Keep character content where it is; do not demote or remove Meet the mob. Keep Pricing on its existing page, using existing components if the two proposed offers are later implemented.

## Homepage copy mapped to the existing source

Source: `site/index.html`.

- Promise pill: **Your answers. Your final say.**
- Headline, unchanged: **Looks like a chatbot. / Answers like you.**
- Lead: **Help customers find answers while you get on with your business. SayGday uses answers you’ve checked and approved, in your own words. When it can’t find a suitable answer, customers can send you an enquiry instead.**
- Primary button: **Build my SayGday**.
- Existing secondary and mobile next-page action stays: **Next: The honest answer**.
- Offer heading: **Have a week on us.**
- Offer details for a review-only preview of the proposed price: **Build and preview free. Verify your website and add a card for 7 free days, then A$59/month automatically unless you cancel. Checkout shows your first billing date.**
- Supporting line: **Made in Canberra for Aussie small businesses.**
- Keep the existing Corner Pantry example and its made-up-café label. Keep the approved Sunday-hours answer and signed-answer presentation.
- Example fallback: **That’s one for Sam. Send your question and email so he can reply.**
- Example field action: **Send** (retain the short label so the existing mobile component is not widened).
- Example helper: **Send an enquiry to Sam’s inbox**. This describes the action rather than claiming an enquiry has already been delivered.

## Release boundaries

This PR remains documentation and preview work only. No production HTML/CSS, checkout, Stripe prices, customer subscriptions, trial dates, emails, database records or entitlements are changed.

Do not publish proposed A$59/A$99 offer text into production until new-customer checkout, server price validation, site-chat answers and account-specific billing displays have been coordinated and tested as described in the original copy pack. Existing agreed prices and entitlements must be preserved. Managed remains enquiry-led until its service workflow and scope are ready.

## Acceptance checks

1. A before/after code comparison shows copy changes, not visual redesign. Existing CSS classes, style blocks, photo URLs, navigation routes and layout structure remain intact.
2. Desktop, narrow-phone and dark-mode checks confirm the wording fits without changing font sizes, spacing rules or component styles. Edit the wording first when it does not fit.
3. Mobile next-page and Learn more behaviour, keyboard navigation and menu/theme controls remain intact.
4. The preview is explicitly non-transactional. It must not start signup, subscriptions, enquiries or production-chat conversations under the proposed prices.
5. The original alternate-layout preview is not used as an implementation reference.
