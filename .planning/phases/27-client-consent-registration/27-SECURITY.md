---
phase: 27
slug: client-consent-registration
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-28
---

# Phase 27 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Executor machine → live Neon DB (27-01) | Task 3's Node.js migration-apply step authenticates via `DATABASE_URL` and mutates schema/data on the production database | Schema DDL + backfill UPDATE |
| Migration SQL file → live DB execution (27-01) | Raw SQL in `migrations/0013_client_consent_gate.sql` executed verbatim, no runtime string interpolation | DDL/DML text |
| Unauthenticated Telegram `callback_query` → `consent:yes`/`consent:no` handler (27-02) | The callback_data carries no ids at all — handler trusts only the webhook-scoped, HMAC-verified `business` param plus Telegram's own `callback_query.from.id` | Client consent decision |
| Client free-chat message → AI agent / conversation persistence (27-02) | The gate is the single choke point deciding whether a client's raw text ever reaches `aiBookingAgent` or `conversation_turns` | Client free-text message |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-27-01 (27-01) | Tampering | `migrations/0013` backfill UPDATE | low | mitigate | `WHERE consent_given IS DISTINCT FROM true` — narrow scope, never a blanket UPDATE; verified present in migration file (line 30) | closed |
| T-27-02 (27-01) | Repudiation/Integrity | Migration idempotency | low | mitigate | `DROP DEFAULT`/`SET DEFAULT` naturally idempotent; backfill WHERE clause safe to re-run — verified in migration file (lines 39-40) | closed |
| T-27-03 (27-01) | Tampering (injection) | Task 3's one-time `pg` Client invocation | low | mitigate | Migration SQL read verbatim from a static, version-controlled file via `fs.readFileSync`, passed directly to `client.query(sql)` — no dynamic string concatenation. One-time deploy action, not a persisted script; verified complete per 27-01-SUMMARY.md | closed |
| T-27-04 (27-01) | Information Disclosure | Task 3's console output | medium | mitigate | Plan explicitly forbade printing `DATABASE_URL`/secrets; only the read-only verification query's `column_default` boolean was logged — confirmed via 27-01-SUMMARY.md, no secret leak reported | closed |
| T-27-04 (27-02) | Spoofing/Tampering | `consent:yes`/`consent:no` callback handling | low | accept | Callback has no ids; handler resolves target strictly from `(business.id, senderTelegramId)` derived from the HMAC-verified webhook + Telegram's own sender field — verified in `src/webhooks/telegram.ts` (consentAction branch); a forged/replayed callback can at most toggle the TAPPING user's own consent flag, no cross-tenant/cross-client escalation possible | closed |
| T-27-05 (27-02) | Repudiation/Integrity | Race: concurrent first-contact message vs. `consent:yes` callback | low | mitigate | `insertClientBusinessRelationship`'s `onConflictDoUpdate` SET clause excludes `consentGiven` — verified in `src/database/queries.ts` (line 234); a concurrent upsert can never overwrite an already-true flag back to false, nor grant it early | closed |
| T-27-06 (27-02) | Denial of Service (self-inflicted) | Client taps Όχι and is blocked from bot functionality | low | accept | Fully recoverable by design — gate re-appears on next `/start` or free-chat message since `consentGiven` stays false until accepted; no support intervention needed | closed |
| T-27-07 (27-02) | Information Disclosure | Consent prompt / decline-ack Greek text content | low | mitigate | `CONSENT_PROMPT_GREEK_TEMPLATE`/`CONSENT_DECLINE_ACK_GREEK` interpolate only the business's display name — verified in `src/consent/checker.ts` and `src/webhooks/telegram.ts`, no ids/tokens/secrets in any client-facing text | closed |
| T-27-08 (27-02) | Elevation of Privilege | Crafted `consent:yes`/`consent:no` callback for a (business, sender) pair with no prior relationship row | low | accept | Requires already knowing the per-bot `webhookId` + HMAC secret (gated upstream by webhook signature verification); worst case is a no-op UPDATE affecting zero rows — no data leak, no cross-tenant mutation | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on (high) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Note on IDs:** `T-27-04` was independently assigned by both 27-01-PLAN.md and 27-02-PLAN.md to two unrelated threats (plan-authoring collision, not a code issue). Disambiguated above by source plan; no action needed since both resolved closed.

**Related code-review findings (27-REVIEW.md):** WR-02 flagged that the `consentAction` callback branch lacks the owner-exclusion guard present on sibling branches (`escalationAction`/`menuAction`/etc.) — this is the same surface as T-27-04 (27-02) above, and the plan's own threat model already assessed and accepted it as low-severity/harmless (a forged callback can only toggle the caller's own flag). Left as an advisory consistency note, not reopened as a blocking threat.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-27-01 | T-27-04 (27-02) | Forged/replayed callback can only affect the tapping user's own consent flag for a business tied to an already-HMAC-verified webhook; idempotent no-op at worst | Plan author (27-02-PLAN.md threat model) | 2026-07-28 |
| AR-27-02 | T-27-06 (27-02) | Self-inflicted DoS is fully recoverable by design (D-02) — gate re-appears on next contact, no support burden | Plan author (27-02-PLAN.md threat model) | 2026-07-28 |
| AR-27-03 | T-27-08 (27-02) | Requires prior compromise of per-bot webhook HMAC secret; worst case is a no-op | Plan author (27-02-PLAN.md threat model) | 2026-07-28 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-28 | 9 | 9 | 0 | Orchestrator (L1 grep-depth verification, ASVS level 1 — short-circuit per workflow, no auditor sub-agent spawned) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-28
