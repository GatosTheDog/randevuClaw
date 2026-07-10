import { Telegraf } from 'telegraf';
import { logger } from '../utils/logger';

// Map key is webhookId (UUID, not bot token — D-04)
type BotRegistry = Map<string, Telegraf>;
const botRegistry: BotRegistry = new Map();

/**
 * Retrieve or create a Telegraf instance for a given webhookId.
 * Logs only the webhookId UUID — never the bot token (STATE.md blocker: T-04-04).
 * In production, called once per registered bot at startup/registration time.
 * In tests, called on-demand via seeded fixture data.
 */
export function getOrCreateBotInstance(webhookId: string, botToken: string): Telegraf {
  if (botRegistry.has(webhookId)) {
    return botRegistry.get(webhookId)!;
  }
  logger.info({ webhookId }, 'Registering new Telegraf instance');
  const bot = new Telegraf(botToken);
  // Do NOT call bot.launch() in webhook mode — the webhook handler calls .handleUpdate()
  // per D-03: one Telegraf instance per registered bot, webhook-adapter pattern only.
  botRegistry.set(webhookId, bot);
  return bot;
}

/**
 * Read-only lookup of an existing Telegraf instance by webhookId.
 * Returns undefined if no instance has been registered yet.
 */
export function getBotInstance(webhookId: string): Telegraf | undefined {
  return botRegistry.get(webhookId);
}

/**
 * Empty the registry Map — used in test teardown (beforeEach/afterEach)
 * to reset state between tests and prevent cross-test contamination (T-04-05).
 */
export function clearBotRegistry(): void {
  botRegistry.clear();
}
