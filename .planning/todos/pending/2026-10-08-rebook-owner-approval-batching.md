---
created: 2026-10-08T00:00:00.000Z
title: Batch approve/reject for multi-booking and rebook requests
area: booking
files:
  - src/conversation/function-executor.ts
  - .planning/quick/261008-gqb-rebook-previous-month-slots-flow-for-cli/261008-gqb-PLAN.md
---

## Problem

Each class rebooked via quick-261008-gqb sends the owner its own Έγκριση/Απόρριψη keyboard. A client rebooking a month (~8-12 classes) floods the owner. All pending rows share the 2-hour expiry, so unanswered requests expire together. Same behavior as the existing multi-booking path; accepted in the plan's threat model.

## Solution

Add a batch approve/reject (one message per request group), and/or a longer expiry for rebook batches. Revisit once an owner reports the noise.
