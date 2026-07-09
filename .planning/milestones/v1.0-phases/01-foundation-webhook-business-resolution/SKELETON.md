# Walking Skeleton — RandevuClaw

**Phase:** 1
**Generated:** 2026-07-07

## Capability Proven End-to-End

A client texts a business-specific WhatsApp deep link (`wa.me/<number>?text=pilates-athens`) to the shared platform number and receives a real Greek-language reply confirming which business they reached — signature-verified inbound, business slug resolved against a live Neon Postgres row, reply sent back through the real WhatsApp Cloud API, running on a fly.io deployment (or an equivalent documented local full-stack run).

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime/Language | Node.js 20 LTS + TypeScript 5 (strict), CommonJS module output | `@google/genai` (Phase 2) requires Node 20+; CommonJS (not ESM) avoids `ts-node`/`drizzle-kit` ESM-loader friction for fast PoC iteration — a build-tooling simplification, not a scope cut |
| HTTP framework | Express 5 | Locked in CLAUDE.md; webhook verification + routing is trivial; ubiquitous fly.io examples |
| Data layer | Neon Postgres + Drizzle ORM (`drizzle-orm` + `pg` driver), migrations via `drizzle-kit generate` + `drizzle-kit push` | Locked in CLAUDE.md; zero-dependency ORM, built-in `onConflictDoNothing()` for idempotency, ~7KB bundle vs Prisma's 1.6MB |
| Messaging integration | Direct HTTPS calls to Meta Graph API (`graph.facebook.com/v20.0/{phone-number-id}/messages`) via native `fetch`, NOT the WhatsApp-Nodejs-SDK | Simpler dependency footprint for a PoC; full control over request/response shape makes Jest mocking straightforward; SDK remains a documented RESEARCH.md alternative if parsing complexity grows in later phases |
| Tenant isolation | Application-level `WHERE business_id = ?` / composite `(business_id, sender_phone)` filtering in every query helper — no Postgres RLS | Locked per CONTEXT.md D-13; RLS deferred to Phase 4 multi-tenancy hardening |
| Dedup/idempotency | Postgres `UNIQUE` constraint on `messages.whatsapp_message_id` + `onConflictDoNothing()` — no Redis | Locked per CONTEXT.md D-05 (conflicts with RESEARCH.md's Redis suggestion; CLAUDE.md's no-Redis stack constraint wins) |
| Auth | None yet — no owner/client login. Inbound authenticity is via HMAC `X-Hub-Signature-256` verification (`crypto.timingSafeEqual`), not session auth | Phase 1 has no dashboard/login surface; webhook authenticity is the only trust boundary in scope |
| Deployment target | fly.io, Cloud Native Buildpacks (`paketobuildpacks/builder:base`, no Dockerfile needed), `primary_region = "ams"` | Locked in CLAUDE.md; ~$1.94/mo after free trial; buildpacks auto-detect Node, no Dockerfile maintenance |
| Directory layout | `src/{webhooks,business,consent,database,whatsapp,utils}/`, `tests/` mirrors feature names (not `src/` tree), `migrations/` for `drizzle-kit generate` output | Matches 01-PATTERNS.md file inventory; keeps each subsystem (webhook, business resolution, consent, persistence, WhatsApp I/O) in its own folder for later phases to extend independently |

## Stack Touched in Phase 1

- [x] Project scaffold — `package.json`, `tsconfig.json`, `jest.config.js`, `.env.example`, `.gitignore`, `fly.toml`
- [x] Routing — `GET /webhooks/whatsapp` (verification challenge), `POST /webhooks/whatsapp` (message events), `GET /healthz`
- [x] Database — real read (`findBusinessBySlug`) AND real write (`insertOrIgnoreMessage`, `insertClientBusinessRelationship`) against live Neon Postgres
- [x] "UI" interaction — for a WhatsApp-native product the WhatsApp thread itself is the UI: a real inbound message wired through signature verification → business resolution → a real outbound reply via the WhatsApp Cloud API
- [x] Deployment — `fly deploy` to a live fly.io Machine, `/healthz` reachable; local fallback is `npm run dev` + `curl localhost:$PORT/healthz`

## Out of Scope (Deferred to Later Slices)

- AI/Gemini-driven booking conversation (BOOK-01..04, ASK-01/02) — Phase 2
- Google Calendar sync, daily agenda, reminder templates (OWNR-03/04, NOTF-01) — Phase 3
- Owner self-serve onboarding via chat, multi-tenant slug customization (OWNR-01, D-03's "Claude discretion" collision suffix is implemented now, but owner-driven slug editing is not) — Phase 4
- GDPR data-deletion request handling (COMP-02) — Phase 5
- Fuzzy/"did you mean" business-code matching — explicitly deferred per D-02, revisit only if fixture testing shows exact-match too brittle
- Postgres Row-Level Security — deferred per D-13, app-level filtering is the Phase 1 (and likely Phase 1-3) choice
- Consent opt-out ("reply STOP") line — deferred per D-11, revisit alongside COMP-02 in Phase 5

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: AI-driven booking conversation (Gemini function-calling) + owner WhatsApp alerts, built on top of the same webhook/business-resolution substrate
- Phase 3: Google Calendar sync + daily agenda + reminder templates, triggered by Phase 2's booking events
- Phase 4: Owner self-serve onboarding via chat, replacing the two fixture businesses seeded in this phase
- Phase 5: GDPR deletion flow + Meta verification completion + load-tested reliability

## Artifacts This Phase Produces

> Consolidated across all 4 plans (see 01-PATTERNS.md for the original file inventory this cross-references). Each symbol is created by exactly one plan; later plans consume, not redefine, these.

**Config & infra (Plan 01-01):** `package.json`, `tsconfig.json`, `jest.config.js`, `fly.toml`, `.env.example`, `.gitignore`, `drizzle.config.ts`, `migrations/*.sql` (drizzle-kit generated)
**`src/config.ts`** (Plan 01-01): `interface Config`, `const config: Config`
**`src/utils/logger.ts`** (Plan 01-01): `const logger: pino.Logger`
**`src/database/db.ts`** (Plan 01-01): `const pool: pg.Pool`, `const db` (drizzle instance)
**`src/database/schema.ts`** (Plan 01-01): `const businesses` (columns: `id`, `name`, `slug` unique, `phoneNumberId`, `createdAt`), `const messages` (columns: `id`, `whatsappMessageId` unique, `businessId` FK, `senderPhone`, `messageBody`, `status`, `createdAt`), `const clientBusinessRelationships` (columns: `id`, `businessId` FK, `senderPhone`, `consentGiven`, `consentTimestamp`, `createdAt`; composite unique index `unique_client_business` on `(businessId, senderPhone)`)
**`src/database/seed.ts`** (Plan 01-01): `generateSlug(name, existingSlugs)`, `seed()` — produces fixture rows `pilates-athens` ("Pilates Athens") and `hair-salon-athens` ("Hair Salon Athens")
**`src/database/queries.ts`** (Plan 01-01): `interface Business`, `interface ClientBusinessRelationship`, `findBusinessBySlug(slug)`, `insertOrIgnoreMessage(whatsappMessageId, businessId, senderPhone, messageBody)`, `markMessageProcessed(whatsappMessageId)`, `findClientBusinessRelationship(businessId, senderPhone)`, `insertClientBusinessRelationship(businessId, senderPhone)`
**`src/whatsapp/client.ts`** (Plan 01-02): `interface SendMessageResult`, `sendWhatsAppMessage(recipientPhone, text)`
**`src/business/resolver.ts`** (Plan 01-02): `extractBusinessCode(messageText)`, `normalizeBusinessCode(raw)`, `extractAndNormalizeBusinessCode(messageText)`
**`src/utils/diacritics.ts`** (Plan 01-02): `stripGreekDiacritics(text)`
**`src/utils/validation.ts`** (Plan 01-02): `WhatsAppWebhookPayloadSchema` (zod), `validateWebhookPayload(data)`
**`src/webhooks/whatsapp.ts`** (Plan 01-02, extended by 01-03): `verifyWhatsAppSignature(rawBody, signatureHeader, appSecret)`, `handleWebhookGet(req, res)`, `handleWebhookPost(req, res)`, `BUSINESS_NOT_FOUND_REPLY_GREEK`, `buildBusinessFoundReplyGreek(businessName)`, default export `router` (mounted at `/webhooks/whatsapp`)
**`src/server.ts`** (Plan 01-02): Express `app` (routes: `/webhooks/whatsapp`, `GET /healthz`)
**`src/index.ts`** (Plan 01-02): process entrypoint, `app.listen(config.port, ...)`
**`src/consent/checker.ts`** (Plan 01-03): `CONSENT_NOTICE_GREEK_TEMPLATE(businessName)`, `getOrCreateClientRelationship(businessId, senderPhone)`
**Test files:** `tests/config.test.ts`, `tests/fixtures.test.ts` (01-01); `tests/whatsapp-client.test.ts`, `tests/business-resolver.test.ts`, `tests/webhook.test.ts` (01-02); `tests/idempotency.test.ts`, `tests/consent.test.ts`, `tests/consent-schema.test.ts` (01-03)
**External/manual artifact (Plan 01-04):** Submitted Meta Business Verification request (no code artifact — tracked in Meta Business Manager)
