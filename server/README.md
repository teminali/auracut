# Kerf Store

Accounts, catalogue, entitlements and payments for Kerf skills. A single
Cloudflare Worker with D1 and R2.

The editor is free and MIT; the skills are the product (HANDOVER §6).
This service is the record of who owns which skill, and it exists
because that record cannot live in the client — Kerf ships as source,
and its recents already sit in `localStorage` where a `paid: true` is a
ten-second edit.

```
Kerf (Electron)
   │  device-code sign-in, Bearer session token
   ▼
Kerf Store  ── this Worker ──  D1 (accounts, orders, entitlements) · R2 (packages)
   │
   ├─►  POST pay.mhasibudigital.com/api/v1/charge      Bearer {public_key}:{secret}
   │        └─► Selcom ─► the buyer's handset (PIN prompt)
   │
   └─◄  POST /webhooks/lipia    payment.completed / payment.failed
                                X-Lipia-Signature: HMAC-SHA256(raw body)
```

**Kerf is a Lipia tenant**, exactly like DukaBot and M-Digital. This
service knows nothing about Selcom, HMAC order signing, or the static-IP
proxy Selcom's whitelisting needs — Lipia owns all of that.

## Why a server at all

Three independent reasons, any one of which is sufficient:

1. **`callback_url` is a webhook.** A desktop app has no public URL.
2. **The Lipia key pair is a bearer secret.** Shipping it inside an
   MIT-licensed Electron bundle puts it one `asar` extract away from
   anyone who wants to charge against the account.
3. **Entitlement must live where the buyer cannot edit it.**

The client-side licence check in `src/services/licenceKey.ts` is what
lets an already-installed skill run offline. It is not what authorises a
purchase, and it is not a lock — see HANDOVER §6 on skills as revocable
managed extensions.

## Endpoints

| Method | Path | Auth |
|---|---|---|
| POST | `/v1/auth/device/start` | — |
| POST | `/v1/auth/device/poll` | — |
| GET | `/v1/me` | session |
| POST | `/v1/auth/signout` | session |
| GET | `/v1/skills` | optional (adds `owned`) |
| GET | `/v1/skills/:id` | optional |
| POST | `/v1/skills/:id/claim` | session · free skills only |
| GET | `/v1/skills/:id/download?version=` | session · entitlement re-checked |
| POST | `/v1/orders` | session |
| GET | `/v1/orders/:id` | session |
| GET | `/v1/entitlements` | session |
| POST | `/webhooks/lipia` | HMAC signature |
| GET | `/health` | — |

## Deploying

```bash
npx wrangler login                 # browser; the one step setup cannot do
cp .secrets/production.env.example .secrets/production.env   # then fill it in
npm run setup                      # everything below, idempotently
```

`npm run setup` creates the D1 database and writes its id into
`wrangler.jsonc`, creates the R2 bucket, applies the schema, pipes every
secret in on **stdin** (never argv — `ps` shows arguments to every user
on the machine), and deploys. Re-running it after a failure picks up
where it stopped.

<details><summary>What it does, by hand</summary>

```bash
cd server && npm install

# 1. Database and bucket
npx wrangler d1 create kerf-store          # put the id in wrangler.jsonc
npx wrangler r2 bucket create kerf-skills
npm run db:remote                          # applies schema.sql

# 2. Licence signing pair
node scripts/keygen.mjs
#    · private JWK  -> wrangler secret put LICENCE_SIGNING_JWK
#    · public JWK   -> src/services/licenceKey.ts in the Kerf repo
#      A production build that still carries the DEV key will fail to
#      verify every real licence and lock out every paying customer.

# 3. Secrets
npx wrangler secret put LIPIA_PUBLIC_KEY       # lpk_live_…
npx wrangler secret put LIPIA_SECRET
npx wrangler secret put LIPIA_WEBHOOK_SECRET   # the tenant's webhook secret
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put LICENCE_SIGNING_JWK

# 4. Public client ids go in wrangler.jsonc `vars`
npx wrangler deploy
```
</details>

### Two account-level toggles wrangler cannot do

Both are one click in the dashboard, both cost a confusing ten minutes
if you meet them mid-deploy, and neither has a CLI command in wrangler 3:

- **A workers.dev subdomain.** Without one the Worker uploads fine and
  then has no URL — `wrangler deploy` reports "You need to register a
  workers.dev subdomain" *after* a successful upload, which reads like
  the deploy failed when it did not.
  `dash.cloudflare.com/<account>/workers/onboarding`
- **R2.** `wrangler r2 bucket create` returns
  `Please enable R2 through the Cloudflare Dashboard [code: 10042]`
  until R2 is switched on for the account. Everything except package
  DOWNLOAD works without it, so the binding is commented out in
  `wrangler.jsonc` and the download route returns a plain
  `storage_not_configured` rather than a 500.

### Register Kerf as a Lipia tenant

In the Lipia dashboard, create the **tenant** and set its **callback
URL** to this Worker's `/webhooks/lipia`.

**It has to be a tenant, not a company under an existing one.** Lipia
dispatches to `tenant.callback_url` — `webhook-dispatcher.ts` reads
nothing else. A charge's own `callback_url` is accepted by the request
schema and then never stored or read, and `companies` carry a
`callback_url` column that the dispatcher ignores. So borrowing another
product's tenant means this Worker receives no callbacks at all: they go
to that product's endpoint, which will look at `metadata`, not recognise
a Kerf order, and acknowledge it.

That is survivable — `GET /v1/orders/:id` reconciles against Lipia after
45s and the cron sweeps every two minutes, so purchases still complete —
but it is polling, not push, and the revenue lands in the other
product's ledger. Making Lipia prefer `company.callback_url ??
tenant.callback_url` is a three-line change in that repo and would make
a per-product company the right answer instead. Lipia signs each
delivery with that tenant's webhook secret, which is the same value put
into `LIPIA_WEBHOOK_SECRET` above. Retries run on a 1m / 5m / 30m / 2h /
12h ladder — everything here is idempotent, so a repeat delivery grants
nothing twice (there is a check for exactly that).

### OAuth apps

Both providers need a client that permits the **device** grant.

- **Google** — Cloud Console → Credentials → OAuth client ID → *TVs and
  Limited Input devices*. Scope `openid email profile`.
- **GitHub** — Developer settings → OAuth Apps → enable *Device flow*.
  Scope `read:user user:email`.

Kerf never sees either secret: it polls this Worker, and this Worker
polls the provider.

## Local development

```bash
npm run db:local && npm run seed:local
cp .dev.vars.example .dev.vars     # then fill it in; it is gitignored
npx wrangler dev --port 8788 --local

# point a Kerf dev build at it
KERF_STORE_URL=http://127.0.0.1:8788 npx electron .
```

`seed.sql` catalogues one **free** skill and one **paid** one. The free
row is deliberate: it makes sign-in → catalogue → entitlement → licence
runnable end to end without moving money, so a real handset is needed
only for the payment leg itself.

## Verifying

```bash
node verify_store.mjs        # 33 checks against a running Worker
```

Same bar as the rest of this repo — assert the artifact, not the
function. The check this file exists for is that an issued licence
**verifies under the public key the client actually ships**, and that a
licence edited to name a different skill does not. Every check that
ambient state could fake has a control beside it: the entitlement is
claimed only after asserting it was absent, and the signed webhook is
accepted only after an identical unsigned one has been refused.

What it covers, in the order it matters:

- a forged bearer token, and every paid route, refused anonymously
- a free claim, then the licence verified, then the same claim again
  granting nothing a second time
- a paid skill refusing the free-claim route
- a malformed phone number refused *before* a charge is created
- an unsigned and a wrongly-signed callback refused, granting nothing
- a correctly-signed `payment.completed` granting the skill
- a **replayed** callback granting nothing a second time
- **underpayment** — 100 against a 5000 order — granting nothing
- every delivery on the record, verified or not

## Not built yet

Named rather than implied, so nobody assumes otherwise:

- **Package upload and publish.** `skill_versions` rows and R2 objects
  are written by hand. There is no author-facing publish flow.
  (`status='published'` IS now gated — by a CHECK constraint, not by
  code that could be bypassed.)
- **Installing a downloaded package.** The entitlement and the download
  route are real; unpacking into `userData/skills/` is not written.
- **Refund initiation.** The webhook handles `payment.refunded` and
  revokes; nothing calls Lipia's `POST /api/v1/refund`.
- **The seller side** — payouts, the 80/20 split, analytics (§6).
