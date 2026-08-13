# Deferred Items — Quick Task 260813-g86

Out-of-scope discoveries found during execution, logged per the executor's
scope-boundary rule (do not fix pre-existing failures unrelated to the
current task's changes).

## tests/scheduler-agenda.test.ts fails to compile (pre-existing, unrelated)

**Found during:** Task 1 verification (ran `npx jest --testPathPattern
scheduler-agenda -i` as a sanity check after editing this file's `Test 3`
and `Test 6` assertions to match the new third-argument call shape).

**Issue:** The test suite fails at the TypeScript compile step (ts-jest),
independent of any change in this task:

```
tests/scheduler-agenda.test.ts:33:3 - error TS2322: Type '{ ... }' is not
assignable to type 'Business'. Types of property 'bookingMode' are
incompatible. Type 'string | undefined' is not assignable to type 'string'.

tests/scheduler-agenda.test.ts:51:3 - error TS2322: Type '{ ... }' is not
assignable to type 'Booking'. Types of property 'sessionInstanceId' are
incompatible. Type 'number | null | undefined' is not assignable to type
'number | null'.
```

Confirmed pre-existing via `git stash push -- tests/scheduler-agenda.test.ts`
followed by re-running the suite against the untouched file at HEAD
(14ea816) — identical TS2322 errors, 0 tests run. The `Business`/`Booking`
interfaces gained `bookingMode` / `sessionInstanceId` fields in a later
phase without this file's `makeBusiness()`/`makeBooking()` fixture
factories being updated to supply them.

**Action taken:** Not fixed (out of scope — a pre-existing, unrelated
compile break, not caused by this task's `listBookingsForDate` statuses-arg
fix). This task's own edits to `Test 3` and `Test 6` in that file (adding
the `['confirmed', 'pending_owner_approval']` third-argument assertion, to
keep them consistent with the `src/scheduler/agenda.ts` fix) were kept —
they are logically correct and will pass once the pre-existing fixture
compile break above is fixed in a future pass — but could not be verified
to pass in isolation today because the whole suite fails to compile
regardless of these edits.

**Recommendation:** A future test-suite-health pass should add
`bookingMode` to `makeBusiness()`'s return object and `sessionInstanceId:
null` (or similar) to `makeBooking()`'s return object in
`tests/scheduler-agenda.test.ts`, then re-verify `Test 3`/`Test 6`/`Test 7`
pass with the updated third-argument assertions.
