// A paragraph a business can paste into its own privacy policy (owner, 4
// October 2026, after hear.is's Privacy statement was written to name
// SayGday: "Ok add it please"). Most privacy policies list the services a
// website uses, and the chat vendors businesses already know hand out wording
// for exactly this. Ours says exactly what the button sends and keeps, in
// plain words, and every sentence is true for every business on SayGday:
//   · the settings request on every page load carries the visitor's address,
//     browser details and that they are on the business's website (the
//     widget sends the page's origin; browsers' default referrer policy sends
//     no more);
//   · no AI answers; matching happens in the visitor's browser; SayGday
//     learns which answer was opened, never what was typed, and what they
//     type leaves the browser only when they choose to send a question;
//   · a sent question and email are kept and emailed on through Resend (US);
//     the database is Supabase in Sydney; spam counting uses a scrambled
//     address cleared within a day; no cookies; questions deleted within 30
//     days of the account closing.
// Change the facts (site/privacy.html, the widget, the chat) and change this
// paragraph with them: test/chat-look.test.mjs holds the two together.
export const PRIVACY_PARAGRAPH =
  'Our website uses a chat button from SayGday.ai, a business name of HEAR.IS Pty Ltd in Canberra, Australia, to answer common questions. '
  + 'When a page loads, your browser fetches the button and its settings from saygday.ai, which receives your internet (IP) address, your browser details and that you are on our website. The button sets no cookies. '
  + 'If you open the chat, it shows only answers we wrote; no AI answers you. Matching what you type to an answer happens in your browser, and SayGday is told which answer you opened, not what you typed. '
  + 'What you type leaves your browser only if you choose to send us your question. Then SayGday keeps the question and any email address you give and emails them to us through Resend, an email service in the United States. '
  + 'SayGday keeps its database with Supabase in Sydney, counts sent messages by a scrambled form of your internet address that it clears within a day, and deletes your questions within 30 days of us closing our SayGday account. '
  + 'Read more at saygday.ai/privacy.'
