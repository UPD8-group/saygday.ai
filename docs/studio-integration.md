# oo.studio delegated connection

SayGday remains independent: its own Supabase project, customer accounts,
subscriptions and direct dashboard. oo.studio receives a revocable grant for
one verified business. Never give the studio SayGday's Supabase service key,
customer sign-in/refresh token, or Stripe credentials.

## Connect

1. The studio server authenticates its customer, checks their workspace and
   enabled SayGday product, creates a random state and a 32-byte base64url PKCE
   verifier, and stores them against that user/workspace for ten minutes.
2. Redirect to `https://saygday.ai/app/connect/oo-studio` with `state`,
   `code_challenge` (base64url SHA-256 of the verifier) and `redirect_uri`.
   The only default redirect is exactly
   `https://oo.studio/dashboard/?saygday=callback`.
3. The customer signs into SayGday if necessary, chooses one verified business
   and explicitly connects. SayGday returns a one-use, five-minute code plus
   state to the registered callback. No access token travels in a URL.
4. The studio checks state against the same authenticated user/workspace,
   consumes its pending attempt, then server-to-server POSTs to
   `https://saygday.ai/api/integrations` with JSON:
   `{ "action":"exchange", "code":"…", "codeVerifier":"…", "redirectUri":"…" }`.
5. Response: `{ accessToken, tokenType:"Bearer", business, scopes, expiresAt }`.
   The studio must require a verified business whose normalised website host
   matches the workspace website. Revoke any mismatched grant immediately.
   Store the token encrypted on the server. Never return it to browser code,
   logs, telemetry, links or downloadable settings.

State, verifier and code are one-use. A lost exchange response requires a new
connection. Tokens expire in one year and can be revoked sooner. Provider
storage contains only SHA-256 hashes of high-entropy codes and tokens.

## API

POST `/api/integrations`, JSON, `Authorization: Bearer sgp_…`.
The server takes the owner and business from the grant. Caller-supplied
`business`, `businessId`, `owner`, `ownerId`, `user`, `userId`, `p_user` or
`p_business` are refused. Allowed actions:

| Action | Body | Response |
| --- | --- | --- |
| `summary` | — | `{ business, scopes, expiresAt }` |
| `listFaqs` | — | `{ faqs }` |
| `saveFaq` | `id?`, `question?`, `answer?`, `variants?`, `status?`, `featured?` | `{ faq }` |
| `listEnquiries` | `status: "new" | "done"`, optional `cursor: { createdAt, id }` | `{ enquiries, nextCursor, counts: { new, done } }` |
| `setEnquiry` | `id`, `status: "new" | "done"` | `{ updated }` |
| `revoke` | — | `{ revoked }` |

Questions accept 3–200 characters; answers 1–1500; variants at most 12 strings
of at most 200 characters. FAQ status is `draft` or `approved`. Publishing an
approved answer updates the live assistant. Existing SayGday ownership and
content validation still apply. No billing, account, scan, deletion, bulk
approval or website changes are delegated.

The `business` object includes `id`, `slug`, `name`, `website`, `character`,
`signedBy`, `greeting`, `buttonColour`, `websiteVerifiedAt`, and `counts`.
Enquiry entries include `id`, `question`, `email`, `status`, `createdAt`,
`emailed` and `notification`. The studio should minimise retention of enquiries.

Each request rechecks grant expiry/revocation, current ownership, the original
verified website, and whether the owner still exists and is not banned.
Settings → Connected workspace lets the owner revoke without using oo.studio.
Disconnecting does not delete their business, answers, enquiries or subscription.

## Deployment

Apply the additive migration `20261010045615_studio_delegated_access.sql` to
the SayGday project before deploying this branch. It was created using
`supabase migration new studio_delegated_access`. It adds two RLS-enabled,
service-only tables, six security-invoker RPCs, and one boolean-only private
security-definer helper to lock/check account status without granting the
service role access to auth tables. It changes no existing customer rows.
Use the normal migration workflow after checking the CLI help
and the target project. Run the Supabase advisors after application.

Production record (10 October 2026): the reviewed SQL in that local file was
applied to SayGday project `plcowhnsmrgenzsohbrl` by the connector as migration
`20261010133314_studio_delegated_access`. The generated remote timestamp is
different from the source filename; migration history was not rewritten.
Both tables have RLS enabled, both browser roles are denied table access and
execution of every integration RPC, and the private helper does not grant
the service role access to `auth.users`. There were no codes or grants at
verification, and existing business, answer, enquiry and user counts were
unchanged. PR #51 was squash-merged as
`e6a69772add9c95e6136ddced551340840333eab`.
Netlify production deploy `6aca3efc6006040008e91b82` published that exact
commit at `2026-10-10T13:36:09.828Z`; state was ready, the integration function
was present, and secret scanning reported no matches.

Production smoke checks: `GET /api/integrations` returns 405,
unauthenticated summary and consent requests return 401 with `no-store`,
and `/app/connect/oo-studio` serves its page with HTTP 200. An unknown scoped
token is rejected without creating a grant. No sign-in emails were sent,
no customer connections were created, and the legacy studio endpoints were
not retired as part of this provider rollout.

Security advisors report the existing leaked-password-protection warning and
the expected no-policy information for service-only RLS tables. Performance
advisors also note that the two new business foreign keys have no covering
business-only index; these tables are empty at rollout.

The production callback works without a new secret or environment setting.
For an isolated test environment only, `SAYGDAY_STUDIO_CALLBACK_URL` may be set
server-side to one exact HTTPS callback on its matching studio staging site.
Do not add wildcard callbacks or point a preview at production customer data.

Verify with `node --test test/integrations.test.mjs`, `npm test`, and
`npm run build`. Production acceptance still requires a client to sign in and
authorise their connection; never send a sign-in email during deployment.

A future sale of SayGday needs no database split for this feature. The new
owner can maintain this API agreement, revoke grants or retire the connector;
customers retain direct access to SayGday throughout.
