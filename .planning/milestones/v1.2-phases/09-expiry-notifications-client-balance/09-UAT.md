---
status: complete
phase: 09-expiry-notifications-client-balance
source:
  - 09-01-SUMMARY.md
  - 09-02-SUMMARY.md
  - 09-03-SUMMARY.md
started: "2026-07-21T00:00:00Z"
updated: "2026-07-21T00:00:00Z"
---

## Current Test

number: complete
name: all tests done
awaiting: none

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server. Start the application from scratch with `npm run dev` or equivalent. Server boots without errors. The startup log shows startMembershipExpiryPoller() registering (the 6-hour sweep fires on boot). No uncaught exceptions. A basic Telegram webhook or health check returns a live response.
result: pass

### 2. Client balance check — sessions remaining (NOTF-04)
expected: Send a Telegram message as a client to the business bot asking about your membership (e.g. "Πόσα μαθήματα μου έχουν απομείνει;"). The bot replies in Greek with a message like "Έχετε X μαθήματα απομείνει. Η συνδρομή σας λήγει στις DD/MM/YYYY." The date is formatted in Greek DD/MM/YYYY style.
result: blocked
blocked_by: physical-device
reason: "No second Telegram account available — owner account routes to owner agent. Client path requires a separate Telegram user."

### 3. Client balance check — no active membership (NOTF-04)
expected: Send a balance-check message as a client who has no active membership. The bot replies in Greek: "Δεν βρέθηκε ενεργή συνδρομή. Επικοινωνήστε με [business name] για ανανέωση."
result: blocked
blocked_by: physical-device
reason: "No second Telegram account available — same blocker as test 2."

### 4. Client balance check — unlimited sessions (NOTF-04)
expected: Send a balance-check message as a client with an unlimited-session membership. The bot replies in Greek mentioning unlimited sessions and the expiry date: "Η συνδρομή σας είναι απεριόριστων μαθημάτων και λήγει στις DD/MM/YYYY."
result: blocked
blocked_by: physical-device
reason: "No second Telegram account available — same blocker as test 2."

### 5. 7-day expiry notification sent to client (NOTF-01)
expected: With a membership whose expiresAt is 7 days from today (Athens time), trigger the sweep (restart server or wait for the 6-hour tick). The client receives a Telegram message in Greek mentioning their sessions remaining and the expiry date. Message is sent only once (check that a second sweep run within the same day produces no duplicate message to the client).
result: pass

### 6. 7-day expiry notification sent to owner (NOTF-02)
expected: For the same expiring membership, the owner's Telegram account receives a Greek notification naming the client (or their phone if name unknown) and the expiry date. Message sent only once — a second sweep produces no duplicate to the owner.
result: pass

### 7. Dedup — no duplicates on repeat sweep (NOTF-03)
expected: After the expiry sweep fires for a membership, run the sweep again (restart server within the same day). No additional Telegram messages are sent to client or owner for the same membership+expiry date. The membership_expiry_notifications table has exactly one row per (membership_id, notification_type, expiry_date) combination.
result: pass

## Summary

total: 7
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 3

## Gaps

[none yet]
