# Phase 29: Booking & List Clarity - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 6 modified files
**Analogs found:** 6 / 6 (100% match)

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/session/manager.ts` | service | CRUD | `src/session/manager.ts:498-529` (listSessions) | exact-self |
| `src/utils/timezone.ts` | utility | transform | `src/utils/timezone.ts:1-46` (existing helpers) | exact-self |
| `src/telegram/handlers/client-menu.ts` | handler/controller | request-response | `src/telegram/handlers/client-menu.ts:129-161` (showBookSessionList) | exact-self |
| `src/telegram/handlers/admin-menu.ts` | handler/controller | request-response | `src/telegram/handlers/admin-menu.ts:227-254` (showTodaysAgenda) | exact-self |
| `src/webhooks/telegram.ts` | handler/controller | request-response | `src/webhooks/telegram.ts:363-476` (parseCallbackData) | exact-self |
| `src/utils/greek-messages.ts` | config | transform | `src/utils/greek-messages.ts:1-31` (existing labels) | exact-self |

## Pattern Assignments

### `src/session/manager.ts` (service, CRUD)

**Analog:** `src/session/manager.ts:498-529`

**Existing listSessions signature** (lines 498-501):
```typescript
export async function listSessions(
  businessId: number,
  limitDays = 90
): Promise<SessionInstance[]> {
```

**D-01: Add optional excludePastToday parameter** — keep default `false` (lines 498-501 modified to):
```typescript
export async function listSessions(
  businessId: number,
  limitDays = 90,
  excludePastToday = false  // D-01: new optional param, default false
): Promise<SessionInstance[]> {
```

**Drizzle SELECT pattern** (lines 505-526):
```typescript
const rows = await getConn()
  .select({
    instanceId: sessionInstances.id,
    catalogId: sessionInstances.catalogId,
    sessionDate: sessionInstances.sessionDate,
    sessionTime: sessionInstances.sessionTime,
    bookedCount: sessionInstances.bookedCount,
    capacity: sessionCatalog.capacity,
    serviceId: sessionCatalog.serviceId,
  })
  .from(sessionInstances)
  .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
  .where(
    and(
      eq(sessionCatalog.businessId, businessId),
      eq(sessionInstances.isCancelled, false),
      gte(sessionInstances.sessionDate, today),
      sql`${sessionInstances.sessionDate} <= ${endDate}`
    )
  )
  .orderBy(sessionInstances.sessionDate, sessionInstances.sessionTime)
  .limit(200);
```

**D-06: New findSessionInstanceById helper** — same SELECT shape as listSessions (to be added after listSessions):
```typescript
export async function findSessionInstanceById(
  businessId: number,
  instanceId: number
): Promise<SessionInstance | null> {
  const rows = await getConn()
    .select({
      instanceId: sessionInstances.id,
      catalogId: sessionInstances.catalogId,
      sessionDate: sessionInstances.sessionDate,
      sessionTime: sessionInstances.sessionTime,
      bookedCount: sessionInstances.bookedCount,
      capacity: sessionCatalog.capacity,
      serviceId: sessionCatalog.serviceId,
    })
    .from(sessionInstances)
    .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
    .where(
      and(
        eq(sessionCatalog.businessId, businessId),
        eq(sessionInstances.id, instanceId),
        eq(sessionInstances.isCancelled, false)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}
```

---

### `src/utils/timezone.ts` (utility, transform)

**Analog:** `src/utils/timezone.ts:1-46`

**Existing DST-safe pattern** (lines 8-15 as model):
```typescript
export function isoDateInAthens(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
```

**D-02: New hoursUntilSession helper** (to be added to end of file):
```typescript
/**
 * Computes hours remaining until a session start time (Europe/Athens).
 * Negative if session has already started.
 * Replaces inline copies from client-menu.ts:103-119 and function-executor.ts.
 * Used by D-01's listSessions() same-day filtering and client-menu initial checks.
 */
export function hoursUntilSession(sessionDate: string, sessionTime: string): number {
  const noonUTC = new Date(`${sessionDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(noonUTC);
  const athensHour = Number.parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const offsetHours = athensHour - 12;
  const [hh, mm] = sessionTime.split(':').map(Number);
  const sessionUTCMs =
    Date.parse(
      `${sessionDate}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`
    ) -
    offsetHours * 3_600_000;
  return (sessionUTCMs - Date.now()) / 3_600_000;
}
```

---

### `src/telegram/handlers/client-menu.ts` (handler/controller, request-response)

**Analog:** `src/telegram/handlers/client-menu.ts:65-95` (showClientRootMenu)

**D-03: Relabel root-menu button for non-fixed_sessions** (lines 65-95 modified):
Current unconditional button (line 78):
```typescript
{ text: 'Κράτηση μαθήματος', callback_data: callbackDataBook },
```

Replace with conditional logic that checks `business.bookingMode`:
```typescript
// D-03: relabel booking button for non-fixed_sessions mode
const bookingButtonText = business.bookingMode === 'fixed_sessions'
  ? 'Κράτηση μαθήματος'
  : 'Ζητήστε μάθημα'; // Claude's discretion on exact wording
const keyboard: InlineKeyboard = [
  [
    { text: bookingButtonText, callback_data: callbackDataBook },
    { text: 'Οι κρατήσεις μου', callback_data: callbackDataBookings },
  ],
  // ... rest of keyboard
];
```

**D-04: Add back-button to open-slot redirect** — match pattern from sibling no-availability branch (lines 141-149):
Current pattern (lines 129-136) — change from:
```typescript
if (business.bookingMode !== 'fixed_sessions') {
  await sendTelegramMessage(
    chatId,
    'Για κράτηση μαθήματος, γράψε μου στο chat τι θέλεις να κλείσεις.'
  );
  return;
}
```

To add back-button keyboard like the sibling branch (lines 142-149):
```typescript
if (business.bookingMode !== 'fixed_sessions') {
  const keyboard: InlineKeyboard = [
    [{ text: '« Πίσω', callback_data: 'cmenu:root' }],
  ];
  await sendTelegramMessageWithKeyboard(
    chatId,
    'Για κράτηση μαθήματος, γράψε μου στο chat τι θέλεις να κλείσεις.',
    keyboard
  );
  return;
}
```

**D-10: Add service names to showBookSessionList** (lines 153-157) — copy the `Map<number,string>` dedup pattern from `formatAgendaMessage`:
Current pattern (lines 153-157):
```typescript
const rows: InlineKeyboard = available.map((s) => {
  const callbackData = `cmenu:book:confirm:${s.instanceId}`;
  assertCallbackDataSize(callbackData);
  return [{ text: `${s.sessionDate} ${s.sessionTime}`, callback_data: callbackData }];
});
```

Replace with service-name enrichment (dedup pattern from `src/scheduler/agenda.ts:86-92`):
```typescript
// D-10: batch-fetch service names to avoid N+1 queries
const serviceIds = [...new Set(available.map(s => s.serviceId))];
const serviceNamesById = new Map<number, string>();
for (const serviceId of serviceIds) {
  const service = await findServiceById(business.id, serviceId);
  if (service) serviceNamesById.set(serviceId, service.name);
}

const rows: InlineKeyboard = available.map((s) => {
  const serviceName = serviceNamesById.get(s.serviceId) ?? '(άγνωστη υπηρεσία)';
  const callbackData = `cmenu:book:confirm:${s.instanceId}`;
  assertCallbackDataSize(callbackData);
  return [{ text: `${serviceName} - ${s.sessionDate} ${s.sessionTime}`, callback_data: callbackData }];
});
```

**D-10: Add service names to showClientBookings** (lines 316):
Current pattern (line 316):
```typescript
const lines = clientBookings.map((b) => `${b.calendarDate} ${b.calendarTime}`);
```

Replace with service-name enrichment:
```typescript
const serviceIds = [...new Set(clientBookings.map(b => b.serviceId))];
const serviceNamesById = new Map<number, string>();
for (const serviceId of serviceIds) {
  const service = await findServiceById(business.id, serviceId);
  if (service) serviceNamesById.set(serviceId, service.name);
}
const lines = clientBookings.map((b) => {
  const serviceName = serviceNamesById.get(b.serviceId) ?? '(άγνωστη υπηρεσία)';
  return `${serviceName} - ${b.calendarDate} ${b.calendarTime}`;
});
```

**D-10: Add service names to showCancelBookingList** (lines 356-360):
Current pattern (lines 356-360):
```typescript
const rows: InlineKeyboard = capped.map((b) => {
  const callbackData = `cmenu:cancel:confirm:${b.id}`;
  assertCallbackDataSize(callbackData);
  return [{ text: `${b.calendarDate} ${b.calendarTime}`, callback_data: callbackData }];
});
```

Replace with service-name enrichment:
```typescript
const serviceIds = [...new Set(capped.map(b => b.serviceId))];
const serviceNamesById = new Map<number, string>();
for (const serviceId of serviceIds) {
  const service = await findServiceById(business.id, serviceId);
  if (service) serviceNamesById.set(serviceId, service.name);
}

const rows: InlineKeyboard = capped.map((b) => {
  const serviceName = serviceNamesById.get(b.serviceId) ?? '(άγνωστη υπηρεσία)';
  const callbackData = `cmenu:cancel:confirm:${b.id}`;
  assertCallbackDataSize(callbackData);
  return [{ text: `${serviceName} - ${b.calendarDate} ${b.calendarTime}`, callback_data: callbackData }];
});
```

**D-09: Enrich showCancelConfirm with date and service name** (lines 369-383):
Current pattern (line 382):
```typescript
await sendTelegramMessageWithKeyboard(chatId, 'Να ακυρωθεί αυτή η κράτηση;', keyboard);
```

Replace with enriched context:
```typescript
export async function showCancelConfirm(
  chatId: string,
  business: Business,  // D-09: add business param
  bookingId: number
): Promise<void> {
  const booking = await findBookingByIdUnscoped(bookingId);
  if (!booking) {
    await sendTelegramMessage(chatId, 'Κράτηση δεν βρέθηκε.');
    return;
  }

  const service = await findServiceById(business.id, booking.serviceId);
  const serviceName = service?.name ?? '(άγνωστη υπηρεσία)';

  const yesData = `cmenu:cancel:yes:${bookingId}`;
  const noData = 'cmenu:root';
  assertCallbackDataSize(yesData);
  assertCallbackDataSize(noData);

  const keyboard: InlineKeyboard = [
    [
      { text: 'Ναι', callback_data: yesData },
      { text: 'Όχι', callback_data: noData },
    ],
  ];

  const promptText = `Να ακυρωθεί η κράτηση:\n${serviceName}\n${booking.calendarDate} ${booking.calendarTime}?`;
  await sendTelegramMessageWithKeyboard(chatId, promptText, keyboard);
}
```

**D-05.2: Fix handleCancelExecute early-returns with back-menu keyboard** — match admin's already-correct pattern (lines 390-419 modified):

Current early-return guards:
```typescript
if (!booking) {
  await sendTelegramMessage(chatId, 'Κράτηση δεν βρέθηκε.');
  return;
}

if (booking.clientPhone !== senderTelegramId) {
  logger.warn(...);
  await sendTelegramMessage(chatId, 'Δεν έχετε δικαίωμα ακύρωσης αυτής της κράτησης.');
  return;
}

if (booking.bookingStatus !== 'pending_owner_approval' && booking.bookingStatus !== 'confirmed') {
  await sendTelegramMessage(chatId, 'Αυτή η κράτηση δεν μπορεί να ακυρωθεί.');
  return;
}
```

Replace each with back-menu keyboard (matching admin's pattern at lines 355-374):
```typescript
const backKeyboard: InlineKeyboard = [
  [{ text: BACK_MENU_LABEL_CLIENT, callback_data: 'cmenu:root' }],  // from D-07 constants
];

if (!booking) {
  const keyboard: InlineKeyboard = [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]];
  await sendTelegramMessageWithKeyboard(chatId, 'Κράτηση δεν βρέθηκε.', keyboard);
  return;
}

if (booking.clientPhone !== senderTelegramId) {
  logger.warn(...);
  const keyboard: InlineKeyboard = [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]];
  await sendTelegramMessageWithKeyboard(chatId, 'Δεν έχετε δικαίωμα ακύρωσης αυτής της κράτησης.', keyboard);
  return;
}

if (booking.bookingStatus !== 'pending_owner_approval' && booking.bookingStatus !== 'confirmed') {
  const keyboard: InlineKeyboard = [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]];
  await sendTelegramMessageWithKeyboard(chatId, 'Αυτή η κράτηση δεν μπορεί να ακυρωθεί.', keyboard);
  return;
}
```

**D-05.1: Fix default case in menu handler** (lines 581-583):
Current pattern (lines 581-583 of client-menu.ts, similar structure as admin):
```typescript
default:
  await sendTelegramMessage(chatId, 'Άγνωστη ενέργεια...');
  return;
```

Replace with back-menu keyboard:
```typescript
default:
  const keyboard: InlineKeyboard = [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]];
  await sendTelegramMessageWithKeyboard(chatId, 'Άγνωστη ενέργεια...', keyboard);
  return;
```

**Required import** (add to client-menu.ts if not present):
```typescript
import { findServiceById } from '../../database/queries';
```

---

### `src/telegram/handlers/admin-menu.ts` (handler/controller, request-response)

**Analog:** `src/telegram/handlers/admin-menu.ts:227-254` (showTodaysAgenda)

**D-10: Add service names to showClassesMenu** (lines 290-292):
Current pattern (lines 290-292):
```typescript
const lines = sessions.map(
  (s) => `${s.sessionDate} ${s.sessionTime} — ${s.bookedCount}/${s.capacity} θέσεις`
);
```

Replace with service-name enrichment (copy dedup pattern from lines 234-240 in showTodaysAgenda):
```typescript
const serviceIds = [...new Set(sessions.map(s => s.serviceId))];
const serviceNamesById = new Map<number, string>();
for (const serviceId of serviceIds) {
  const service = await findServiceById(business.id, serviceId);
  if (service) serviceNamesById.set(serviceId, service.name);
}

const lines = sessions.map((s) => {
  const serviceName = serviceNamesById.get(s.serviceId) ?? '(άγνωστη υπηρεσία)';
  return `${serviceName} - ${s.sessionDate} ${s.sessionTime} — ${s.bookedCount}/${s.capacity} θέσεις`;
});
```

**D-10: Add service names to showCancelClassList** (lines 324-328):
Current pattern (lines 324-327):
```typescript
const keyboard: InlineKeyboard = capped.map((s) => {
  const cbData = `menu:classes:cancel_confirm_req:${s.instanceId}`;
  assertCallbackDataSize(cbData);
  return [{ text: `${s.sessionDate} ${s.sessionTime}`, callback_data: cbData }];
});
```

Replace with service-name enrichment:
```typescript
const serviceIds = [...new Set(capped.map(s => s.serviceId))];
const serviceNamesById = new Map<number, string>();
for (const serviceId of serviceIds) {
  const service = await findServiceById(business.id, serviceId);
  if (service) serviceNamesById.set(serviceId, service.name);
}

const keyboard: InlineKeyboard = capped.map((s) => {
  const serviceName = serviceNamesById.get(s.serviceId) ?? '(άγνωστη υπηρεσία)';
  const cbData = `menu:classes:cancel_confirm_req:${s.instanceId}`;
  assertCallbackDataSize(cbData);
  return [{ text: `${serviceName} - ${s.sessionDate} ${s.sessionTime}`, callback_data: cbData }];
});
```

**D-08: Enrich showCancelClassConfirm with date and service name** (lines 339-353):
Current pattern (lines 347):
```typescript
`Να ακυρωθεί το μάθημα #${instanceId};`
```

Replace with enriched context:
```typescript
export async function showCancelClassConfirm(
  chatId: string,
  business: Business,  // D-08: add business param (caller already has it in scope)
  instanceId: number
): Promise<void> {
  const session = await findSessionInstanceById(business.id, instanceId);
  if (!session) {
    await sendTelegramMessage(chatId, 'Το μάθημα δεν βρέθηκε.');
    return;
  }

  const service = await findServiceById(business.id, session.serviceId);
  const serviceName = service?.name ?? '(άγνωστη υπηρεσία)';

  const cancelConfirmData = `menu:classes:cancel_yes:${instanceId}`;
  const cancelAbortData = `menu:classes:cancel_no:${instanceId}`;
  assertCallbackDataSize(cancelConfirmData);
  assertCallbackDataSize(cancelAbortData);

  const promptText = `Να ακυρωθεί το μάθημα:\n${serviceName}\n${session.sessionDate} ${session.sessionTime}?`;

  await sendTelegramMessageWithKeyboard(
    chatId,
    promptText,
    [[
      { text: 'Ναι', callback_data: cancelConfirmData },
      { text: 'Όχι', callback_data: cancelAbortData },
    ]]
  );
}
```

**D-05.1: Fix default case in menu handler** (lines 667-669):
Current pattern:
```typescript
default:
  await sendTelegramMessage(chatId, 'Άγνωστη ενέργεια...');
  return;
```

Replace with back-menu keyboard (matching client pattern after D-05 fix):
```typescript
default:
  const keyboard: InlineKeyboard = [[{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]];
  await sendTelegramMessageWithKeyboard(chatId, 'Άγνωστη ενέργεια...', keyboard);
  return;
```

**Required import** (add to admin-menu.ts if not present):
```typescript
import { findSessionInstanceById } from '../../session/manager';
```

---

### `src/webhooks/telegram.ts` (handler/controller, request-response)

**Analog:** `src/webhooks/telegram.ts:363-476` (parseCallbackData)

**D-05.3 Layer 1: Fix parseCallbackData null-path** (lines 558-561):
Current pattern in handleCallbackQuery:
```typescript
if (!parsed) {
  logger.warn({ data: callbackQuery.data }, 'Malformed callback_query data, ignoring');
  return;
}
```

Replace with back-menu recovery message:
```typescript
if (!parsed) {
  logger.warn({ data: callbackQuery.data }, 'Malformed callback_query data');
  // D-05 Layer 1: send back-menu recovery instead of silent drop
  const backMenuLabel = BACK_MENU_LABEL_ADMIN; // from D-07 constants
  const keyboard: InlineKeyboard = [[{ text: backMenuLabel, callback_data: 'menu:root' }]];
  await sendTelegramMessageWithKeyboard(
    senderTelegramId,
    'Η ενέργεια δεν αναγνωρίστηκε. Επέστρεψε στο μενού.',
    keyboard
  );
  return;
}
```

**D-05.3 Layer 1 (legacy): Fix approve_/reject_ unknown-booking path** (telegram.ts current lines ~1031-1035, escalation branch):
Look for the pattern where `instanceRow[0]?.serviceId` is undefined (lines 615-617 currently):
```typescript
if (serviceId === undefined) {
  await sendTelegramMessage(senderTelegramId, 'Το μάθημα δεν βρέθηκε.');
  return;
}
```

Already has a message, but should also add back-menu keyboard for consistency:
```typescript
if (serviceId === undefined) {
  const keyboard: InlineKeyboard = [[{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]];
  await sendTelegramMessageWithKeyboard(senderTelegramId, 'Το μάθημα δεν βρέθηκε.', keyboard);
  return;
}
```

**Required imports** (add to telegram.ts if not present):
```typescript
import { InlineKeyboard, sendTelegramMessageWithKeyboard } from '../telegram/client';
```

---

### `src/utils/greek-messages.ts` (config, transform)

**Analog:** `src/utils/greek-messages.ts:1-31` (existing CONFIRM_LABELS and CONSENT_LABELS)

**D-07: Add shared back-menu button constants** (append to end of file):
```typescript
// Phase 29 (D-07): shared back-menu button labels for callback recovery (UX-06)
// and callback silence fixes. Consolidates 11+ inline repeats of admin's
// '« Πίσω στο Μενού' and client's inconsistent '« Πίσω' / '« Αρχικό μενού'.
// Follows the Phase 26 precedent of "button-label strings only" — no callback
// routing changes or confirmation keyboard helpers.
export const BACK_MENU_LABELS = {
  ADMIN: '« Πίσω στο Μενού',      // admin menu back button (from existing admin-menu.ts:162, 308, etc.)
  CLIENT: '« Πίσω',                // client menu back button (consolidates client-menu.ts:143, 304 etc.)
} as const;

// Convenience exports for direct import
export const BACK_MENU_LABEL_ADMIN = BACK_MENU_LABELS.ADMIN;
export const BACK_MENU_LABEL_CLIENT = BACK_MENU_LABELS.CLIENT;
```

---

## Shared Patterns

### Client/Admin Menu Handler Structure
**Source:** `src/telegram/handlers/client-menu.ts:65-95`, `src/telegram/handlers/admin-menu.ts:48-81`
**Apply to:** All menu rendering and callback routing in client-menu.ts and admin-menu.ts

Pattern structure:
```typescript
export async function showMenuName(chatId: string, business: Business): Promise<void> {
  // 1. Fetch data (queries)
  const items = await listSessions(business.id, limit);
  
  // 2. Optional: enrich with related data (service names, etc.)
  const enrichedMap = new Map<number, string>();
  // ... populate map via batched lookups
  
  // 3. Build keyboard with callback_data assertions
  const keyboard: InlineKeyboard = items.map(item => {
    const callbackData = `menu:action:${item.id}`;
    assertCallbackDataSize(callbackData);
    return [{ text: label, callback_data: callbackData }];
  });
  
  // 4. Add back-button
  keyboard.push([{ text: BACK_MENU_LABEL, callback_data: 'menu:root' }]);
  
  // 5. Send message with keyboard
  await sendTelegramMessageWithKeyboard(chatId, messageText, keyboard);
}
```

### Service Name Batching (D-10)
**Source:** `src/scheduler/agenda.ts:86-92`, `src/telegram/handlers/admin-menu.ts:234-240`
**Apply to:** All list renderings that display service names

Pattern:
```typescript
// Batch-fetch all unique service IDs at once
const serviceIds = [...new Set(items.map(i => i.serviceId))];
const serviceNamesById = new Map<number, string>();

for (const serviceId of serviceIds) {
  const service = await findServiceById(businessId, serviceId);
  if (service) {
    serviceNamesById.set(serviceId, service.name);
  }
}

// Then use the map in rendering (never call findServiceById in a loop)
items.forEach(item => {
  const serviceName = serviceNamesById.get(item.serviceId) ?? '(άγνωστη υπηρεσία)';
  // render...
});
```

### Back-Menu Keyboard Recovery Pattern (D-05)
**Source:** `src/telegram/handlers/admin-menu.ts:250-253`, `src/telegram/handlers/client-menu.ts:475-478`
**Apply to:** All early-return and error paths

Pattern (match admin's already-correct structure at admin-menu.ts:355-374):
```typescript
// Confirmation success path
await sendTelegramMessage(chatId, 'Action completed.');
const backKeyboard: InlineKeyboard = [
  [{ text: BACK_MENU_LABEL, callback_data: 'menu:root' }],
];
await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);

// Error path (early-return case)
const keyboard: InlineKeyboard = [[{ text: BACK_MENU_LABEL, callback_data: 'menu:root' }]];
await sendTelegramMessageWithKeyboard(chatId, 'Error message text.', keyboard);
return;
```

### Drizzle Inner Join Pattern for Session Lookups
**Source:** `src/session/manager.ts:505-526`, `src/webhooks/telegram.ts:607-612`
**Apply to:** All session instance lookups with catalog info needed

Pattern (used by both D-06's findSessionInstanceById and existing code):
```typescript
const rows = await getConn()
  .select({
    instanceId: sessionInstances.id,
    catalogId: sessionInstances.catalogId,
    sessionDate: sessionInstances.sessionDate,
    sessionTime: sessionInstances.sessionTime,
    bookedCount: sessionInstances.bookedCount,
    capacity: sessionCatalog.capacity,
    serviceId: sessionCatalog.serviceId,
  })
  .from(sessionInstances)
  .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
  .where(
    and(
      eq(sessionCatalog.businessId, businessId),
      eq(sessionInstances.isCancelled, false),
      // ... additional where conditions
    )
  )
  .limit(1);

return rows[0] ?? null;
```

### Callback Parsing Union Return Type
**Source:** `src/webhooks/telegram.ts:315-361`, lines 363-476 (parseCallbackData)

Pattern (for D-05's null-check enhancement):
```typescript
export function parseCallbackData(
  data: string | undefined
): BookingCallbackResult | BillingCallbackResult | ... | null {
  // ... multiple .match() checks in order, returning immediately on match
  
  // Each pattern has its own regex test and return shape:
  const menuMatch = data?.match(/^menu:([\w:]+?)(?::(\d+))?$/);
  if (menuMatch) {
    return {
      menuAction: menuMatch[1],
      id: menuMatch[2] ? Number(menuMatch[2]) : undefined,
    };
  }
  
  // ... more patterns ...
  
  return null;  // D-05: this null path now sends a recovery keyboard
}
```

## No Analog Found

All 6 files are modifications to existing files with established patterns.

## Metadata

**Analog search scope:** Entire codebase (src/**/*.ts)
**Files scanned:** 42 TypeScript files
**Pattern extraction date:** 2026-07-28
**Confidence level:** HIGH — All patterns are self-referential (best analogs are the existing functions being modified) or closely matched (D-10's service-name batching copies formatAgendaMessage exactly).

---

*Phase: 29-booking-list-clarity*
*Pattern mapping completed: 2026-07-28*
