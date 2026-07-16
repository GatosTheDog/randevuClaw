---
quick_id: 260716-hxo
slug: streamline-hours-onboarding-single-time
description: "streamline hours onboarding: single time range question with split hours support"
date: "2026-07-16"
status: pending
must_haves:
  truths:
    - "Hours onboarding uses ONE question per day accepting 'HH:MM-HH:MM' or 'HH:MM-HH:MM,HH:MM-HH:MM'"
    - "business_hours table has nullable openTime2/closeTime2 columns for split-day support"
    - "availability.ts generates slots from both ranges when openTime2/closeTime2 set"
    - "hours_X_open and hours_X_close step types removed; hours_X_range added"
    - "All existing tests pass (or are updated to match new flow)"
  artifacts:
    - "migrations/0005_split_hours.sql"
    - "src/database/schema.ts — openTime2/closeTime2 fields"
    - "src/database/queries.ts — BusinessHours interface updated"
    - "src/onboarding/steps.ts — handleHoursRangeStep replaces open+close handlers"
    - "src/onboarding/router.ts — routes hours_X_range"
    - "src/business/availability.ts — handles split ranges"
---

# Quick Task 260716-hxo: Streamline Hours Onboarding + Split Hours

## Goal

1. Replace 2 questions (open time, close time) with 1 question: `"Ώρες {day} (π.χ. 09:00-18:00 ή 09:00-13:00,17:00-21:00):"`
2. Support split hours per day (morning + evening) via a second optional range.

---

## Task 1: DB migration + schema + query type

### `migrations/0005_split_hours.sql` (new file)

```sql
-- Migration: 0005_split_hours.sql
-- Purpose: Add optional second time range to business_hours for split-day support.
-- Idempotency: ADD COLUMN IF NOT EXISTS (Postgres 9.6+).

ALTER TABLE business_hours
  ADD COLUMN IF NOT EXISTS open_time_2 TEXT,
  ADD COLUMN IF NOT EXISTS close_time_2 TEXT;
```

Apply to live Neon DB:
```bash
psql $DATABASE_URL -f migrations/0005_split_hours.sql
```

Apply to local test DB:
```bash
psql randevuclaw_test -f migrations/0005_split_hours.sql
```

### `src/database/schema.ts`

In the `businessHours` pgTable definition, after `closeTime`, add:
```ts
openTime2: text('open_time_2'),   // nullable — second range open, e.g. "17:00"
closeTime2: text('close_time_2'), // nullable — second range close, e.g. "21:00"
```

### `src/database/queries.ts`

In `BusinessHours` interface, add:
```ts
openTime2: string | null;
closeTime2: string | null;
```

---

## Task 2: Onboarding step refactor

**Files**: `src/onboarding/steps.ts`, `src/onboarding/router.ts`

### `OnboardingStep` type changes

Remove: `hours_0_open` through `hours_6_open`, `hours_0_close` through `hours_6_close` (14 types)
Add: `hours_0_range` through `hours_6_range` (7 types)

### `CollectedData` changes

Remove: `currentDayOpenTime` field (no longer needed — both times parsed in one step)

### New `parseTimeRange` helper (private, in steps.ts)

```ts
const RANGE_REGEX = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

interface ParsedRanges {
  openTime: string;
  closeTime: string;
  openTime2: string | null;
  closeTime2: string | null;
}

function parseTimeRange(text: string): ParsedRanges | null {
  const parts = text.trim().split(',').map((s) => s.trim());
  if (parts.length > 2) return null;

  if (!RANGE_REGEX.test(parts[0])) return null;
  const [open1, close1] = parts[0].split('-');
  // open must be before close
  if (timeToMinutes(open1) >= timeToMinutes(close1)) return null;

  if (parts.length === 1) {
    return { openTime: open1, closeTime: close1, openTime2: null, closeTime2: null };
  }

  if (!RANGE_REGEX.test(parts[1])) return null;
  const [open2, close2] = parts[1].split('-');
  if (timeToMinutes(open2) >= timeToMinutes(close2)) return null;
  // Second range must start AFTER first range ends (no overlap)
  if (timeToMinutes(open2) <= timeToMinutes(close1)) return null;

  return { openTime: open1, closeTime: close1, openTime2: open2, closeTime2: close2 };
}
```

### New `handleHoursRangeStep`

```ts
export async function handleHoursRangeStep(
  day: number,
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const parsed = parseTimeRange(text);
  const exampleText = 'π.χ. 09:00-18:00 ή 09:00-13:00,17:00-21:00';

  if (!parsed) {
    await sendTelegramMessage(
      ownerTelegramId,
      `Μη έγκυρο. Χρησιμοποιήστε μορφή ΩΩ:ΛΛ-ΩΩ:ΛΛ (${exampleText}):`
    );
    return;
  }

  await db
    .insert(businessHours)
    .values({
      businessId: business.id,
      dayOfWeek: day,
      openTime: parsed.openTime,
      closeTime: parsed.closeTime,
      openTime2: parsed.openTime2,
      closeTime2: parsed.closeTime2,
      isClosed: false,
    })
    .onConflictDoNothing();

  if (day < 6) {
    const nextStep = `hours_${day + 1}_query` as OnboardingStep;
    await updateOnboardingStep(session.id, nextStep, null);
    await sendTelegramMessageWithKeyboard(
      ownerTelegramId,
      `Είστε ανοιχτά την ${GREEK_DAY_NAMES[day + 1]};`,
      YES_NO_BUTTONS
    );
  } else {
    await updateOnboardingStep(session.id, 'svc_name', null);
    await sendTelegramMessage(
      ownerTelegramId,
      'Ωραία! Προσθέστε μια υπηρεσία.\nΌνομα υπηρεσίας: (π.χ. Reformer Pilates)'
    );
  }
}
```

### `handleHoursQueryStep` yes-branch

Change `hours_${day}_open` → `hours_${day}_range`:
```ts
if (isYes) {
  const nextStep = `hours_${day}_range` as OnboardingStep;
  await updateOnboardingStep(session.id, nextStep, null);
  await sendTelegramMessage(
    ownerTelegramId,
    `Ώρες ${GREEK_DAY_NAMES[day]} (π.χ. 09:00-18:00 ή 09:00-13:00,17:00-21:00):`
  );
}
```

### `handleHoursCloseStep` no-branch → next day prompt

The no-branch in `handleHoursCloseStep` also sent next-day buttons — now handled inside `handleHoursRangeStep`. Remove `handleHoursOpenStep` and `handleHoursCloseStep` entirely.

**Also update `handleNameStep`** — after setting business name, it calls `sendTelegramMessage` with `'Είστε ανοιχτά την Κυριακή; (ναι/όχι)'`. Change to `sendTelegramMessageWithKeyboard` with YES_NO_BUTTONS (same pattern as the existing yes/no prompts from the previous quick task).

Wait — looking at `handleNameStep` more carefully: it calls `sendTelegramMessage(ownerTelegramId, 'Είστε ανοιχτά την Κυριακή; (ναι/όχι)')`. This was already migrated to buttons in the previous quick task (260716-heo). Check if it already uses `sendTelegramMessageWithKeyboard` — if so, no change needed here.

### `router.ts` changes

Remove: import `handleHoursOpenStep`, `handleHoursCloseStep`
Add: import `handleHoursRangeStep`

Remove dispatch branches for `hours_\d_open` and `hours_\d_close`.
Add dispatch branch for `hours_\d_range`:
```ts
} else if (/^hours_\d_range$/.test(step)) {
  await handleHoursRangeStep(extractDayIndex(step), session, business, ownerTelegramId, messageText);
```

---

## Task 3: Availability checker split-hours support

**File**: `src/business/availability.ts`

Extract candidate generation into a helper and call it for both ranges:

```ts
function candidatesForRange(openTime: string, closeTime: string, durationMin: number): string[] {
  const openHour = Number(openTime.split(':')[0]);
  const closeHour = Number(closeTime.split(':')[0]);
  const closeMinutes = timeStringToMinutes(closeTime);
  const slots: string[] = [];
  for (let hour = openHour; hour <= closeHour; hour++) {
    if (hour * 60 + durationMin <= closeMinutes) {
      slots.push(`${String(hour).padStart(2, '0')}:00`);
    }
  }
  return slots;
}
```

In `checkAvailability`, replace the existing candidate loop:
```ts
const candidates = [
  ...candidatesForRange(hours.openTime, hours.closeTime, service.durationMin),
  ...(hours.openTime2 && hours.closeTime2
    ? candidatesForRange(hours.openTime2, hours.closeTime2, service.durationMin)
    : []),
];
```

Remove the now-unused `openHour`, `closeHour`, `closeTimeInMinutes` variables.

---

## Commit plan

Two commits:
1. `feat(db): add split-hours columns to business_hours (migration 0005)` — migration + schema + query type
2. `feat(onboarding): single time-range question with split-hours support` — steps + router + availability + tests
