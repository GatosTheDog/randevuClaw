---
created: 2026-07-27T21:54:32.536Z
title: Fix same-day past-time slots showing as bookable
area: session-booking
resolves_phase: 29
files:
  - src/session/manager.ts:483 (listSessions)
---

## Problem

`listSessions()` in `src/session/manager.ts` filters candidate session instances by
**date** only — `today` (Athens) onward via `isoDateInAthens` — and never checks
`sessionTime` against the current time-of-day when `sessionDate === today`.

Confirmed via live usage: asking the bot for available bookings today at 21:00
(9pm) still returns today's 09:00 and 10:00 slots as bookable, even though those
times have already passed.

## Solution

TBD, but the fix is narrow: when filtering/returning sessions where
`sessionDate === today`, additionally exclude any row whose `sessionTime` is
`<=` the current Athens time-of-day. Sessions on future dates are unaffected.
Check call sites (client-menu booking list, free-chat `list_sessions`/booking
tools) to confirm they all go through this one function so the fix doesn't
need duplicating.
