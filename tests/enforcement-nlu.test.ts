// covers ENFC-01
// NLU tool stubs — Nyquist Wave 0.
// All tests are it.todo until Wave 4 (set_enforcement_policy added to OWNER_TOOLS) is implemented.
//
// OWNER_TOOLS is imported via jest.resetModules() + require() to avoid ts-jest
// resolving the full import chain of ai-owner-agent.ts (which pulls in @google/genai)
// during the stub-only compilation phase. When Wave 4 implements these tests, replace
// the require() call with: import { OWNER_TOOLS } from '../src/onboarding/ai-owner-agent';

jest.resetModules();

describe('set_enforcement_policy NLU tool', () => {
  it.todo('ENFC-01: set_enforcement_policy tool exists in OWNER_TOOLS');
  it.todo('ENFC-01: tool rejects values other than block or flag');
  it.todo('ENFC-01: setting policy to block persists to businesses.enforcement_policy in DB');
  it.todo('ENFC-01: setting policy to flag persists to businesses.enforcement_policy in DB');
});
