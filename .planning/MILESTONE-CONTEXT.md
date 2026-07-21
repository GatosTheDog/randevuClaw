# Milestone Context: Studio Session Scheduling & Slotless Bookings

> Captured: 2026-07-21 via /gsd-new-milestone pre-planning session.
> This file is consumed automatically by /gsd-new-milestone when that command runs.

## Proposed Milestone Name

Studio Session Scheduling & Slotless Bookings

## Suggested Version

v1.3 (after v1.2 Billing & Membership System completes)

## Dependency

**Depends on v1.2 fully shipped** (Phases 7, 8, 9 complete — session ledger, membership expiry, enforcement, package config).
Do not start execution before v1.2 phases land.

## Goal

Businesses can optionally run a class-style schedule — pre-defined sessions with capacity, recurring creation, direct client assignment — layered on the v1.2 membership/session-credit system. Cancellation and renewal-reminder timing become business-configurable, set during onboarding with sensible defaults and editable anytime via chat. Clients can request bookings with no open slot, subject to owner approval and tracked per client. Several behaviors are optional per business, not universal.

## Requirements

### Session Catalog & Admin Scheduling

- Owner creates a bookable session (date, time, capacity) via chat
- Owner creates recurring sessions (repeating day/time pattern) in one chat action
- Owner cancels an individual session; every booked client is notified in Greek automatically
- Owner assigns a specific client directly to a session; that client is notified in Greek

### Booking Flow Extensions

- Client can book multiple sessions in a single request (optional, per business — `allow_multi_booking`)
- Client reschedule is validated against membership validity window; cannot move past expiry (always enforced, not optional)

### Cancellation Cutoff Policy

- Owner sets a cancellation cutoff (hours before session) during onboarding; default 8 hours
- Has an explicit enable/disable switch — not just a number; some owners want no cutoff at all (matching current "cancel anytime" behavior)
- Owner can change or turn off the cutoff anytime via chat
- When enabled: client cancelling at/beyond cutoff gets credit restored; inside cutoff forfeits it
- Bot warns client in Greek before a cancellation that would forfeit a credit and requires explicit confirmation

### Slotless Booking Requests

- Optional per business, default off (adds manual approval workload some owners won't want)
- When enabled: client can request a booking with no open slot; routed to owner for approval
- Owner approves/rejects via chat; approved requests become real bookings
- Every slotless request is recorded per client regardless of outcome
- Owner can search/list a client's slotless history and count via chat
- At client's next check-in, owner is automatically shown their slotless-request count since the last check-in

### Renewal Notification Extensions

- Owner sets a "last-session" reminder threshold during onboarding (sessions remaining that triggers a nudge, default 1)
- Has an explicit enable/disable switch for owners who only want the existing date-based reminder
- Owner can change or turn off the threshold anytime via chat
- When enabled: client is notified in Greek when remaining sessions hit the threshold, in addition to the existing date-based expiry reminder
- Owner can trigger a mass renewal-reminder broadcast to all near-expiry clients via one command (always available, opt-in by usage, not a toggle)
- Owner can trigger a renewal reminder to one named client on demand (same, always available)

### Onboarding Extensions

- Onboarding (or v1.2 billing-setup step) asks whether to enable: class-schedule booking mode, cancellation cutoff, slotless requests, last-session threshold
- Each option has a clear default and a skip/disable option — never silently defaulting a business into a workflow it didn't choose
- Cutoff hours and last-session threshold are editable via the same "update config" chat entry point as existing hours/services edits

## Per-Business Settings (new config, not hardcoded)

| Setting | Values | Default | Notes |
|---------|--------|---------|-------|
| `booking_mode` | `open_slots` / `fixed_sessions` | `open_slots` | Alternate mode, not a replacement of existing booking |
| `cancellation_cutoff_enabled` | bool | false | Reverses "cancel anytime" — owner must opt in |
| `cancellation_cutoff_hours` | number | 8 | Only relevant when enabled |
| `last_session_threshold_enabled` | bool | false | Off = date-based reminder only (current v1.2 behavior) |
| `last_session_threshold_count` | number | 1 | Sessions remaining that triggers the nudge |
| `slotless_requests_enabled` | bool | false | Extra manual approval workload for owner |
| `allow_multi_booking` | bool | false | Lower priority than the other four |

## Always-Enforced (not optional)

- Reschedule cannot exceed membership expiry (data integrity)
- Clients always notified on owner cancel/assign within class-schedule mode
- Slotless search + check-in surfacing (automatic once slotless requests enabled)
- Owner-triggered broadcasts (opt-in by usage, no toggle needed)

## Open Questions to Resolve During Planning

1. Is recurring session pattern weekly-by-weekday only, or fully flexible?
2. Is session capacity a hard cap per session, or just multiple clients per slot?
3. Does an approved slotless booking consume a normal session credit, or is it tracked outside the membership ledger?
4. Does "mass" renewal notify mean all near-expiry clients, or the entire client list?
5. Should `booking_mode` be chosen once at onboarding and locked, or changeable later? (Risk: switching modes mid-operation could orphan existing bookings.)

## Out of Scope

- Per-session waitlists / auto-promote
- Per-instructor / per-room scheduling
- Recurrence patterns beyond weekly

## Note for PROJECT.md Update

This milestone reverses the existing "Out of Scope" line:
> "Cancellation cutoff windows — client can cancel anytime for now; add notice-period rule post-PoC if no-shows are a problem"

Update to: cutoffs now exist but are opt-in per business — the "cancel anytime" default is preserved unless the owner explicitly enables a cutoff.
