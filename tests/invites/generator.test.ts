/**
 * Tests for src/invites/generator.ts — Phase 25 Plan 01 (INVITE-01).
 *
 * `qrcode` and `sharp` are both mocked module-wide. sharp's default export is
 * a jest.fn() factory returning a chainable object; the inner jest.fn()
 * references are exposed via the mock module's `_mocks` export so assertions
 * can inspect `composite`'s actual call arguments (T-25-01 escaping proof —
 * not merely "does not throw").
 */

jest.mock('qrcode');

jest.mock('sharp', () => {
  const composite = jest.fn().mockReturnThis();
  const png = jest.fn().mockReturnThis();
  const toBuffer = jest.fn().mockResolvedValue(Buffer.from('fake-composed-png'));
  const sharpFactory = jest.fn(() => ({ composite, png, toBuffer }));
  return {
    __esModule: true,
    default: sharpFactory,
    _mocks: { sharpFactory, composite, png, toBuffer },
  };
});

jest.mock('../../src/telegram/client', () => ({
  getMeBotInfo: jest.fn(),
  sendTelegramPhoto: jest.fn(),
}));

import QRCode from 'qrcode';
import { generateInviteImageBuffer, sendBusinessInvite } from '../../src/invites/generator';
import { getMeBotInfo, sendTelegramPhoto } from '../../src/telegram/client';
import { Business } from '../../src/database/queries';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharpMocks = (require('sharp') as { _mocks: Record<string, jest.Mock> })._mocks;

const mockQrToBuffer = QRCode.toBuffer as jest.Mock;
const mockGetMeBotInfo = getMeBotInfo as jest.Mock;
const mockSendTelegramPhoto = sendTelegramPhoto as jest.Mock;

const FIXED_QR_BUFFER = Buffer.from('fake-qr-png');
const FIXED_COMPOSED_BUFFER = Buffer.from('fake-composed-png');

const MOCK_BUSINESS: Business = {
  id: 1,
  name: 'Test Studio',
  slug: 'test-studio',
  phoneNumberId: null,
  ownerTelegramId: '123456789',
  googleRefreshToken: null,
  agendaSentDate: null,
  botToken: 'test-bot-token',
  webhookId: null,
  webhookSecret: null,
  enforcementPolicy: 'allow',
  bookingMode: 'open_slots',
  allowMultiBooking: false,
  cancellationCutoffEnabled: false,
  cancellationCutoffHours: 24,
  slotlessRequestsEnabled: false,
  lastSessionThresholdEnabled: false,
  lastSessionThresholdCount: 1,
  onboardingCompleted: true,
  createdAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQrToBuffer.mockResolvedValue(FIXED_QR_BUFFER);
  sharpMocks.toBuffer.mockResolvedValue(FIXED_COMPOSED_BUFFER);
});

describe('generateInviteImageBuffer', () => {
  it('calls QRCode.toBuffer with type png, errorCorrectionLevel H, a fixed width and margin, and resolves to the composed sharp buffer', async () => {
    const result = await generateInviteImageBuffer('t.me/testbot', 'Test Studio', 'Κάντε κράτηση τώρα!');

    expect(mockQrToBuffer).toHaveBeenCalledWith('t.me/testbot', {
      type: 'png',
      errorCorrectionLevel: 'H',
      width: 360,
      margin: 2,
    });
    expect(result).toBeInstanceOf(Buffer);
    expect(result.equals(FIXED_COMPOSED_BUFFER)).toBe(true);
  });

  it('escapes &, <, >, ", \' in businessName before it reaches the SVG buffer passed to sharp.composite', async () => {
    const rawName = `Studio & <B> "Co" 'X'`;
    await generateInviteImageBuffer('t.me/testbot', rawName, 'Κάντε κράτηση τώρα!');

    expect(sharpMocks.composite).toHaveBeenCalledTimes(1);
    const compositeArgs = sharpMocks.composite.mock.calls[0][0] as Array<{ input: unknown }>;
    const headerSvg = (compositeArgs[0].input as Buffer).toString('utf8');

    expect(headerSvg).toContain('Studio &amp; &lt;B&gt; &quot;Co&quot; &apos;X&apos;');
    expect(headerSvg).not.toContain(rawName);
  });

  it('rejects an empty/whitespace-only businessName before QRCode.toBuffer or sharp are ever called', async () => {
    await expect(
      generateInviteImageBuffer('t.me/testbot', '   ', 'Κάντε κράτηση τώρα!')
    ).rejects.toThrow();

    expect(mockQrToBuffer).not.toHaveBeenCalled();
    expect(sharpMocks.sharpFactory).not.toHaveBeenCalled();
  });

  it('rejects a businessName longer than 100 characters before QRCode.toBuffer or sharp are ever called', async () => {
    const longName = 'A'.repeat(101);
    await expect(
      generateInviteImageBuffer('t.me/testbot', longName, 'Κάντε κράτηση τώρα!')
    ).rejects.toThrow();

    expect(mockQrToBuffer).not.toHaveBeenCalled();
    expect(sharpMocks.sharpFactory).not.toHaveBeenCalled();
  });
});

describe('sendBusinessInvite', () => {
  it('rejects before calling getMeBotInfo when business.botToken is null', async () => {
    const business = { ...MOCK_BUSINESS, botToken: null };

    await expect(sendBusinessInvite(business, '999')).rejects.toThrow();
    expect(mockGetMeBotInfo).not.toHaveBeenCalled();
  });

  it('calls getMeBotInfo once and rejects before calling sendTelegramPhoto when botInfo.username is undefined', async () => {
    mockGetMeBotInfo.mockResolvedValue({ id: 1, username: undefined, firstName: 'Bot' });

    await expect(sendBusinessInvite(MOCK_BUSINESS, '999')).rejects.toThrow();

    expect(mockGetMeBotInfo).toHaveBeenCalledTimes(1);
    expect(mockGetMeBotInfo).toHaveBeenCalledWith('test-bot-token');
    expect(mockSendTelegramPhoto).not.toHaveBeenCalled();
  });

  it('on the happy path calls sendTelegramPhoto exactly once with (chatId, Buffer, caption containing t.me/<username>)', async () => {
    mockGetMeBotInfo.mockResolvedValue({ id: 1, username: 'test_bot', firstName: 'Bot' });
    mockSendTelegramPhoto.mockResolvedValue({ messageId: 1 });

    await sendBusinessInvite(MOCK_BUSINESS, '999');

    expect(mockSendTelegramPhoto).toHaveBeenCalledTimes(1);
    const [chatIdArg, bufferArg, captionArg] = mockSendTelegramPhoto.mock.calls[0];
    expect(chatIdArg).toBe('999');
    expect(bufferArg).toBeInstanceOf(Buffer);
    expect(captionArg).toContain('t.me/test_bot');
  });
});
