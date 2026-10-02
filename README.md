# SayGday

An interactive FAQ for Australian small business websites.

A business signs up with an email code and enters its web address. SayGday
reads the website once and drafts 20 to 25 questions and answers from its own
pages. The business checks every answer in a simple dashboard, then adds one
line of code to its website. A chat button appears in the bottom-right corner.

The chat answers **only** with answers the business approved, word for word.
**No AI answers visitors**, so nothing can be made up. A question the chat
can't answer is offered to the business: the visitor leaves their email, the
business gets the question by email and replies directly, and can add an
answer so the chat knows it next time.

The website scan is the only place AI is used (one Claude call per scan,
roughly A$0.25 to A$0.45 a website). If the AI isn't available, the scan
drafts from the website's own sentences instead.

## How it fits together

| Part | Where |
|---|---|
| Dashboard (sign-in, questions, customers asked, chat button, settings) | `src/app/` |
| The chat window on a business's website | `src/chat/`, `chat.html` |
| The line of code a business adds (draws the button) | `public/widget.js` |
| Matching a visitor's question to an approved answer, without AI | `shared/matcher.mjs` |
| Dashboard requests (`POST /api/app`) | `netlify/functions/app.mts`, `_lib/owner.mjs` |
| Chat requests (`/api/chat`) | `netlify/functions/chat.mts`, `_lib/visitor.mjs` |
| The website scan (background job) | `netlify/functions/scan-background.mts`, `_lib/scan.mjs` |
| The database and every rule about who may see what | `supabase/migrations/` |

The browser never talks to the database directly. It signs in with Supabase
Auth and sends its sign-in to the site's own functions, which call database
functions as the server. Every table and function is closed to the browser
roles, and each owner function only ever touches the signed-in owner's own
business.

## Running the tests

```
npm install
npm test
```

The tests run the real migration in a real Postgres (PGlite), so the database
rules are tested as they run in production. Netlify runs the tests before
every build: a red test is a failed deploy.

## Going live

See [docs/setup.md](docs/setup.md).
