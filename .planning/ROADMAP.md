# Roadmap: RandevuClaw

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-07-09)
- ✅ **v1.1 Per-Bot Infrastructure & Owner Onboarding** — Phases 4-5 (shipped 2026-07-17)
- ✅ **v1.2 Billing & Membership System** — Phases 7-9 (shipped 2026-07-22)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) — SHIPPED 2026-07-09</summary>

- [x] Phase 1: Foundation, Webhook & Business Resolution (3/4 plans) — completed 2026-07-07 (01-04 deferred: Meta BV human action)
- [x] Phase 2: AI Booking Conversations & Owner Alerts (9/9 plans) — completed 2026-07-08
- [x] Phase 3: Calendar Sync, Agenda & Reminders (6/6 plans) — completed 2026-07-09

See: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v1.1 Per-Bot Infrastructure & Owner Onboarding (Phases 4-5) — SHIPPED 2026-07-17</summary>

- [x] **Phase 4: Per-Bot Foundation** — Telegraf migration, per-bot webhook routing, HMAC secret verification, and PostgreSQL RLS enforce tenant isolation. (completed 2026-07-11)
- [x] **Phase 5: Owner Self-Serve Onboarding** — Owners register their bot and configure their business through a 25-step guided Telegram chat flow; seed fixtures removed. (completed 2026-07-17)

Note: Phase 6 (GDPR Compliance & Rate-Limit Resilience) requirements deferred to v1.3 — COMP-02/03/04/RESIL-01 carry forward.

See: `.planning/milestones/v1.1-ROADMAP.md`

</details>

<details>
<summary>✅ v1.2 Billing & Membership System (Phases 7-9) — SHIPPED 2026-07-22</summary>

- [x] **Phase 7: Billing Configuration & Payment Recording** — Owner defines billing packages and records client payments via chat; the bot creates memberships with rolling expiry windows and an immutable session ledger. (completed 2026-07-21)
- [x] **Phase 8: Enforcement & Session Deduction** — Booking confirmation and cancellation atomically update session balances; the bot enforces per-business membership policies before accepting bookings. (completed 2026-07-21)
- [x] **Phase 9: Expiry Notifications & Client Balance** — The platform sweeps for near-expiry memberships and notifies clients and owners proactively; clients can query their own session balance at any time via chat. (completed 2026-07-22)

See: `.planning/milestones/v1.2-ROADMAP.md`

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation, Webhook & Business Resolution | v1.0 | 3/4 | Complete | 2026-07-07 |
| 2. AI Booking Conversations & Owner Alerts | v1.0 | 9/9 | Complete | 2026-07-08 |
| 3. Calendar Sync, Agenda & Reminders | v1.0 | 6/6 | Complete | 2026-07-09 |
| 4. Per-Bot Foundation | v1.1 | 6/6 | Complete | 2026-07-11 |
| 5. Owner Self-Serve Onboarding | v1.1 | 7/7 | Complete | 2026-07-17 |
| 6. GDPR Compliance & Rate-Limit Resilience | v1.3 | 0/TBD | Deferred | - |
| 7. Billing Configuration & Payment Recording | v1.2 | 7/7 | Complete | 2026-07-21 |
| 8. Enforcement & Session Deduction | v1.2 | 6/6 | Complete | 2026-07-21 |
| 9. Expiry Notifications & Client Balance | v1.2 | 3/3 | Complete | 2026-07-22 |
