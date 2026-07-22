// covers CLSS-04
// Nyquist stub: owner assigns a specific client directly to a session; that client is
// notified automatically in Greek. Capacity race guard uses SELECT FOR UPDATE to prevent
// concurrent overbooking — exactly one of two concurrent assignments on a full session
// succeeds; the other receives a 'full' conflict status.
// Stubs filled in when src/session/manager.ts bookSessionInstance is built (Wave 1).

describe('direct client assignment to session', () => {
  it.todo('assign_client_to_session inserts booking row with correct sessionInstanceId FK');
  it.todo('assign_client_to_session atomically increments sessionInstances.bookedCount by 1');
  it.todo('capacity race guard: two concurrent assignments on same full session — exactly one succeeds, one returns full');
  it.todo('assign_client_to_session on cancelled session returns conflict status, no booking inserted');
  it.todo('assigned client receives Greek notification via sendTelegramMessage after successful booking');
});
