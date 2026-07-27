# Domain Pitfalls: v1.7 UX/Trust Polish Integration Risks

**Project:** RandevuClaw (Telegram Bot, per-business, Neon/Drizzle RLS)
**Researched:** 2026-07-28
**Scope:** Retrofitting confirmation policies, reversing approval-flow design decisions, fixing compliance timing bugs, adding fuzzy name-matching, and Telegram menu button reliability
**Confidence:** MEDIUM

## Critical Pitfalls

### Pitfall 1: State Machine Races on Confirmation Policy Refactoring (Item 9)

**What goes wrong:**
Concurrent requests execute with stale state. Admin taps "delete lesson" + "confirm yes" simultaneously; one thread reads state, updates, releases capacity; second thread reads SAME row after update but before capacity release, wrongly calculates slots.

**Consequences:**
- Double-deduction: client charged twice
- Ghost notifications: client gets two cancellation alerts
- Corrupted capacity: lesson slot count goes negative

**Prevention:**
- Use SELECT FOR UPDATE + database-level idempotency keys
- Define idempotency keys at operation level, not user level
- Test double-click/retry scenarios explicitly
- Document which tools are intentionally instant

**Phase mapping:** Item 9 should be Phase 1 of v1.7.

---

### Pitfall 2: Reversing Reschedule Approval Design Decision with In-Flight Data (Item 10)

**What goes wrong:**
v1.6 Phase 22 made new bookings require approval but left reschedules auto-confirmed. Old reschedules exist with status="confirmed". New approval list filters to pending_owner_approval only, making old data invisible.

**Consequences:**
- Double-booked slots: same instance exceeds capacity
- Orphaned approvals: pending reschedule never approved/rejected
- Rollback deadlock: old state not cleanly restored

**Prevention:**
- Before rollout: Migration script upserts approval-request for old reschedules
- Add reschedule_approval_required_version column
- Dual-state query: Show both pending AND confirmed old reschedules
- Capacity-hold migration: Verify and re-lock capacity

**Phase mapping:** Item 10 should be Phase 2 of v1.7, after Item 9.

---

### Pitfall 3: GDPR Consent-Notice Timing Race in Multi-Tenant RLS System (Item 11)

**What goes wrong:**
Thread A queries consent_acknowledged (null), shows notice. Thread B gets callback, queries consent (still null), skips check, processes action. Thread A upserts relationship. Result: Thread B processed without consent.

**Consequences:**
- Compliance violation: GDPR Article 7 breach
- Client shown consent notice twice
- Cross-tenant consent leak

**Prevention:**
- Use atomic upsert: INSERT ... ON CONFLICT ... DO UPDATE
- Add RLS context before any query
- Use SERIALIZABLE isolation level
- Backfill existing relationships before deploying

**Phase mapping:** Item 11 should be Phase 1 of v1.7 alongside Item 9.

---

### Pitfall 4: Fuzzy Name-Matching Ambiguity and Wrong-User Deletions (Item 8)

**What goes wrong:**
Multiple clients share similar names. Fuzzy match ranks by edit distance; top match might not be intended. Admin taps confirm → wrong Gianni gets action.

**Consequences:**
- Wrong client receives refund
- Wrong client"s booking cancelled
- Audit trail wrong

**Prevention:**
- Multi-option confirmation UI: Show top-N matches
- Full-record confirmation: Show full client record before destructive action
- High-stakes require explicit: If confidence below 85%, require exact ID

**Phase mapping:** Item 8 should be Phase 3 of v1.7.

---

## Moderate Pitfalls

### Pitfall 5: Telegram Persistent Menu Button Scope/Caching Mismatch (Item 13)

**What goes wrong:**
Old clients cache command list ~5 minutes. New menu button won"t appear for existing users until cache expires.

**Consequences:**
- Inconsistent UX: new clients see menu, old clients don"t
- Stale cached state survives redeployments

**Prevention:**
- Call deleteMyCommands before setMyCommands to invalidate cache
- Verify with getMyCommands: Query same scope to confirm
- Explicit scope + language-code: Always specify both

**Phase mapping:** Item 13 should be Phase 3 of v1.7.

---

## Integration Risk Summary

Highest-risk: Reversing Reschedule Approval (Item 10 + Item 9)
- Mitigation: Implement Item 9 first, then Item 10

Second-highest-risk: Consent Notice in Callbacks (Item 11 + Item 8 + Item 9)
- Mitigation: Consent check as first Telegraf middleware

## Sources

- [Confirmation Component — AI Elements](https://elements.ai-sdk.dev/components/confirmation)
- [PortSwigger: Race Conditions and State Machines](https://portswigger.net/research/smashing-the-state-machine)
- [PingCAP: Database Design Patterns](https://www.pingcap.com/article/database-design-patterns-for-ensuring-backward-compatibility/)
- [TableOne: PostgreSQL ON CONFLICT](https://tableone.dev/blog/postgresql-on-conflict)
- [OneUptime: PostgreSQL Race Conditions](https://oneuptime.com/blog/post/2026-01-25-postgresql-race-conditions/)
- [DEV Community: Multi-Tenant Data Isolation](https://dev.to/whoffagents/multi-tenant-saas-data-isolation-row-level-security-tenant-scoping-and-plan-enforcement-with-1gd4)
- [Medium: Fuzzy Name Matching](https://medium.com/bcggamma/an-ensemble-approach-to-large-scale-fuzzy-matching-b3e3fa124e3c)
- [Cloudscape: Delete with Additional Confirmation](https://cloudscape.design/patterns/resource-management/delete/delete-with-additional-confirmation/)
- [GitHub #465: setMyCommands menu button](https://github.com/tdlib/telegram-bot-api/issues/465)
- [GramIO: setMyCommands Documentation](https://gramio.dev/telegram/methods/setmycommands)
