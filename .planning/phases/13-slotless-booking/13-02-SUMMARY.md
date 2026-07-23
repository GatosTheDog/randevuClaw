---
phase: 13-slotless-booking
plan: 02
status: complete
---

## What was done
- Extended `Business` interface in `queries.ts` with `slotlessRequestsEnabled: boolean` (SLOT-01)
- Extended `ToolContext.business` in `function-executor.ts` with `slotlessRequestsEnabled: boolean` (SLOT-01)
- Added `slotlessRequestsEnabled` propagation in `ai-agent.ts` ToolContext construction
- Added slotless fork in `bookAppointmentTool`: when `slotlessRequestsEnabled=true` and no availability slots, calls `insertSlotlessRequest` and returns `{ success: false, slotless_request_submitted: true }` (SLOT-01)
- Added SLOT-06 count in `alertOwnerNewBooking`: `countSlotlessRequestsSinceCheckin` appended to owner alert text, wrapped in best-effort try/catch
- Added `list_slotless_requests` to `OWNER_TOOLS` and `executeOwnerTool` case in `ai-owner-agent.ts` (SLOT-05)
- Added import of `listSlotlessRequestsForClient` in `ai-owner-agent.ts`

## Verification
TypeScript compiled without errors.
