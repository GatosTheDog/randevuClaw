# Phase 1: Foundation, Webhook & Business Resolution - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 1-Foundation, Webhook & Business Resolution
**Areas discussed:** Business code & deep-link format, Dedup/idempotency store, Consent & first-contact flow, Fixture businesses & tenant isolation

---

## Business Code & Deep-Link Format

| Option | Description | Selected |
|--------|-------------|----------|
| Readable slug | e.g. 'pilates-athens' — human-friendly, easy to share/print | ✓ |
| Short random token | e.g. 'a3f9k2' — avoids collisions but less memorable | |
| Numeric business ID | e.g. '1042' — simplest but meaningless to humans | |

**User's choice:** Readable slug

| Option | Description | Selected |
|--------|-------------|----------|
| Normalize, exact match | Lowercase + trim + strip accents, then require exact match | ✓ |
| Normalize + fuzzy fallback | Same normalization, plus "did you mean" suggestions | |

**User's choice:** Normalize, exact match

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-generated from business name | System slugifies the name, appends number on collision | ✓ |
| Owner picks it during onboarding | Owner chooses/customizes the slug | |

**User's choice:** Auto-generated from business name (owner customization deferred to Phase 4)

| Option | Description | Selected |
|--------|-------------|----------|
| Exact message match only | Bot only recognizes the code if the whole message is just the code | |
| Extract from first message | Bot scans the first message for a known slug pattern anywhere in the text | ✓ |

**User's choice:** Extract from first message

**Notes:** None beyond the choices above.

---

## Dedup/Idempotency Store

| Option | Description | Selected |
|--------|-------------|----------|
| Postgres-only | UNIQUE constraint + INSERT ON CONFLICT DO NOTHING, no new service | ✓ |
| Add Redis (Upstash free tier) | Matches research recommendation exactly, but adds a service outside locked stack | |

**User's choice:** Postgres-only — resolves a conflict between research (recommended Redis) and CLAUDE.md's locked stack (no Redis).

| Option | Description | Selected |
|--------|-------------|----------|
| Keep forever (audit log) | Message IDs live in the permanent audit table, no cleanup job | ✓ |
| TTL cleanup (24-48h) | Scheduled job purges old records | |

**User's choice:** Keep forever

| Option | Description | Selected |
|--------|-------------|----------|
| Silent no-op | Return HTTP 200, log duplicate, no reply sent | ✓ |
| Re-send the original reply | Look up and re-send the prior reply | |

**User's choice:** Silent no-op

| Option | Description | Selected |
|--------|-------------|----------|
| Mark first, then process | Insert message ID immediately on receipt | |
| Process first, then mark | Only insert message ID after reply succeeds | ✓ |

**User's choice:** Process first, then mark — accepts rare duplicate-reply risk over silently dropping messages on crash.

**Notes:** This area surfaced a genuine stack conflict (research vs. CLAUDE.md) which the user resolved in favor of the locked stack.

---

## Consent & First-Contact Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Per phone number, globally | Consent shown once across the whole platform | |
| Per phone number, per business | Each new business relationship shows consent again | ✓ |

**User's choice:** Per phone number, per business

| Option | Description | Selected |
|--------|-------------|----------|
| Inform-and-continue (implied consent) | Bot sends notice, proceeds without waiting for explicit reply | ✓ |
| Block until explicit reply | Bot waits for explicit "yes/OK" before proceeding | |

**User's choice:** Inform-and-continue (implied consent)

| Option | Description | Selected |
|--------|-------------|----------|
| Contract necessity | Frames storage as necessary to fulfill the booking, no opt-out line | ✓ |
| Consent with opt-out mention | Adds a "reply STOP" opt-out line | |

**User's choice:** Contract necessity

| Option | Description | Selected |
|--------|-------------|----------|
| Flag + timestamp on client-business record | Simple column on the (phone, business_id) relationship | ✓ |
| Separate consent-events log table | Append-only audit table, more schema overhead | |

**User's choice:** Flag + timestamp on client-business record

**Notes:** None beyond the choices above.

---

## Fixture Businesses & Tenant Isolation

| Option | Description | Selected |
|--------|-------------|----------|
| App-level filtering (WHERE business_id = ?) | Shared query-builder helper, simpler for PoC | ✓ |
| Postgres Row-Level Security | DB-enforced via Drizzle crudPolicy(), more setup now | |

**User's choice:** App-level filtering — RLS deferred to Phase 4 if needed.

| Option | Description | Selected |
|--------|-------------|----------|
| Two fixtures | Minimum needed to prove disambiguation works | ✓ |
| One fixture only | Simplest, doesn't exercise disambiguation until Phase 4 | |

**User's choice:** Two fixtures

| Option | Description | Selected |
|--------|-------------|----------|
| Name + slug/code only | Just enough to resolve and greet | ✓ |
| Name + slug + hours + placeholder greeting | Richer fixture for a fuller greeting reply | |

**User's choice:** Name + slug/code only

| Option | Description | Selected |
|--------|-------------|----------|
| Drizzle seed script | Committed seed.ts, reproducible, re-runnable | ✓ |
| Migration-embedded data | Insert rows directly in a migration file | |

**User's choice:** Drizzle seed script

**Notes:** None beyond the choices above.

---

## Claude's Discretion

- Exact Greek wording of the consent notice and business-confirmation reply.
- Exact slug-collision suffix scheme.
- Shape/columns of the audit/messages table beyond the message-ID UNIQUE constraint.

## Deferred Ideas

- Owner-customizable business slugs — Phase 4.
- Fuzzy/"did you mean" matching for mistyped codes — reconsider if exact-match proves too brittle.
- Postgres Row-Level Security for tenant isolation — reconsider in Phase 4.
- Consent opt-out line ("reply STOP") — reconsider alongside COMP-02 (Phase 5).
