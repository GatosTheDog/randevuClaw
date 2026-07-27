# Requirements: RandevuClaw v1.6

**Defined:** 2026-07-27
**Core Value:** A client can book or cancel an appointment with a Greek business entirely through a chat conversation, in Greek, with zero friction — and the owner's calendar updates automatically.

## v1 Requirements

### Booking Approval (OWNR)

- [ ] **OWNR-05**: Owner receives an approve/reject inline keyboard on a new session-class booking notification; the booking stays pending (client sees "request sent, awaiting confirmation") until the owner responds — mirrors the existing open-slots approve/reject pattern, applied to fixed_sessions bookings which currently auto-confirm with no owner say
- [ ] **OWNR-06**: Session capacity is soft-held while a booking is pending owner approval, and released back to the class if the owner rejects (or the request expires)
- [ ] **OWNR-07**: If owner approves, client gets the Greek confirmation message; if owner rejects, client gets a Greek rejection message and the slot reopens

### Class Management (CLSS)

- [ ] **CLSS-06**: Admin can delete/cancel a scheduled lesson (session instance) from the admin menu or chat
- [ ] **CLSS-07**: Deleting a lesson that has active client bookings cancels those bookings, restores each client's session credit/capacity, and sends each affected client a Greek notification that their booking was cancelled

### Bot Configuration (BOT)

- [ ] **BOT-06**: Telegram bot exposes a persistent menu button (Bot API `setChatMenuButton` + registered commands) so admin and client each get one-tap access to their respective menu without retyping `/menu` or `/start`

### Diagnostics (DIAG)

- [ ] **DIAG-01**: When the bot sends the generic Greek fallback error message to a client, the owner's own chat receives a best-effort follow-up technical message (what step/tool failed, error type) — client-facing message stays unchanged (clean Greek only)

### Client Invite (INVITE)

- [ ] **INVITE-01**: Owner can request an invite for their business's bot: a single message containing a QR image (composed with the business name + Greek call-to-action caption, ready to print standalone) AND the raw `t.me/<bot_username>` deep link as copyable plain text in the same message — so the owner can either print/post the QR or forward/paste the link into any channel (Telegram forward, SMS, WhatsApp, Instagram, email)

## v2 Requirements

None identified yet — all 5 target features are scoped into v1.6.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Per-client trokenized deep-link tracking (who invited whom) | Not requested; adds scope beyond a simple shareable invite |
| Configurable/custom menu button icon or per-owner branding | Telegram's menu button is functional, not cosmetic, for this PoC |
| Admin command to pull historical error logs (vs. push on occurrence) | User picked the push-a-technical-message approach (DIAG-01) over an on-demand pull command |
| Bulk lesson delete (recurring series) | Single-instance delete only; deleting a whole recurring series is a bigger, separate feature |
| Bot-initiated invite (admin triggers a message to an arbitrary Telegram user) | Telegram Bot API forbids a bot from messaging a user who hasn't `/start`ed it first (anti-spam platform rule) — no server-side workaround exists; forward/paste of the INVITE-01 link is the actual mechanism every Telegram bot uses |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| OWNR-05 | Phase 22 | Executed (human-verify pending — real-DB tests need local Postgres) |
| OWNR-06 | Phase 22 | Executed (human-verify pending — real-DB tests need local Postgres) |
| OWNR-07 | Phase 22 | Executed (human-verify pending — real-DB tests need local Postgres) |
| CLSS-06 | Phase 23 | Pending |
| CLSS-07 | Phase 23 | Pending |
| BOT-06 | Phase 24 | Pending |
| DIAG-01 | Phase 24 | Pending |
| INVITE-01 | Phase 25 | Pending |

**Coverage:**
- v1 requirements: 8 total
- Mapped to phases: 8/8 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-27*
*Last updated: 2026-07-27 after v1.6 roadmap creation (Phases 22-25)*
