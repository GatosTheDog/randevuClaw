// Real-DB integration tests for the unified conversation memory
// (debug: bot-loses-conversation-memory): migration 0014, the queries, the
// savepoint wrapper (runIsolated) and the beginTurn/finishTurn round trip.
//
// Mirrors tests/client-delete-queries.test.ts: point DATABASE_URL at the local
// randevuclaw_test Postgres DB, jest.resetModules(), require() fresh modules.
// The migration file itself is applied in beforeAll (it is idempotent), so this
// test also proves the SQL is valid and re-runnable.
//
// NEVER run bare `npm test`. Use:
//   npm test -- --testPathPattern="conversation-memory-db" --testTimeout=20000

import fs from 'fs';
import path from 'path';

const TEST_DATABASE_URL =
  process.env.CONVERSATION_MEMORY_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db, pool, appPool } = require('../src/database/db');
const schema = require('../src/database/schema');
const queries = require('../src/database/queries');
const memory = require('../src/conversation/memory');
const { insertTestBusiness } = require('./helpers/test-business');
/* eslint-enable @typescript-eslint/no-var-requires */

const { eq, and } = require('drizzle-orm');

const RUN_ID = `conv-mem-${Date.now()}`;
const businessIds: number[] = [];

beforeAll(async () => {
  const sqlText = fs.readFileSync(path.resolve(__dirname, '../migrations/0014_conversation_memory.sql'), 'utf8');
  await pool.query(sqlText);
  // Applying it a second time must be a no-op, not an error.
  await pool.query(sqlText);
});

afterAll(async () => {
  for (const businessId of businessIds) {
    await db.delete(schema.conversationMemory).where(eq(schema.conversationMemory.businessId, businessId));
    await db.delete(schema.conversationTurns).where(eq(schema.conversationTurns.businessId, businessId));
    await db.delete(schema.clientBusinessRelationships).where(eq(schema.clientBusinessRelationships.businessId, businessId));
    await db.delete(schema.services).where(eq(schema.services.businessId, businessId));
    await db.delete(schema.businessHours).where(eq(schema.businessHours.businessId, businessId));
    await db.delete(schema.businesses).where(eq(schema.businesses.id, businessId));
  }
  await pool.end();
  await appPool.end();
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

async function newBusiness(label: string): Promise<{ id: number }> {
  const business = await insertTestBusiness({ name: `ConvMem ${label}`, slug: `${RUN_ID}-${label}` });
  businessIds.push(business.id);
  return business;
}

const NO_LLM = {
  summarize: async ({ exchanges }: { exchanges: Array<{ u: string }> }) => `SUMMARY(${exchanges.map((e) => e.u).join('|')})`,
  now: () => new Date(),
};

describe('conversation_memory queries', () => {
  it('upserts one row per (business, role, participant) and keeps roles separate', async () => {
    const biz = await newBusiness('upsert');
    const values = {
      interactionId: 'int-1',
      summary: null,
      contextTokens: 100,
      chainTurns: 1,
      recentExchanges: '[]',
      lastActiveAt: new Date(),
    };

    await queries.upsertConversationMemory(biz.id, 'owner', 'tg-1', values);
    await queries.upsertConversationMemory(biz.id, 'owner', 'tg-1', { ...values, interactionId: 'int-2', chainTurns: 2 });
    await queries.upsertConversationMemory(biz.id, 'client', 'tg-1', { ...values, interactionId: 'client-int' });

    const owner = await queries.findConversationMemory(biz.id, 'owner', 'tg-1');
    const client = await queries.findConversationMemory(biz.id, 'client', 'tg-1');
    const missing = await queries.findConversationMemory(biz.id, 'onboarding', 'tg-1');

    expect(owner.interactionId).toBe('int-2');
    expect(owner.chainTurns).toBe(2);
    expect(client.interactionId).toBe('client-int');
    expect(missing).toBeNull();

    const rows = await db
      .select()
      .from(schema.conversationMemory)
      .where(and(eq(schema.conversationMemory.businessId, biz.id), eq(schema.conversationMemory.participantId, 'tg-1')));
    expect(rows).toHaveLength(2);
  });

  it('runIsolated inside withBusinessContext: a failing statement does not abort the surrounding transaction', async () => {
    const biz = await newBusiness('savepoint');

    await queries.withBusinessContext(biz.id, async () => {
      await expect(
        queries.runIsolated(async (conn: typeof db) => {
          // Table does not exist -> Postgres error -> would normally abort the txn.
          await conn.execute(require('drizzle-orm').sql`select * from table_that_does_not_exist_xyz`);
        })
      ).rejects.toBeDefined();

      // The outer transaction must still be usable (no "current transaction is aborted").
      await queries.upsertConversationMemory(biz.id, 'client', 'tg-sp', {
        interactionId: 'after-failure',
        summary: null,
        contextTokens: 0,
        chainTurns: 0,
        recentExchanges: null,
        lastActiveAt: new Date(),
      });
    });

    const row = await queries.findConversationMemory(biz.id, 'client', 'tg-sp');
    expect(row.interactionId).toBe('after-failure');
  });
});

describe('beginTurn / finishTurn round trip (real DB)', () => {
  it('turn 2 resumes the chain recorded by turn 1 (the "yes" after a suggestion keeps its context)', async () => {
    const biz = await newBusiness('roundtrip');
    const key = { businessId: biz.id, role: 'owner', participantId: 'owner-1' };

    const turn1 = await memory.beginTurn(key, {}, NO_LLM);
    expect(turn1.enabled).toBe(true);
    expect(turn1.previousInteractionId).toBeUndefined();
    expect(turn1.seed).toBeNull();

    await memory.finishTurn(
      turn1,
      { userText: 'βάλε Pilates 20 ευρώ', botText: 'Να προσθέσω την υπηρεσία Pilates στα 20€;', interactionId: 'chain-A', contextTokens: 900 },
      NO_LLM
    );

    const turn2 = await memory.beginTurn(key, {}, NO_LLM);
    expect(turn2.previousInteractionId).toBe('chain-A');
    expect(turn2.seed).toBeNull();
    expect(turn2.state.recent).toHaveLength(1);
    expect(turn2.state.chainTurns).toBe(1);

    // The idle-reset policy compares lastActiveAt with "now": make sure the
    // timestamp survives the (timezone-less) column round trip without skew.
    const skewMs = Math.abs(Date.now() - turn2.state.lastActiveAt.getTime());
    expect(skewMs).toBeLessThan(60_000);
  });

  it('exceeding the token budget retires the chain: next turn is fresh, folded into a summary, last exchanges replayed', async () => {
    const biz = await newBusiness('budget');
    const key = { businessId: biz.id, role: 'client', participantId: 'client-1' };

    // Six exchanges; the last one reports a prompt larger than the client budget.
    let turn = await memory.beginTurn(key, {}, NO_LLM);
    for (let i = 1; i <= 6; i++) {
      await memory.finishTurn(
        turn,
        {
          userText: `m${i}`,
          botText: `r${i}`,
          interactionId: `chain-${i}`,
          contextTokens: i === 6 ? memory.CONTEXT_TOKEN_BUDGET.client + 1 : 1000 * i,
        },
        NO_LLM
      );
      if (i < 6) turn = await memory.beginTurn(key, {}, NO_LLM);
    }

    const fresh = await memory.beginTurn(key, {}, NO_LLM);
    expect(fresh.startedFreshChain).toBe(true);
    expect(fresh.freshChainReason).toBe('token_budget');
    expect(fresh.previousInteractionId).toBeUndefined();
    // 6 exchanges, 4 replayed verbatim, the 2 oldest folded into the summary.
    expect(fresh.state.summary).toBe('SUMMARY(m1|m2)');
    expect(fresh.state.recent.map((e: { u: string }) => e.u)).toEqual(['m3', 'm4', 'm5', 'm6']);
    expect(fresh.seed).toContain('SUMMARY(m1|m2)');
    expect(fresh.seed).toContain('Χρήστης: m6');
    expect(fresh.seed).toContain('Βοηθός: r6');

    // The retirement was persisted: a second begin (e.g. after a failed turn) is stable.
    const again = await memory.beginTurn(key, {}, NO_LLM);
    expect(again.state.summary).toBe('SUMMARY(m1|m2)');
    expect(again.previousInteractionId).toBeUndefined();
    expect(again.seed).toContain('Χρήστης: m3');
  });

  it('the legacy conversation_turns chain id is honoured only until the first memory row exists', async () => {
    const biz = await newBusiness('legacy');
    const key = { businessId: biz.id, role: 'client', participantId: 'client-legacy' };

    const first = await memory.beginTurn(key, { legacyInteractionId: 'legacy-chain' }, NO_LLM);
    expect(first.previousInteractionId).toBe('legacy-chain');

    await memory.finishTurn(first, { userText: 'a', botText: 'b', interactionId: 'new-chain', contextTokens: 500 }, NO_LLM);

    const second = await memory.beginTurn(key, { legacyInteractionId: 'legacy-chain' }, NO_LLM);
    expect(second.previousInteractionId).toBe('new-chain');
  });
});

describe('GDPR erase', () => {
  it('deleteClientBookingData also erases the client conversation memory (owner-role memory untouched)', async () => {
    const biz = await newBusiness('erase');
    const values = {
      interactionId: 'x',
      summary: 'personal summary',
      contextTokens: 1,
      chainTurns: 1,
      recentExchanges: '[{"u":"hi","a":"hello","at":""}]',
      lastActiveAt: new Date(),
    };
    await queries.upsertConversationMemory(biz.id, 'client', 'erase-me', values);
    await queries.upsertConversationMemory(biz.id, 'owner', 'erase-me', values);

    await queries.withBusinessContext(biz.id, async () => {
      await queries.deleteClientBookingData(biz.id, 'erase-me');
    });

    expect(await queries.findConversationMemory(biz.id, 'client', 'erase-me')).toBeNull();
    expect(await queries.findConversationMemory(biz.id, 'owner', 'erase-me')).not.toBeNull();
  });
});
