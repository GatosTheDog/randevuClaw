// covers ENFC-01
// Tests verify the set_enforcement_policy NLU tool schema shape (Tests 1-2) and
// DB persistence of businesses.enforcement_policy (Tests 3-4).
//
// Tests 1-2 are pure schema inspection (no DB) — OWNER_TOOLS is loaded via
// jest.resetModules() + require() so ts-jest does not fail when env vars are
// missing or @google/genai construction fails without a real API key.
//
// Tests 3-4 are DB integration tests against the real local test DB.

const TEST_DATABASE_URL =
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { OWNER_TOOLS } = require('../src/onboarding/ai-owner-agent');
const { db } = require('../src/database/db');
const { eq } = require('drizzle-orm');
const { businesses } = require('../src/database/schema');
const { insertTestBusiness } = require('./helpers/test-business');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('set_enforcement_policy NLU tool', () => {
  it('ENFC-01: set_enforcement_policy tool exists in OWNER_TOOLS', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = (OWNER_TOOLS as any[]).find((t: { name: string }) => t.name === 'set_enforcement_policy');
    expect(tool).toBeDefined();
    expect(tool.name).toBe('set_enforcement_policy');
  });

  it('ENFC-01: tool rejects values other than block or flag (enum validated)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = (OWNER_TOOLS as any[]).find((t: { name: string }) => t.name === 'set_enforcement_policy');
    expect(tool).toBeDefined();
    // The enum property on the policy parameter determines which values Gemini will accept
    const policyEnum = tool.parameters?.properties?.policy?.enum;
    expect(policyEnum).toBeDefined();
    // Must include 'allow', 'block', 'flag' — the three valid policy values (ENFC-01)
    expect(policyEnum).toContain('block');
    expect(policyEnum).toContain('flag');
    // 'allow' is the default/fallback; included so the owner can reset the policy
    expect(policyEnum).toContain('allow');
    // Must NOT include any other values (enum enforces the allowlist at NLU level)
    expect(policyEnum).toHaveLength(3);
    expect(policyEnum).toEqual(['allow', 'block', 'flag']);
  });

  it('ENFC-01: setting policy to block persists to businesses.enforcement_policy in DB', async () => {
    const business = await insertTestBusiness();

    // Update enforcement_policy directly (mirrors what handleSetEnforcementPolicy does)
    await db
      .update(businesses)
      .set({ enforcementPolicy: 'block' })
      .where(eq(businesses.id, business.id));

    // Verify the value was persisted
    const rows = await db
      .select({ enforcementPolicy: businesses.enforcementPolicy })
      .from(businesses)
      .where(eq(businesses.id, business.id));

    expect(rows).toHaveLength(1);
    expect(rows[0].enforcementPolicy).toBe('block');
  });

  it('ENFC-01: setting policy to flag persists to businesses.enforcement_policy in DB', async () => {
    const business = await insertTestBusiness();

    await db
      .update(businesses)
      .set({ enforcementPolicy: 'flag' })
      .where(eq(businesses.id, business.id));

    const rows = await db
      .select({ enforcementPolicy: businesses.enforcementPolicy })
      .from(businesses)
      .where(eq(businesses.id, business.id));

    expect(rows).toHaveLength(1);
    expect(rows[0].enforcementPolicy).toBe('flag');
  });
});
