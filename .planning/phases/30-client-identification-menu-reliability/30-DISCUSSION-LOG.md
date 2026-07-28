# Phase 30: Client Identification & Menu Reliability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-29
**Phase:** 30-client-identification-menu-reliability
**Areas discussed:** Raw-ID tool scope, Name-match fallback, Disambiguation mechanics, Menu-button resilience posture

---

## Raw-ID tool scope

| Option | Description | Selected |
|--------|-------------|----------|
| Include all 4 | Cover list_slotless_requests alongside the 3 roadmap-named tools — identical shape, near-zero marginal cost. | ✓ |
| Only the 3 named | Strict literal roadmap scope; defer the 4th to a future phase. | |

**User's choice:** Include all 4 (Recommended).
**Notes:** Research (via Explore agent) found `list_slotless_requests` in `ai-owner-agent.ts` has the exact same `client_phone`-as-raw-Telegram-ID problem as the 3 named tools. Became D-01.

---

## Name-match fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Accept both, try name first | If input looks like a bare number, exact-match as client_phone first; otherwise substring-match as name. Zero regression risk, handles clients with no name yet. | |
| Name-only, remove raw-ID input | Drop client_phone param entirely in favor of a name param. Cleaner surface, but unreachable-until-first-message edge case. | ✓ |

**User's choice:** Name-only, remove raw-ID input — against the recommended option.
**Notes:** A deliberate override of the safer recommendation. Became D-02. Follow-up question resolved the resulting edge case (see below).

### Follow-up: zero-match / no-name-yet case

| Option | Description | Selected |
|--------|-------------|----------|
| Generic "no client found" message | Same shape whether it's a typo or a real client with no name on file yet. Mechanical, no special-casing. | ✓ |
| Explicit hint about the first-message gate | Tool result specifically explains the client may not have messaged yet. | |

**User's choice:** Generic "no client found" message (Recommended).
**Notes:** Became D-03.

---

## Disambiguation mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Text-based: Gemini re-asks | Tool returns match list as text; stateless agent asks a clarifying question in Greek; owner replies, Gemini re-calls with more detail. Zero new state machine. | ✓ (with refinement) |
| Inline-keyboard picker | New callback_data namespace + a tool-call-resumption mechanism that doesn't exist anywhere in this codebase today. | |

**User's initial answer (garbled, clarified via follow-up):** "the id is saved on the database just only the name is mentioned"
**Interpretation confirmed via follow-up question:** Text-based option selected, AND the disambiguation text shows client names only — never the raw Telegram ID/phone. ID/phone stays purely internal to the DB lookup.
**Notes:** Became D-04 (text-based mechanism) + D-05 (names-only in the text shown to the owner).

---

## Menu-button resilience posture

| Option | Description | Selected |
|--------|-------------|----------|
| Add retry + re-assert on /menu now | Close the known "one API call, one shot, no retry" gap regardless of research findings — retry on failure + idempotent re-assertion on next /menu tap. | ✓ |
| Wait for research findings first | Don't touch code; let the phase-researcher investigate real-world Telegram behavior before deciding what to fix. | |

**User's choice:** Add retry + one safe re-assertion point now (Recommended).
**Notes:** Research (via Explore agent) confirmed `setChatMenuButton`/`setMyCommands` fire exactly once per business, ever, inside `finish_onboarding`, with all 4 calls sharing one try/catch that silently swallows failures. Became D-06 — explicitly scoped as not preempting the deeper client-side-caching research question, which remains the phase-researcher's job.

---

## Claude's Discretion

- Exact retry count/backoff shape (D-06.1).
- Exact re-assertion wiring point — `/menu` text branch vs. `menu:root` callback vs. both (D-06.2).
- Whether disambiguation context includes last-booking-date for tie-breaking, or stays name-only.
- Exact Greek wording for the disambiguation re-ask and generic no-match message.
- Whether to consolidate the duplicated `assertCallbackDataSize` helper (3 files) — not required, opportunistic only.

## Deferred Ideas

- Consolidating `assertCallbackDataSize` (duplicated across `admin-menu.ts`, `client-menu.ts`, `escalation.ts`) — unrelated to this phase's actual scope, found incidentally during research.
