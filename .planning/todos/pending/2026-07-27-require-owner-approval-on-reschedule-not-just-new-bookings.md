---
created: 2026-07-27T21:54:32.536Z
title: Require owner approval on reschedule, not just new bookings
area: session-booking
files:
  - src/conversation/function-executor.ts:723 (rescheduleSessionTool)
---

## Problem

`rescheduleSessionTool` currently calls `bookSessionInstance(..., 'confirmed')`
— an explicit override that skips the pending-owner-approval flow added in
v1.6 Phase 22 (session-booking-approval-flow). This was a **deliberate locked
decision at the time** (see Phase 22's 22-01-PLAN.md), reasoning: "a client
rescheduling an already-confirmed booking to a new slot is not a new approval
request."

User has now explicitly said this is wrong: a reschedule to a new slot should
require the SAME owner approve/reject flow as a brand-new booking (owner gets
an Έγκριση/Απόρριψη keyboard, client waits for confirmation). This directly
reverses the Phase 22 decision — flagging it as such rather than treating it
as a bug that slipped through.

## Solution

TBD — likely: change `rescheduleSessionTool`'s `bookSessionInstance` call to
omit the `'confirmed'` override (or explicitly pass `'pending_owner_approval'`),
reusing the exact `sbk:approve`/`sbk:reject` cascade already built in Phase 22.
Needs a decision on what happens to the OLD booking during the pending window
(cancelled immediately vs. held until the new slot is approved) — this is a
real product question, not just a wiring change, since a client who reschedules
shouldn't lose their original slot's credit and then also get rejected on the
new one with no fallback.
