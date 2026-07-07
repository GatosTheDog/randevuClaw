---
created: 2026-07-07T11:11:44.530Z
title: Pivot to per-business WhatsApp numbers post-PoC
area: planning
files:
  - .planning/REQUIREMENTS.md
  - .claude/CLAUDE.md
  - .planning/phases/01-foundation-webhook-business-resolution/01-CONTEXT.md
---

## Problem

Current locked design (CLAUDE.md, REQUIREMENTS.md, Phase 1 implementation) uses ONE shared WhatsApp number for all businesses, with the bot resolving business identity from a deep-link code embedded in the client's message (D-01/D-02/D-04 in 01-CONTEXT.md). REQUIREMENTS.md's Out-of-Scope table already flags "Per-business dedicated WhatsApp numbers" as a "revisit post-PoC" item, but with no concrete plan attached.

User confirmed during Phase 1 execution (2026-07-07) that they want to keep the single shared number for the PoC, but explicitly intend to pivot to one dedicated WhatsApp number per business once the platform passes PoC testing/validation. This is a real, intended future migration, not just a hypothetical.

## Solution

Not yet planned — flag for a future phase/milestone (post-PoC, likely v2) discussion. Implementation notes to carry forward:

- Business identity is already abstracted behind `business_id`/slug in the Phase 1 schema (`businesses`, `messages`, `client_business_relationships` tables), so the pivot is mainly a **routing-layer change**, not a full rewrite: route inbound webhooks on Meta's `phone_number_id` (each business's own WhatsApp number surfaces its own `phone_number_id` in the webhook payload) instead of parsing a business code out of the message text.
- Each business would need its own Meta Business Verification submission — a separate 1-6 week approval clock per business, not a one-time cost.
- Each business would need its own WhatsApp Business Account — real cost/friction implications beyond the current $0 budget (CLAUDE.md's near-$0 PoC constraint assumes ONE Meta verification, not N).
- The deep-link business-code matching logic (D-01 through D-04) may become redundant once numbers are per-business, or may be kept as a fallback/vanity-URL layer.
- Worth discussing whether this is a hard cutover (drop shared-number routing entirely) or businesses can choose either mode (shared vs. dedicated number) — this affects whether the code-based routing logic should be deleted or kept as an option.
