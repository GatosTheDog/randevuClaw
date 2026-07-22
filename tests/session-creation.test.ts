// covers CLSS-01
// Nyquist stub: owner creates a bookable session (date, time, capacity, service) via chat.
// Implementation contract: createSessionCatalogWithExpansion atomically inserts catalog
// row and session instance rows in a single Drizzle transaction, returning catalogId and
// instanceCount. Stubs filled in when src/session/manager.ts is built (Wave 1).

describe('session catalog creation', () => {
  it.todo('creates single session via chat: owner tool inserts catalog row and instance row atomically');
  it.todo('session creation returns catalogId and instanceCount in result object');
  it.todo('create_session with duplicate rrule on same business+service replaces existing via onConflictDoUpdate');
  it.todo('TypeScript interface: createSessionCatalogWithExpansion accepts businessId, serviceId, rruleString, startTime, capacity');
});
