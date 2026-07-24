import crypto from 'crypto';
import { config } from '../src/config';
import { createBusinessForOnboarding } from '../src/onboarding/queries';
import { registerBotWebhook, unregisterBotWebhook } from '../src/telegram/client';
import { logger } from '../src/utils/logger';

// Bootstrap script for Phase 16 (single-bot architecture): the platform bot
// that used to create the first `businesses` row for a new owner was deleted
// in Phase 16, and nothing replaced it — createBusinessForOnboarding had zero
// live callers. This is the stopgap: the platform operator runs this once per
// new business (with a bot token already created via @BotFather) to insert
// the placeholder row and register the webhook, so the owner's first message
// hits the onboarding routing block restored in commit 3f7b835.
//
// This is deliberately a manual CLI step, not a chat-driven flow — v1.4 has
// no self-serve "add a new business" entry point. See ROADMAP.md Backlog for
// a permanent fix if this keeps getting used.

function parseArg(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const botToken = parseArg(process.argv.slice(2), '--bot-token');
  const ownerTelegramId = parseArg(process.argv.slice(2), '--owner-telegram-id');

  if (!botToken || !ownerTelegramId) {
    console.error(
      'Usage: npx ts-node scripts/create-business.ts --bot-token <token> --owner-telegram-id <id>'
    );
    process.exit(1);
    return;
  }

  if (!config.webhookBaseUrl) {
    console.error(
      'WEBHOOK_BASE_URL is not set. Set it to your public tunnel URL (e.g. https://xxxx.ngrok-free.app) in .env.local before running this.'
    );
    process.exit(1);
    return;
  }

  const webhookId = crypto.randomUUID();
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  // Same defensive ordering as handleActivate (T-05-09): unregister before
  // register to avoid "another webhook is active" conflicts.
  await unregisterBotWebhook(botToken);
  await registerBotWebhook(
    botToken,
    `${config.webhookBaseUrl}/webhooks/telegram/${webhookId}`,
    webhookSecret
  );

  const business = await createBusinessForOnboarding({
    ownerTelegramId,
    name: 'New Business (onboarding)',
    slug: `pending-${webhookId.slice(0, 8)}`,
    botToken,
    webhookId,
    webhookSecret,
  });

  logger.info(
    { businessId: business.id, webhookId },
    'Business bootstrapped — message the bot from Telegram as the owner to start onboarding'
  );
  console.log(`Created business id=${business.id}. Message the bot on Telegram now to begin onboarding.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
