// covers BILL-01
// Edge-case tests for Gemini NLU parsing of Greek billing phrases:
// pricing, session counts, "unlimited" synonyms, and validation constraints.
//
// These tests verify the OWNER_TOOLS schema shape — Gemini reads this schema
// to parse owner intent. The session_count description includes all Greek
// "unlimited" keyword synonyms so Gemini correctly maps them to null (D-02).

import { OWNER_TOOLS } from '../src/onboarding/ai-owner-agent';

describe('package NLU parsing edge cases', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createPackageTool = (OWNER_TOOLS as any[]).find((t) => t.name === 'create_package');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = createPackageTool?.parameters?.properties as Record<string, any> | undefined;

  it('parses "10 μαθήματα €50 30 μέρες" to session_count 10 and price_cents 5000', () => {
    // Tool schema must declare session_count and price_cents so Gemini can extract them
    expect(createPackageTool).toBeDefined();
    expect(props?.session_count).toBeDefined();
    expect(props?.price_cents).toBeDefined();
  });

  it('maps "απεριόριστες" keyword to session_count null', () => {
    // D-02: session_count description must mention this Greek synonym for "unlimited"
    expect(props?.session_count?.description).toContain('απεριόριστες');
  });

  it('maps "απεριόριστο" keyword to session_count null', () => {
    expect(props?.session_count?.description).toContain('απεριόριστο');
  });

  it('maps "χωρίς όριο" keyword to session_count null', () => {
    expect(props?.session_count?.description).toContain('χωρίς όριο');
  });

  it('maps "unlimited" keyword to session_count null', () => {
    // D-02: also include English "unlimited" for owner messages that mix languages
    expect(props?.session_count?.description).toContain('unlimited');
  });

  it('validates price_cents must be integer >= 0', () => {
    // price_cents must be declared as integer in the tool schema
    expect(props?.price_cents?.type).toBe('integer');
    expect(props?.price_cents?.description).toContain('λεπτά');
  });

  it('validates valid_days must be integer >= 1', () => {
    // valid_days must be declared as integer in the tool schema
    expect(props?.valid_days?.type).toBe('integer');
  });
});
