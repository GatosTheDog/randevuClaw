# Phase 27: Client Consent & Registration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 27-client-consent-registration
**Areas discussed:** Decline handling, Free-chat consent mechanism, Consent+registration wording, Backfill policy for existing clients

---

## Decline handling

| Option | Description | Selected |
|--------|-------------|----------|
| Block until accepted | No booking/chat/menu access until accepted; prompt re-shown on next message | ✓ |
| Allow as unregistered | Client can still chat/book; flag stays false forever, owner sees as incidental contact | |

**User's choice:** Block until accepted
**Notes:** Hard gate, mandatory.

---

## Free-chat consent mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Hard gate (same as /start) | First free-chat message gets Yes/No prompt instead of AI reply; actual message answered only after Ναι | ✓ |
| Keep soft/informational | Free-chat keeps today's behavior (notice text alongside first reply) | |

**User's choice:** Hard gate (same as /start)
**Notes:** True parity with /start path per success criteria #2 — this is a real behavior change from today's prepend-only approach.

---

## Consent+registration wording (merge)

| Option | Description | Selected |
|--------|-------------|----------|
| One merged Ναι/Όχι step | Single prompt, single tap; accepting sets consentGiven=true which IS the registered flag | ✓ |
| Two separate prompts | GDPR notice (informational) then a separate registration question | |

**User's choice:** One merged Ναι/Όχι step
**Notes:** Closes the folded todo's open question about not stacking two friction prompts.

---

## Backfill policy for existing clients

| Option | Description | Selected |
|--------|-------------|----------|
| Silent grandfather-in | Existing rows backfilled to consentGiven/opted-in=true, no re-prompt | ✓ |
| Re-prompt everyone once | Existing rows backfilled to false, every real client re-prompted once | |

**User's choice:** Silent grandfather-in
**Notes:** Matches ROADMAP Phase 27 success criteria #4 exactly (no real client silently blocked).

---

## Claude's Discretion

- Exact Greek wording for the merged consent+registration prompt (tone matches existing `CONSENT_NOTICE_GREEK_TEMPLATE`).
- Whether to rename `consentGiven` or repurpose it as-is (research recommends repurposing).
- Exact callback_data naming for the new client-facing Yes/No keyboard.
- Ordering of the consent gate relative to the existing unconditional `insertClientBusinessRelationship` upsert call.

## Deferred Ideas

None — discussion stayed within phase scope.

**Reviewed but not folded todos:** WhatsApp pivot, Meta BV, same-day slots (→ Phase 29), menu button reliability (→ Phase 30) — all low-relevance keyword-tool matches, confirmed out of scope for this phase.
