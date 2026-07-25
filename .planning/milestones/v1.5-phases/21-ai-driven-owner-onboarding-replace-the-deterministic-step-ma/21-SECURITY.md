---
phase: 21
slug: ai-driven-owner-onboarding-replace-the-deterministic-step-ma
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-25
---

# Phase 21 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Telegram message/callback -> aiOnboardingAgent | messageText/callback data is untrusted free text; business object already HMAC-verified/resolved upstream by the webhook handler before this module runs | Owner free text, callback payload |
| aiOnboardingAgent -> Gemini API | Tool schema is the only channel through which Gemini output can cause a DB mutation | Onboarding conversation text, structured tool-call args |
| executeOnboardingTool -> Postgres | Every mutating case must run inside withBusinessContext so RLS scopes the write to business.id | Business config writes (name, hours, services, booking mode, etc.) |
| finish_onboarding -> Telegram Bot API | Rotates the live webhook registration for business.botToken — must never run against the wrong business | botToken, webhook registration |
| Telegram webhook -> handleFoundBusiness/callback_query branch | business already resolved via HMAC-verified webhookId lookup before either onboarding branch runs; senderTelegramId comes from Telegram's own `from.id` | webhookId, senderTelegramId |
| handleFoundBusiness -> aiOnboardingAgent | messageText/callback_query.data untrusted, passed through unchanged | Owner free text |
| Plan 21-03 (deletion) | Pure removal of old step-machine code paths; no new trust boundary introduced | n/a |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-21-01 | Tampering | Prompt injection via owner free text | medium | mitigate | `ONBOARDING_TOOLS` fixed closed set of 10 tool schemas; `executeOnboardingTool` switch has literal `default:` branch returning an inert string — no eval/dynamic dispatch | closed |
| T-21-02 | Information Disclosure | Cross-tenant data leak in tool execution | high | mitigate | All 9 DB write sites wrapped in `withBusinessContext(business.id, ...)`/`getConn()`. Accepted exception: CR-01 fix (commit `ca4771c`) moved the `set_business_name` slug-uniqueness *read* to the raw admin `db` connection — RLS scoping a global-uniqueness check to one tenant was itself a bug; read is non-sensitive (`slug` column only), never echoed to caller, mutation path still RLS-scoped. See Accepted Risks Log. | closed |
| T-21-03 | Elevation of Privilege | finish_onboarding webhook rotation targeting the wrong business | high | mitigate | `business.id`/`business.botToken` sourced only from the fixed `business` parameter (HMAC-verified upstream), never re-derived from Gemini tool args | closed |
| T-21-04 | Denial of Service | Gemini free-tier quota exhaustion from rapid onboarding messages | medium | accept | Pre-existing accepted risk shared with ai-owner-agent.ts/ai-agent.ts; `MAX_TOOL_ROUNDS=5` bounds calls per message; full resilience tracked as RESIL-01 (deferred) | closed |
| T-21-05 | Tampering | Tool result tampering feeding back into the Gemini loop | low | accept | `functionResults` always built from `executeOnboardingTool`'s own trusted return string, never raw user input passthrough | closed |
| T-21-06 | Elevation of Privilege | Routing an already-onboarded owner's message into the onboarding agent | high | mitigate | `!business.onboardingCompleted` guard preserved verbatim at both entry points (message + callback_query); regression test asserts completed-onboarding owner never reaches `aiOnboardingAgent` | closed |
| T-21-07 | Repudiation | Onboarding routing check silently regressing again (occurred once previously) | high | mitigate | Automated coverage on both entry points; a future refactor dropping the guard fails CI immediately | closed |
| T-21-08 | Denial of Service | Duplicate Telegram update delivery re-triggering aiOnboardingAgent | low | accept | Pre-existing `markTelegramUpdateProcessed`/update_id dedup-insert, unchanged by this phase | closed |
| T-21-09 | Repudiation | Dangling import/dead code left reachable after deletion | medium | mitigate | `npx tsc --noEmit` compile-time guarantee; zero references to deleted `steps.ts`/`router.ts`/`queries.ts` symbols remain | closed |
| T-21-10 | Denial of Service | Test-suite regression from deleting still-referenced test coverage | low | mitigate | Full `npm test` re-run; failures confirmed pre-existing/unrelated (schema/fixture drift), zero references to deleted modules | closed |
| T-21-11 | Information Disclosure | Unused `onboarding_sessions` table left in the live DB | low | accept | Table inert — no PII beyond what `businesses`/`services`/`business_hours` already expose; RLS scopes queries; nothing reads it | closed |
| T-21-SC | Tampering | npm/pip/cargo installs | n/a | accept | Zero new package installs across all 3 sub-plans | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-21-01 | T-21-04 | Gemini free-tier 15 req/min quota shared across ai-owner-agent.ts/ai-agent.ts/onboarding agent; `MAX_TOOL_ROUNDS=5` bounds worst case; full backoff/circuit-breaker resilience deferred to RESIL-01 | gsd-security-auditor (verified) | 2026-07-25 |
| AR-21-02 | T-21-05 | Tool-result feedback loop only ever carries `executeOnboardingTool`'s own trusted string, never raw user input | gsd-security-auditor (verified) | 2026-07-25 |
| AR-21-03 | T-21-08 | Duplicate-delivery DoS already bound by pre-existing update_id dedup, unchanged by this phase | gsd-security-auditor (verified) | 2026-07-25 |
| AR-21-04 | T-21-11 | Inert `onboarding_sessions` table carries no incremental PII exposure; RLS already scopes it, nothing reads it post-deletion | gsd-security-auditor (verified) | 2026-07-25 |
| AR-21-05 | T-21-SC | Zero new dependencies added by this phase | gsd-security-auditor (verified) | 2026-07-25 |
| AR-21-06 | T-21-02 (exception) | `set_business_name`'s slug-uniqueness lookup (commit `ca4771c`, CR-01) intentionally uses the raw admin `db` connection instead of `withBusinessContext`/`getConn()` — a per-tenant RLS-scoped read would silently defeat global slug-uniqueness. Read-only, non-sensitive (`slug` column), never echoed to caller; the actual per-tenant mutation remains RLS-scoped. PLAN.md's original "zero raw db imports" verification text is now stale and superseded by this entry. | gsd-security-auditor (verified) | 2026-07-25 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-25 | 12 | 12 | 0 | gsd-security-auditor (Sonnet, ASVS L1) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-25
