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
    delete process.env.PORT;
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('../src/config');

    expect(config.appSecret).toBe('test-app-secret');
    expect(config.webhookVerifyToken).toBe('test-verify-token');
    expect(config.whatsappAccessToken).toBe('test-whatsapp-token');
    expect(config.whatsappPhoneNumberId).toBe('test-phone-number-id');
    expect(config.databaseUrl).toBe(
      'postgresql://user:pass@localhost:5432/testdb?sslmode=require'
    );
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
});
