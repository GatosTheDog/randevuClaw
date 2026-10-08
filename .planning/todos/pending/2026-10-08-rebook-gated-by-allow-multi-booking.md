---
created: 2026-10-08T00:00:00.000Z
title: Revisit rebook-previous-month gating on allowMultiBooking
area: booking
files:
  - src/conversation/function-executor.ts
  - src/conversation/ai-agent.ts
  - .planning/quick/261008-gqb-rebook-previous-month-slots-flow-for-cli/261008-gqb-PLAN.md
---

## Problem

`list_previous_month_slots` (quick-261008-gqb) only works for `fixed_sessions` businesses with `allowMultiBooking` on. That flag defaults to false, so the feature is invisible until each owner enables "Πολλαπλές κρατήσεις". The prompt rules are also only emitted when enabled.

## Solution

Decide after real use: keep the gate, or make rebook independent of the setting (drop the gate in the tool and prompt rules). Check whether owners actually enable multi-booking.
