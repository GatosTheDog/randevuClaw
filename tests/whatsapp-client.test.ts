import { sendWhatsAppMessage } from '../src/whatsapp/client';

describe('sendWhatsAppMessage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('issues a correctly-shaped POST and resolves to { messageId, status } on a 200 response', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        messaging_product: 'whatsapp',
        contacts: [{ input: '306900000000', wa_id: '306900000000' }],
        messages: [{ id: 'wamid.XYZ' }],
      }),
    };
    const fetchMock = jest.fn().mockResolvedValue(mockResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendWhatsAppMessage('306900000000', 'hello');

    expect(result).toEqual({ messageId: 'wamid.XYZ', status: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/messages$/);
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toMatch(/^Bearer /);
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '306900000000',
      type: 'text',
      text: { body: 'hello' },
    });
  });

  it('throws on a non-2xx response', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    };
    global.fetch = jest.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch;

    await expect(sendWhatsAppMessage('306900000000', 'hello')).rejects.toThrow();
  });
});
