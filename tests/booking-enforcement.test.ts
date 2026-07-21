// covers ENFC-02, ENFC-03
// Integration test stubs — Nyquist Wave 0.
// All tests are it.todo until Wave 2 (billing/enforcement.ts) and
// Wave 3 (function-executor.ts modifications) are implemented.
//
// No DATABASE_URL override needed — these stubs make no DB calls.

describe('booking enforcement policy integration', () => {
  it.todo('ENFC-02: block policy + no membership refuses booking and sends Greek refusal to client');
  it.todo('ENFC-03: flag policy + no membership allows booking and sends Greek alert to owner');
  it.todo('ENFC-02: block policy + active membership allows booking to proceed normally');
});
