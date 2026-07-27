---
created: 2026-07-27T21:54:32.536Z
title: Run full UX audit before scoping v1.7
area: planning
resolved: 2026-07-28
resolves_phase: 26-30
files: []
---

## Resolution (2026-07-28)

Audit run as the first step of `/gsd-new-milestone` for v1.7. General-purpose agent walked both client (`/start` + free-chat) and admin (`/menu` + free-chat) flows end-to-end against the actual code, cross-referenced against the 4 already-captured todos. 17 findings surfaced; all folded into v1.7's 15 requirements (CONF-01/02, ADMIN-01..05, UX-01..06, COMP-01/02) across Phases 26-30. A few low-priority findings (client roster pagination, pending-slotless-requests view, divergent today's-schedule implementations, raw exception text to owner) were explicitly deferred to v2 Requirements / Out of Scope in REQUIREMENTS.md rather than scheduled.

## Problem

User asked for a broader "what's missing from a UX perspective" audit across
the whole bot (both client and admin sides) — inconsistencies, friction points,
anything that would meaningfully improve the experience — beyond the 4 specific
items already captured as separate todos (same-day slot bug, menu button
reliability, reschedule approval, registration question).

That broader audit was explicitly NOT done in this session — deferred due to
context budget limits (session was at ~65-67% usage when the request came in).
This todo exists so the ask isn't lost.

## Solution

TBD — in a fresh session: read through the current client (`/start` menu,
free-chat) and admin (`/menu`) flows end-to-end, cross-reference against the 4
already-captured todos, and produce a scoped list of UX findings. Then decide
with the user which findings become v1.7 requirements vs. backlog vs. skip.
This is the right moment to also fold in the 3 other captured todos
(same-day-slots is a quick fix; reschedule-approval and registration-question
are v1.7-shaped) into a coherent v1.7 milestone scope, rather than planning
v1.7 requirement-by-requirement in isolation.
