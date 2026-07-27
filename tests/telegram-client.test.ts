import {
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  answerCallbackQuery,
  editTelegramMessageReplyMarkup,
  botTokenStore,
  setChatMenuButton,
  setMyCommands,
} from '../src/telegram/client';
import { logger } from '../src/utils/logger';

describe('Telegram Bot API client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('Test 1: sendTelegramMessage POSTs to sendMessage and resolves to { messageId }', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await botTokenStore.run('test-bot-token', async () => {
      const result = await sendTelegramMessage('12345', 'γεια');

      expect(result).toEqual({ messageId: 42 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/sendMessage$/);
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body as string);
      expect(body).toEqual({ chat_id: '12345', text: 'γεια' });
    });
  });

  it('Test 2: sendTelegramMessageWithKeyboard includes reply_markup.inline_keyboard', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 43 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const keyboard = [
      [
        { text: 'Αποδοχή', callback_data: 'approve_7' },
        { text: 'Απόρριψη', callback_data: 'reject_7' },
      ],
    ];

    await botTokenStore.run('test-bot-token', async () => {
      const result = await sendTelegramMessageWithKeyboard('12345', 'Νέο booking', keyboard);

      expect(result).toEqual({ messageId: 43 });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/sendMessage$/);
      const body = JSON.parse(options.body as string);
      expect(body).toEqual({
        chat_id: '12345',
        text: 'Νέο booking',
        reply_markup: { inline_keyboard: keyboard },
      });
    });
  });

  it('Test 3: answerCallbackQuery POSTs to answerCallbackQuery with callback_query_id and text', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await botTokenStore.run('test-bot-token', async () => {
      await answerCallbackQuery('cbq123', 'Booking επιβεβαιώθηκε');

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/answerCallbackQuery$/);
      const body = JSON.parse(options.body as string);
      expect(body).toMatchObject({
        callback_query_id: 'cbq123',
        text: 'Booking επιβεβαιώθηκε',
      });
    });
  });

  it('Test 4: editTelegramMessageReplyMarkup POSTs to editMessageReplyMarkup with empty inline_keyboard', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await botTokenStore.run('test-bot-token', async () => {
      await editTelegramMessageReplyMarkup('12345', 42, []);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/editMessageReplyMarkup$/);
      const body = JSON.parse(options.body as string);
      expect(body).toEqual({
        chat_id: '12345',
        message_id: 42,
        reply_markup: { inline_keyboard: [] },
      });
    });
  });

  it('Test 5: throws an Error containing description when Telegram JSON envelope has ok: false (even on HTTP 200)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, description: 'Bad Request' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await botTokenStore.run('test-bot-token', async () => {
      await expect(sendTelegramMessage('12345', 'γεια')).rejects.toThrow('Bad Request');
    });
  });

  it('Test 6: setChatMenuButton(token, chatId) POSTs chat_id + menu_button of type commands', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await setChatMenuButton('test-bot-token', '123');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/setChatMenuButton$/);
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ chat_id: '123', menu_button: { type: 'commands' } });
  });

  it('Test 7: setChatMenuButton(token) with no chatId omits chat_id entirely', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await setChatMenuButton('test-bot-token');

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ menu_button: { type: 'commands' } });
    expect(body).not.toHaveProperty('chat_id');
  });

  it('Test 8: setMyCommands(token, commands, chat scope) POSTs commands + scope', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const commands = [{ command: 'menu', description: 'Εμφάνιση μενού διαχείρισης' }];
    await setMyCommands('test-bot-token', commands, { type: 'chat', chat_id: '123' });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/setMyCommands$/);
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ commands, scope: { type: 'chat', chat_id: '123' } });
  });

  it('Test 9: setMyCommands(token, commands) with no scope omits scope entirely', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const commands = [{ command: 'start', description: 'Έναρξη κράτησης ραντεβού' }];
    await setMyCommands('test-bot-token', commands);

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ commands });
    expect(body).not.toHaveProperty('scope');
  });

  it('Test 10: never logs the raw bot token via logger.debug/logger.error for either new function', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const debugSpy = jest.spyOn(logger, 'debug');
    const errorSpy = jest.spyOn(logger, 'error');

    const FAKE_TOKEN = 'super-secret-fake-token-abc123';
    await setChatMenuButton(FAKE_TOKEN, '123');
    await setMyCommands(FAKE_TOKEN, [{ command: 'menu', description: 'x' }]);

    const allCalls = [...debugSpy.mock.calls, ...errorSpy.mock.calls];
    for (const call of allCalls) {
      expect(JSON.stringify(call)).not.toContain(FAKE_TOKEN);
    }
  });
});
