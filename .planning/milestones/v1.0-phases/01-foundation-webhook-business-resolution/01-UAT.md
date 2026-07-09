---
status: testing
phase: 01-foundation-webhook-business-resolution
source: [01-VERIFICATION.md]
started: 2026-07-07T00:00:00Z
updated: 2026-07-07T00:00:00Z
---

## Current Test

number: 1
name: Real WhatsApp end-to-end message flow
expected: |
  Send a real WhatsApp message containing "pilates-athens" to the bot number
  (e.g. via wa.me/<number>?text=pilates-athens or a direct chat message).
  Expected: a Greek reply confirming Pilates Athens, prefixed with the
  data-consent notice on first contact.
  Send a second message with an unrecognized code (e.g. "unknown-biz").
  Expected: a Greek "business not found" reply.
  GET /healthz should return 200.
awaiting: user response

## Tests

### 1. Real WhatsApp end-to-end message flow
expected: |
  Recognized business code (e.g. "pilates-athens") -> Greek confirmation
  reply, consent notice on first contact only. Unrecognized code ->
  Greek "business not found" reply, no crash. /healthz returns 200.
result: [pending]

### 2. Meta Business Verification submission
expected: |
  Owner submits verification request in Meta Business Manager ->
  Business Settings -> Security Center. Status changes from "Not Started"
  to "In Review", "Pending", or "Verified". Starts the 1-6 week approval
  clock required before later phases need a fully live number (Roadmap SC5).
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
