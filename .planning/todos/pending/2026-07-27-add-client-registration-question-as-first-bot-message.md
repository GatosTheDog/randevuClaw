---
created: 2026-07-27T21:54:32.536Z
title: Add client registration question as first bot message
area: onboarding
resolves_phase: 27
files:
  - src/webhooks/telegram.ts (handleFoundBusiness, first-contact routing)
  - src/database/queries.ts (clientBusinessRelationships)
---

## Problem

Today, any Telegram user who messages a business's bot becomes a "client" by
virtue of `clientBusinessRelationships` getting a row on first contact — the
owner only ever sees phone numbers/Telegram IDs of whoever happened to message,
not a real opted-in client roster.

User idea: make the client bot's first message a registration prompt (e.g.
"Θέλετε να εγγραφείτε σε αυτή την επιχείρηση;" / "Do you want to register with
this business?") so the owner gets a genuine list of registered/opted-in
clients, not just incidental contacts.

## Solution

TBD — new feature, not a fix. Needs real UX design before building:
- Wording and exact placement (before or after the existing COMP-01 consent
  notice already shown on first contact?)
- Skippable or mandatory — does declining block booking, or just skip the
  "registered" flag?
- What changes for the owner: a new `/menu` → Clients view showing
  registered-only vs. all-contacts? A `registered: boolean` column on
  `clientBusinessRelationships`?
- Interaction with existing first-contact flow (`handleFoundBusiness` client
  branch, COMP-01 consent notice) — avoid stacking two friction prompts if
  they can be merged into one.
