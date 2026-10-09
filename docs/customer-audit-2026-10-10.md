# SayGday.ai customer-journey audit — 10 October 2026

Audit started around 2am Australia/Sydney. Baseline: production commit 6f60c6a7a8a51344593b2b472412185626a89623. Corrections and release checks: [PR #50](https://github.com/UPD8-group/saygday.ai/pull/50).

## Outcome

The main new-customer journey was exercised successfully using the real React dashboard and isolated business data: website submission, scan progress, answer editing and approval, appearance, installation, verification, final chat approval and billing. Three defects were reproduced and corrected. A small heading/accessibility inconsistency was also corrected.

This is a functional and UX audit, not a claim that every production integration or every device has been tested. Live public pages were inspected in Chrome; private workflow mutations used fixtures, not customer records.

## Findings and corrections

| Finding | Evidence | Correction | Verification |
| --- | --- | --- | --- |
| Browser Back discarded unsaved appearance choices | Selecting Information and Teal, then using Back and Forward, restored the old bubble and forest colour | Use the existing router's navigation blocker to wait for the appearance save on client navigation, including Back and Forward; keep edits on a failed save | Back returned to approval with Information and #007F82; simulated failed save stayed in the editor with an error and the draft intact |
| Initial dashboard errors could leave an endless loading view | An answers request can fail after the business has loaded; the previous layout only showed its retry UI when no business existed | Show the error and Try again regardless of whether the business is already present | Injected listFaqs failure showed a retry action; clicking it recovered the approved answers. Added a rendered-component regression test |
| Mobile menu button became too narrow | Live mobile header measured about 21.8px wide for a 48px-high menu button | Prevent flex shrinking and compact the phone header | Built-site checks at requested widths 390px and 320px showed a 44×44px menu button and no horizontal document overflow |
| Guided answers had two top-level headings and could replace the setup title | Check answers and Questions & answers both rendered as h1 | Use h2 for the embedded Questions heading and retain the setup page title | Recovery view rendered Check answers as h1 and Questions & answers as h2 |

## Customer checks completed

| Area | What was checked | Result / boundary |
| --- | --- | --- |
| Public journey | Home, Is this AI?, What's different, When it matters, How it works, Getting started, Meet the mob, Our story, Pricing, Contact, Privacy and Terms | Pages opened; inspected navigation and headings; no failed completed images in the sampled information pages |
| Mobile public site | Homepage, next-page navigation, Learn more expansion, menu open/close, narrow header sizing | Passed the exercised actions; mobile header corrected |
| Published price | Pricing page and live SayGday chat pricing answer | Both stated A$40/month AUD, 14 free days after activation, card required to activate |
| New business | Empty URL validation, URL submission, scan progress and completed drafts | Passed with simulated scan responses |
| Answers | Edit a draft, save and approve, approve remaining draft, progress with approved answers | Passed; drafts did not enter the customer preview |
| Appearance | Grouped choices, open colour controls, chosen icon/colour/greeting, explicit save | Passed |
| Navigation | Menu save from earlier fix, browser Back/Forward, failed save retention | Browser-history gap corrected; successful and failed Back scenarios checked |
| Installation | Business-specific script, WordPress instructions and Copy confirmation | Passed; no client website installation was changed |
| Verification | Not-yet-found error, disabled continuation, DNS fallback instructions, successful retry | Passed using fixture responses; server verification remains authoritative |
| Preview | Chosen icon, colour, greeting and real chat | Passed |
| Answer matching | Asked 'where can I park' after editing the parking answer | Returned the exact approved wording, including the added visitor-spaces sentence |
| Unknown question | Asked about catering a wedding for 200 people | Offered an enquiry handoff rather than inventing an answer |
| Preview enquiry | Entered a fixture email and submitted the preview form | Explained that preview questions are not sent |
| Approval and billing | Explicit approval opened Step 6; sidebar showed approval complete | Passed; A$40/month and trial conditions visible |
| Checkout recovery | Checkout could not initialise in the fixture | Showed Reload checkout and Back to billing |
| Error recovery | Failure after loading business data | Corrected and retested successfully |
| Business switching | Started a switch with pending appearance changes | Save-in-progress state observed; final switched-business state was not verified before disconnection |

## Automated validation

- Production build passed locally after the router, retry, heading and mobile changes.
- The release workflow runs the complete npm test suite, production build and deliberate billing-regression mutations.
- PR #50 contains the authoritative hosted results for the final commit, including the added dashboard recovery test.
- Existing suites cover sign-in lifecycle/timeouts, owner scoping, database permissions, scan handling, approval rules, matching, website verification, billing/webhooks, checkout and enquiry delivery/retries.
- Passing automated tests supports these behaviours; it does not replace a fresh live signup or payment test.

## Not completed in this audit

- A fresh sign-in email was not sent or redeemed.
- A production website scan was not started, and the quality of a new AI-generated scan was not assessed.
- No live card was entered, subscription created/cancelled, payment taken, or Stripe portal change made.
- No contact-form message or real customer enquiry email was sent.
- The final live returning-customer cancellation check was interrupted when both browser and local workspace access disconnected.
- Browser checks covered Chrome and emulated phone widths, not Safari/iOS or Android hardware.
- Account settings saves, enquiry inbox editing and multi-business return-state behaviour were reviewed in source but not fully exercised in the browser.

## Existing behaviour to keep in mind

The appearance-complete and preview-approval ticks are session-level acknowledgements. Saved business appearance and approved answers persist on the server; those UI acknowledgements can reset after a full reload. They never grant verification or paid access.

The public Getting started page describes three broad phases while the dashboard splits them into six steps. This was treated as a copy difference, not a broken workflow.

## Operational note

The local machine disconnected during the audit. The already browser-tested corrections were reproduced through the connected GitHub tools and checked remotely. Temporary localhost audit tabs/servers and mobile viewport overrides could not be cleaned up after disconnection. They affect only the agent's test pages; close those localhost tabs when the machine is available. No real customer answers, appearance settings or subscription records were changed during this audit.
