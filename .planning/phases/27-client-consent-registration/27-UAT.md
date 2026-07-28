---
status: complete
phase: 27-client-consent-registration
source: [27-01-SUMMARY.md, 27-02-SUMMARY.md]
started: 2026-07-28T12:21:39Z
updated: 2026-07-28T12:21:39Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any seed/migration completes, and a primary query (health check, or the bot responding to /start) returns live data.
result: skipped
reason: "User chose to skip manual cold-start verification and proceed to next phase"

### 2. Consent data-layer foundation (COMP-02)
expected: clientBusinessRelationships.consentGiven schema default flipped true->false; migrations/0013_client_consent_gate.sql created with backfill + default-flip statements
result: pass
source: automated
coverage_id: D1

### 3. Migration applied to live DB (COMP-02)
expected: migrations/0013_client_consent_gate.sql applied to the live Neon DB — column_default for client_business_relationships.consent_given confirmed false via read-only verification query
result: pass
source: automated
coverage_id: D2

### 4. Query layer opt-in semantics (COMP-02)
expected: insertClientBusinessRelationship no longer hardcodes consentGiven:true; onConflictDoUpdate SET clause unchanged; new updateClientConsentGiven(businessId, senderPhone, consentGiven) exported for Plan 27-02
result: pass
source: automated
coverage_id: D3

### 5. Consent domain logic (COMP-02)
expected: CONSENT_LABELS/CONSENT_PROMPT_GREEK_TEMPLATE/CONSENT_KEYBOARD exist and are exported; getOrCreateClientRelationship reflects the real inserted row's consentGiven instead of a hardcoded true
result: pass
source: automated
coverage_id: D1

### 6. /start hard consent gate (COMP-01)
expected: /start with consentGiven=false shows the Ναι/Όχι consent+registration prompt instead of the client menu; consentGiven=true is unchanged; consent:yes/consent:no callback_data is parsed and routed, updateClientConsentGiven called on yes, decline-ack sent on no, showClientRootMenu withheld on no
result: pass
source: automated
coverage_id: D2

### 7. Free-chat hard consent gate (COMP-01)
expected: Free-chat first contact with consentGiven=false is hard-gated: aiBookingAgent, insertConversationTurn, and channel.sendMessage (plain) are never called; instead channel.sendMessageWithKeyboard sends the consent prompt+keyboard. consentGiven=true is unchanged pass-through with the old soft prepend fully removed
result: pass
source: automated
coverage_id: D3

## Summary

total: 7
passed: 6
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

[none yet]
