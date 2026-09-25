# Shopino

The sales and booking panel for businesses that sell from their DMs. An AI agent answers Instagram messages from live stock and calendar data, creates orders and appointments, and sends a secure pay link. Shops, salons, clinics, tutors and other service providers all run from one panel.

It's modeled on [promall.io](https://promall.io) (online-shop panel, DM agent, customer club, zero commission) and adds a **full appointment system for service providers**.

## Features

| Area | What you get |
| --- | --- |
| **Sales agent** | Claude-powered DM agent with tools for products, orders, services, free slots and bookings. It answers only from panel data, hands off to a human (with a Telegram ping), bills usage at cost from the shop wallet, and has a playground in the panel. |
| **Orders** | Stock is reserved on order creation and deducted only after payment. Reservations expire. Status flow runs to shipping and tracking. Every order has a single link that the customer uses for address, payment and tracking. Includes a timeline and a print-ready view. |
| **Appointments** | Services have duration, prep and cleanup buffers, deposits, group capacity and approval rules. Staff get split-shift weekly hours, time off and holidays. Staff pick is load-balanced. Advisory locks prevent double booking. Includes SMS reminders, online cancel and reschedule inside a policy window, deposit holds that release unpaid slots, and day and week calendars. |
| **Payments** | Bank gateway (adapter interface; mock and Zarinpal included), card-to-card with receipt upload and review, deposits, wallet top-up. |
| **Customer club** | Segments are computed from orders *and* visits: VIP, regular, new, at risk, lost. Includes an "almost VIP" list, a loyalty points ledger (earn, redeem, reverse on cancel), and SMS campaigns sent in batches and charged to the wallet. |
| **Storefront** | SSR store with product JSON-LD, a cart, a public booking wizard and a booking-management page. Uses the shop's brand color and is mobile first. |
| **Customer portal** | `/me`: customers sign in with their phone (OTP) and see every booking and order made with that number across shops. They can reschedule or cancel inside each shop's window. Cancelling a paid booking raises a refund request that the shop settles as refunded or kept. |
| **Offline + online bookings** | Walk-ins and phone bookings, including outside working hours, share one calendar with online bookings. Double booking is still refused. Online and offline are tagged separately in reports. Reminders go by Instagram DM when the 24h window is open, otherwise by SMS. |
| **Static Instagram automations (free)** | Rules trigger on a comment on a post or reel, a story reply, a story mention, a DM keyword, or someone's first message. Comments get a public reply plus Instagram's single private reply, and the full sequence follows once the person answers. DM sequences can combine text, image with caption, pre-recorded voice, video, link buttons, and forms. Includes a tester and per-rule hit logs. |
| **Form builder (free)** | Typed fields (text, phone, email, number, choice, date, checkbox). The form link can be sent in DMs, and a signed link ties each submission back to its conversation. Submissions are validated on the server, exportable as CSV, and trigger a Telegram alert. |
| **AI (Lite and up)** | The DM agent does retrieval over the shop's knowledge base (Postgres full-text plus trigram, swappable for embeddings). "Learn from past DMs" distills the team's style and recurring answers. There's an AI shopping and booking consultant on the storefront, PLP, product and booking pages. Instagram posts are pulled in, and vision detects which are products and extracts title, price and sizes for review and import. The storefront landing copy is AI-generated and editable. |
| **Products** | Upload images, set category, variants (attributes, SKU, stock), SEO fields and draft/active/archived status. Optional **USD-linked pricing**: USD price × rate × markup, rounded up. The rate is entered by hand or fetched on a schedule from a configurable source. |
| **Storefront PLP** | URL-driven filters (category, any variant attribute such as size or volume, max price, in stock) and sorting (new, popular, price). Facets are computed from live stock. |
| **Super admin** | `/admin`: platform overview, every shop (change plan, suspend, adjust wallet), all reservations, and every DM thread with its AI runs (tools used, cost, handoffs, errors) and automation hits. Also platform fees per shop. |
| **Payments roadmap** | Every customer payment records a platform fee (`PLATFORM_FEE_PERCENT`, default 1%). The gateway interface already carries split legs (merchant Sheba + platform Sheba) for a shared gateway such as Pasargad/Dorsa. See `providers/pasargad.ts`. |
| **Platform** | Multi-tenant, with roles (owner, admin, staff, viewer), plan limits and features, audit log, phone OTP auth with rotating refresh tokens, rate limits, and a Persian RTL UI (default) plus English. **Free plan**: appointments, reminders, automations and forms, forever. |

## Stack (chosen for speed and horizontal scale)

- **API**: Fastify 5, Zod type provider, Drizzle ORM, PostgreSQL. Stateless, so you can run N replicas.
- **Workers**: BullMQ on Redis, with separate queues for `events`, `inbound` (LLM work) and `scheduled` (expiry, reminders, nightly segments). Scale workers independently of the API.
- **Web**: Next.js 16 App Router, Tailwind v4, SWR. `/api/*` is proxied to the API, so cookies are first-party and there's no CORS.
- **AI**: Anthropic SDK with a manual tool loop, adaptive thinking and server-side refusal fallback.
- **Monorepo**: pnpm and Turborepo. `packages/shared` holds zod schemas, plans and time/money helpers. `packages/db` holds the schema, migrations and seed.

```
apps/api      Fastify API + BullMQ worker (src/modules/*: auth, shops, catalog, orders, payments,
              appointments, customers, discounts, inbox, instagram, agent, campaigns, reports, storefront)
apps/web      Landing, pricing, login/onboarding, panel, storefront /s/[slug], booking /b/[slug],
              order link /o/[code], booking link /b/booking/[code], mock gateway /pay/mock
packages/db   Drizzle schema + SQL migrations + seed
packages/shared  Zod DTOs, enums, plans, Intl-based timezone/Jalali helpers
```

## Run locally

Requirements: Node 22+, pnpm 10, PostgreSQL 16, Redis 7.

```bash
cp .env.example .env            # set JWT_SECRET / COOKIE_SECRET; ANTHROPIC_API_KEY enables the agent
pnpm install
pnpm infra:up                   # postgres + redis via docker compose (or use your own)
pnpm db:migrate && pnpm db:seed # demo shop "atelier-raha", login phone 09120000000
pnpm --filter @shopino/api dev         # http://localhost:4000
pnpm --filter @shopino/api dev:worker  # background jobs
pnpm --filter @shopino/web dev         # http://localhost:3000
```

In development the OTP code appears on the login screen and in the API log (`OTP_DEV_ECHO=true`). SMS messages are printed to the worker log. Payments use the mock gateway page.

Checks: `pnpm typecheck` and `pnpm test`. The tests cover the slot engine, customer segmentation, automation rule matching, form validation, USD pricing math, knowledge-query building, SSRF guarding, timezone math and phone normalization.

Demo logins after seeding: shop owner and super admin `09120000000` at `/login`. Customer portal `09121111111` at `/me`.

Production: `docker compose --profile app up --build` (api, worker, web). Run `node apps/api/dist/migrate.js` once per deploy.

## Scaling notes

- The API and worker hold no state, so you can add replicas behind a load balancer. For many API instances, put PgBouncer in front of Postgres and set `PG_PREPARE=false`.
- Booking consistency uses a Postgres advisory transaction lock per staff member plus a re-check inside the transaction. Stock uses `SELECT ... FOR UPDATE` in id order, plus check constraints (`reserved <= stock`, `stock >= 0`).
- Every delayed effect (reservation expiry, deposit hold, reminders) is an idempotent BullMQ job with a deterministic `jobId`. Handlers re-check state, so retries and rescheduling are safe.
- Instagram webhooks are acknowledged immediately and deduplicated by message id, both as the job id and as a unique `(shop_id, external_id)` in the database.
- Hot public reads (shop by slug, catalog) use short in-process caches and `Cache-Control` for a CDN.

## Before production: verify or finish these

- **Zarinpal**: `apps/api/src/modules/payments/providers/zarinpal.ts` follows the v4 REST flow, but the official docs weren't reachable when it was written. Check the endpoints against the current docs.
- **Instagram**: these follow Meta's current Instagram Platform docs:
  - send text, attachments (image, audio, video) and the button template: `POST /{IG_ID}/messages`
  - private replies: `recipient.comment_id`, one message, within 7 days
  - public comment replies: `POST /{comment-id}/replies`
  - story reply and story mention webhook payloads
  - listing posts: `GET /{IG_ID}/media`

  The Instagram Login OAuth flow isn't built. `/instagram/connect` accepts a token you obtain yourself. Encrypt `ig_access_token` at rest, and your Meta app needs approval for `instagram_business_manage_messages` and `instagram_business_manage_comments`.
- **Pasargad / Dorsa shared gateway**: only the interface and split legs exist. `providers/pasargad.ts` throws until it's implemented against the official docs, which weren't reachable when this was written.
- **USD rate source**: there's no built-in Iranian rate API. Point `USD_RATE_URL` / `USD_RATE_JSON_PATH` at a source you trust, or enter the rate by hand.
- **Retrieval**: the knowledge base uses Postgres full-text plus trigram search. For semantic search, add an embeddings provider behind `modules/knowledge/search.ts`.
- **SMS**: only a console provider ships. Add your provider in `modules/notifications/sms.ts`.
- **Shipping carriers** (Postex, Tipax): tracking codes are entered manually. Carrier APIs aren't integrated yet.
- **Uploads**: stored on local disk (`lib/uploads.ts`). Swap in S3-compatible storage for multiple replicas.
- **Subscription billing**: plans and limits are enforced, but plan purchase and renewal checkout isn't built yet.

## Roadmap ideas

Waitlist for full days, service packages and memberships (e.g. "10 sessions"), Google Calendar sync for staff, WooCommerce and Instagram catalog import, a POS mode, a site-builder theme studio, an Excel import/export page, and voice-note transcription for the agent.
