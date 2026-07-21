---
status: diagnosed
phase: 07-billing-configuration-payment-recording
source: [07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md, 07-05-SUMMARY.md]
started: 2026-07-21T15:41:25Z
updated: 2026-07-21T16:06:00Z
---

## Current Test

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server. Clear ephemeral state. Start the application from scratch. Server boots without errors, migrations complete (or are skipped as already applied), and the Telegram webhook is reachable (e.g., health check endpoint returns 200, or the bot responds to a test message).
result: pass

### 2. Create Package — Confirm Path (BILL-01)
expected: Owner sends a message to the bot requesting a new billing package (e.g., "Δημιούργησε πακέτο 10 συνεδρίες, 80 ευρώ, ισχύει 30 μέρες"). Bot replies in Greek with a confirmation message describing the package and an inline keyboard with Ναι / Όχι buttons. Owner taps Ναι. Bot confirms the package is now active.
result: issue
reported: "package was created (Πακέτο ενεργοποιήθηκε επιτυχώς) but the yes no button did not go away — keyboard remains on the confirmation message after action"
severity: major

### 3. Create Package — Cancel Path (BILL-01)
expected: Owner creates a package as above, receives the Ναι/Όχι confirmation keyboard, then taps Όχι. Bot confirms the package was cancelled (not created). The pending package row is deleted from DB (package does NOT appear in the active list).
result: pass

### 4. List Packages (BILL-02)
expected: Owner asks the bot to list available billing packages. Bot replies in Greek with a formatted list of active packages including name, session count, price, and validity days. If there are no active packages, bot replies with a Greek empty-state message.
result: pass

### 5. Deactivate a Package (BILL-03)
expected: Owner asks the bot to deactivate a specific package by name or description. Bot soft-deletes (sets is_active = false) and replies in Greek confirming the package was deactivated. The package no longer appears in the List Packages output.
result: issue
reported: "bot confirmed deactivation of 'Test Package 10 Sessions' but follow-up list still shows that package active — the OTHER package (Πακέτο 10 συνεδρίων) disappeared instead. Wrong package deactivated."
severity: major

### 6. Record Payment — Full Flow (PAY-01)
expected: Owner says "record payment" or equivalent Greek phrase. Bot responds with an inline keyboard listing recent clients (last 30 days). Owner taps a client. Bot sends a new keyboard listing active packages with the price visible in the button text. Owner taps a package. Bot sends a confirmation message (client + package details) with Ναι / Όχι. Owner taps Ναι. Bot confirms membership was created and sends a Greek confirmation message.
result: issue
reported: "bot replied 'Δεν υπάρχουν πελάτες με ραντεβού τις τελευταίες 30 ημέρες' — flow aborts immediately, no client keyboard shown. No fallback when recent-clients query returns empty."
severity: major

### 7. Record Payment — Cancel (PAY-01)
expected: Owner goes through client and package selection as in Test 6, reaches the Ναι/Όχι confirmation step, then taps Όχι. Bot cancels the flow and sends a Greek cancellation message. No membership is created.
result: blocked
blocked_by: prior-phase
reason: "same root cause as Test 6 — flow aborts before client keyboard due to no recent bookings"

### 8. View Client Membership — Active (PAY-03)
expected: After a membership has been created (e.g., from Test 6), owner asks the bot to view the client's membership (e.g., "τι πακέτο έχει ο Γιάννης;"). Bot replies in Greek with the active membership details: package name, expiry date, sessions remaining (or "unlimited"), and active status.
result: blocked
blocked_by: prior-phase
reason: "no client data in test DB — membership was never created because Test 6 failed"

### 9. View Client Membership — None (PAY-03)
expected: Owner asks the bot to view membership for a client who has no active membership. Bot replies in Greek with a "no active membership" message (not an error).
result: pass

### 10. Client Name in Payment Keyboard (D-04)
expected: When a client sends any message to the bot, their Telegram display name is captured and upserted. When the owner later runs the record_payment flow (Test 6), the client selection keyboard shows the client's real name (not a fallback placeholder).
result: blocked
blocked_by: prior-phase
reason: "no clients have sent messages to the bot in test environment — clientName upsert and keyboard display untestable"

## Summary

total: 10
passed: 4
issues: 3
pending: 0
blocked: 3
skipped: 0
blocked: 0

## Gaps

- gap_id: G-07-6
  truth: "record_payment flow shows client selection keyboard even when no bookings exist in last 30 days (or shows a useful fallback)"
  status: failed
  reason: "User reported: bot replied no clients with appointments in last 30 days and flow aborted — no client keyboard, no fallback path. getRecentClientsForBusiness returned empty."
  severity: major
  test: 6
  root_cause: "showClientSelection (payment-flow.ts:53-59) hard-exits when getRecentClientsForBusiness returns empty. That query INNER JOINs bookings+services with 30-day cutoff — returns nothing when no recent bookings. clientBusinessRelationships table (all-time clients) never consulted as fallback."
  artifacts:
    - path: "src/telegram/handlers/payment-flow.ts"
      issue: "showClientSelection has no fallback branch when 30-day bookings query returns empty"
    - path: "src/billing/queries.ts"
      issue: "getRecentClientsForBusiness is bookings-only INNER JOIN; no all-time fallback query exists"
  missing:
    - "Add getAllClientsForBusiness(businessId) to billing/queries.ts using clientBusinessRelationships directly (no booking join, no date filter)"
    - "In showClientSelection, fall back to getAllClientsForBusiness when getRecentClientsForBusiness returns empty"

- gap_id: G-07-5
  truth: "deactivate_package deactivates the package the owner named, not a different one"
  status: failed
  reason: "User reported: bot confirmed Test Package 10 Sessions deactivated but that package still appeared in list; Paketo 10 synedrion (different package) was removed instead"
  severity: major
  test: 5
  root_cause: "deactivate_package FunctionDeclaration requires package_id (integer) but Gemini has no way to know numeric IDs — list_packages omits IDs, system prompt has no package context. Gemini hallucinates the ID. handleDeactivatePackage returns generic success string (no package name echo) so Gemini cannot detect the mismatch."
  artifacts:
    - path: "src/onboarding/ai-owner-agent.ts"
      issue: "deactivate_package FunctionDeclaration takes package_id integer — Gemini must hallucinate it; buildOwnerSystemPrompt injects zero package context"
    - path: "src/billing/tools.ts"
      issue: "handleListPackages omits id field from output; handleDeactivatePackage returns generic success string with no package name echo"
  missing:
    - "Change deactivate_package FunctionDeclaration to accept package_name (string) matching the delete_service pattern"
    - "In executeOwnerTool, resolve package_name to id via case-insensitive partial match against listPackages before calling handleDeactivatePackage"
    - "handleDeactivatePackage should echo the actual package name in its success string"

- gap_id: G-07-2
  truth: "Ναι/Όχι keyboard is dismissed from the confirmation message after owner taps either button"
  status: failed
  reason: "User reported: package was created successfully but the yes no button did not go away — keyboard remains on the confirmation message after action"
  severity: major
  test: 2
  root_cause: "TelegramCallbackQuery interface missing message?: { message_id: number } — keyboard message ID silently dropped from every callback payload. Billing terminal branches (pkg_confirm, pkg_cancel, mem_confirm, mem_cancel) never call editTelegramMessageReplyMarkup. Booking branches DO clear keyboard (telegram.ts:356-358) using ownerTelegramMessageId from DB; billing has no equivalent. COVERAGE.md OPT-OUT for editMessageReplyMarkup applied too broadly."
  artifacts:
    - path: "src/webhooks/telegram.ts"
      issue: "TelegramCallbackQuery interface (lines 46-50) missing message?: { message_id: number }; billing terminal branches (lines 262-268) missing editTelegramMessageReplyMarkup call"
    - path: "src/telegram/handlers/payment-flow.ts"
      issue: "handleConfirmPackage, handleCancelPackage, handleConfirmMembership do not receive messageId and cannot clear keyboard"
  missing:
    - "Extend TelegramCallbackQuery interface with message?: { message_id: number }"
    - "After each billing terminal callback call editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, []) to clear the keyboard"
