describe('config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('parses a valid full env into a typed config object, applying documented defaults', () => {
    process.env.APP_SECRET = 'test-app-secret';
    process.env.WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-whatsapp-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb?sslmode=require';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    // TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET omitted (D-08, Phase 04):
    // config no longer validates or exposes these global Telegram vars.
    process.env.OWNER_TELEGRAM_ID = '999999999';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/oauth/callback';
    delete process.env.PORT;
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
    delete process.env.DATABASE_APP_URL;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('../src/config');

    expect(config.appSecret).toBe('test-app-secret');
    expect(config.webhookVerifyToken).toBe('test-verify-token');
    expect(config.whatsappAccessToken).toBe('test-whatsapp-token');
    expect(config.whatsappPhoneNumberId).toBe('test-phone-number-id');
    expect(config.databaseUrl).toBe(
      'postgresql://user:pass@localhost:5432/testdb?sslmode=require'
    );
    expect(config.geminiApiKey).toBe('test-gemini-key');
    // Phase 04 (D-08): telegramBotToken and telegramWebhookSecret no longer on config
    expect((config as Record<string, unknown>).telegramBotToken).toBeUndefined();
    expect((config as Record<string, unknown>).telegramWebhookSecret).toBeUndefined();
    // Phase 04 (D-11): databaseAppUrl is optional; undefined when DATABASE_APP_URL unset
    expect(config.databaseAppUrl).toBeUndefined();
    expect(config.ownerTelegramId).toBe('999999999');
    expect(config.googleClientId).toBe('test-google-client-id');
    expect(config.googleClientSecret).toBe('test-google-client-secret');
    expect(config.googleRedirectUri).toBe('http://localhost:3000/oauth/callback');
    // Documented defaults when omitted:
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.nodeEnv).toBe('development');
  });

  it('throws synchronously with a message naming the missing key when a required var is absent', () => {
    delete process.env.APP_SECRET;
    process.env.WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-whatsapp-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb?sslmode=require';

    expect(() => require('../src/config')).toThrow(/APP_SECRET/);
  });

  it('throws synchronously naming GEMINI_API_KEY when it is missing', () => {
    process.env.APP_SECRET = 'test-app-secret';
    process.env.WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-whatsapp-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb?sslmode=require';
    process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-bot-token';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-telegram-webhook-secret';
    process.env.OWNER_TELEGRAM_ID = '999999999';
    delete process.env.GEMINI_API_KEY;

    expect(() => require('../src/config')).toThrow(/GEMINI_API_KEY/);
  });

  it('throws synchronously naming GOOGLE_CLIENT_ID when it is missing', () => {
    process.env.APP_SECRET = 'test-app-secret';
    process.env.WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-whatsapp-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb?sslmode=require';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-bot-token';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-telegram-webhook-secret';
    process.env.OWNER_TELEGRAM_ID = '999999999';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/oauth/callback';
    delete process.env.GOOGLE_CLIENT_ID;

    expect(() => require('../src/config')).toThrow(/GOOGLE_CLIENT_ID/);
  });
});
