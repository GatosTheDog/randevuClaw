---
created: 2026-07-29T00:00:00.000Z
title: Show admin's booking policies to new clients on first contact
area: onboarding
files:
  - src/consent/checker.ts (CONSENT_NOTICE_GREEK_TEMPLATE)
  - src/webhooks/telegram.ts (first-contact / consent gate path)
---

## Problem

When a new client first messages the bot, they see a consent notice (Phase 27,
COMP-01) but nothing about the business's actual booking policies. If the
owner has configured things like:

- A cancellation cutoff window (e.g. "cancel more than 6h before, no cutoff
  fee — inside 6h, you lose your slot")
- Slotless booking mode (client can request a booking even with no open
  slot; owner approves/rejects)

...the client has no idea these rules exist until they hit them mid-flow
(e.g. get surprised by a cutoff penalty on cancel).

## Solution

TBD, but likely shape: extend the first-contact consent message (or send a
short follow-up right after consent is accepted) with a dynamically-built
summary of whichever optional policies this business has actually turned on
— skip any policy that's off/default, so a plain-vanilla business doesn't get
a wall of text. Needs a look at what per-business policy flags already exist
(cancellationCutoffEnabled/Hours, bookingMode, slotlessRequestsEnabled, etc.)
to build the summary from.

Raised by user directly after testing the v1.7 deploy (2026-07-29).
