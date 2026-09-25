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
| **Platform** | Multi-tenant, with roles (owner, admin, staff, viewer), plan limits and features, audit log, phone OTP auth with rotating refresh tokens, rate limits, and a Persian RTL UI (default) plus English. |

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

Checks: `pnpm typecheck` and `pnpm test`. The tests cover the slot engine, customer segmentation, timezone math and phone normalization.

Production: `docker compose --profile app up --build` (api, worker, web). Run `node apps/api/dist/migrate.js` once per deploy.

## Scaling notes

- The API and worker hold no state, so you can add replicas behind a load balancer. For many API instances, put PgBouncer in front of Postgres and set `PG_PREPARE=false`.
- Booking consistency uses a Postgres advisory transaction lock per staff member plus a re-check inside the transaction. Stock uses `SELECT ... FOR UPDATE` in id order, plus check constraints (`reserved <= stock`, `stock >= 0`).
- Every delayed effect (reservation expiry, deposit hold, reminders) is an idempotent BullMQ job with a deterministic `jobId`. Handlers re-check state, so retries and rescheduling are safe.
- Instagram webhooks are acknowledged immediately and deduplicated by message id, both as the job id and as a unique `(shop_id, external_id)` in the database.
- Hot public reads (shop by slug, catalog) use short in-process caches and `Cache-Control` for a CDN.

## Before production: verify or finish these

- **Zarinpal**: `apps/api/src/modules/payments/providers/zarinpal.ts` follows the v4 REST flow, but the official docs weren't reachable when it was written. Check the endpoints against the current docs.
- **Instagram**: sending messages uses the documented `POST graph.instagram.com/{v}/{IG_ID}/messages`. The private-reply (comment-to-DM) payload and the Instagram Login OAuth flow still need checking against Meta's current docs. For now, `/instagram/connect` accepts a token you obtain yourself. Encrypt `ig_access_token` at rest.
- **SMS**: only a console provider ships. Add your provider in `modules/notifications/sms.ts`.
- **Shipping carriers** (Postex, Tipax): tracking codes are entered manually. Carrier APIs aren't integrated yet.
- **Uploads**: stored on local disk (`lib/uploads.ts`). Swap in S3-compatible storage for multiple replicas.
- **Subscription billing**: plans and limits are enforced, but plan purchase and renewal checkout isn't built yet.

## Roadmap ideas

Waitlist for full days, service packages and memberships (e.g. "10 sessions"), Google Calendar sync for staff, WooCommerce and Instagram catalog import, a POS mode, a site-builder theme studio, an Excel import/export page, and voice-note transcription for the agent.
