import * as queries from '../src/database/queries';
import * as greekPreprocessor from '../src/conversation/greek-preprocessor';
import * as aiAgent from '../src/conversation/ai-agent';
import { CONSENT_PROMPT_GREEK_TEMPLATE, CONSENT_KEYBOARD } from '../src/consent/checker';
import { routeConversationMessage, ConversationChannel } from '../src/conversation/router';

jest.mock('../src/database/queries');
jest.mock('../src/conversation/greek-preprocessor');
jest.mock('../src/conversation/ai-agent');
// Partial mock: keep the real CONSENT_NOTICE_GREEK_TEMPLATE (used for the
// test's own assertions) while replacing only getOrCreateClientRelationship.
jest.mock('../src/consent/checker', () => ({
  ...jest.requireActual('../src/consent/checker'),
  getOrCreateClientRelationship: jest.fn(),
}));
import { getOrCreateClientRelationship } from '../src/consent/checker';

const mockedGetOrCreateClientRelationship = getOrCreateClientRelationship as jest.MockedFunction<
  typeof getOrCreateClientRelationship
>;
const mockedFindLatestConversationTurn = queries.findLatestConversationTurn as jest.MockedFunction<
  typeof queries.findLatestConversationTurn
>;
const mockedInsertConversationTurn = queries.insertConversationTurn as jest.MockedFunction<
  typeof queries.insertConversationTurn
>;
const mockedResolveGreekTemporalExpressions = greekPreprocessor.resolveGreekTemporalExpressions as jest.MockedFunction<
  typeof greekPreprocessor.resolveGreekTemporalExpressions
>;
const mockedAiBookingAgent = aiAgent.aiBookingAgent as jest.MockedFunction<typeof aiAgent.aiBookingAgent>;

const BUSINESS: queries.Business = {
  id: 1,
  name: 'Pilates Athens',
  slug: 'pilates-athens',
  phoneNumberId: null,
  ownerTelegramId: '999999999',
  googleRefreshToken: null,
  agendaSentDate: null,
  botToken: null,
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

function makeConversationTurn(overrides: Partial<queries.ConversationTurn> = {}): queries.ConversationTurn {
  return {
    id: 1,
    businessId: 1,
    clientPhone: 'tg123',
    interactionId: 'int9',
    requestId: 'req9',
    messageText: 'θέλω ραντεβού αύριο',
    responseText: 'Εντάξει!',
    toolCalls: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeChannel(): ConversationChannel & { sendMessage: jest.Mock; sendMessageWithKeyboard: jest.Mock } {
  return {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 1 }),
    sendMessageWithKeyboard: jest.fn().mockResolvedValue({ messageId: 2 }),
  };
}

describe('routeConversationMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedResolveGreekTemporalExpressions.mockReturnValue({
      resolvedDate: '2026-07-09',
      resolvedTime: null,
      annotatedText: 'θέλω ραντεβού αύριο [ΣΥΣΤΗΜΑ: πιθανή ημερομηνία=2026-07-09, πιθανή ώρα=άγνωστη]',
    });
    mockedAiBookingAgent.mockResolvedValue({
      text: 'Εντάξει!',
      interactionId: 'int9',
      requestId: 'req9',
      toolCalls: [],
    });
    mockedInsertConversationTurn.mockResolvedValue(makeConversationTurn());
    mockedFindLatestConversationTurn.mockResolvedValue(null);
    mockedGetOrCreateClientRelationship.mockResolvedValue({ isFirstContact: false, consentGiven: true });
  });

  it('Test 1: returning client -> no consent prefix; turn persisted with the RAW message text', async () => {
    const channel = makeChannel();

    await routeConversationMessage(BUSINESS, 'tg123', 'θέλω ραντεβού αύριο', channel);

    expect(channel.sendMessage).toHaveBeenCalledWith('tg123', 'Εντάξει!');
    expect(mockedInsertConversationTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 1,
        clientPhone: 'tg123',
        interactionId: 'int9',
        requestId: 'req9',
        messageText: 'θέλω ραντεβού αύριο',
        responseText: 'Εντάξει!',
      })
    );
  });

  it('Test 2: consentGiven=false -> hard gate: consent prompt+keyboard sent, aiBookingAgent/insertConversationTurn/sendMessage NOT called', async () => {
    mockedGetOrCreateClientRelationship.mockResolvedValue({ isFirstContact: true, consentGiven: false });
    const channel = makeChannel();

    await routeConversationMessage(BUSINESS, 'tg123', 'θέλω ραντεβού αύριο', channel);

    expect(channel.sendMessageWithKeyboard).toHaveBeenCalledWith(
      'tg123',
      CONSENT_PROMPT_GREEK_TEMPLATE(BUSINESS.name),
      CONSENT_KEYBOARD
    );
    expect(mockedAiBookingAgent).not.toHaveBeenCalled();
    expect(mockedInsertConversationTurn).not.toHaveBeenCalled();
    expect(channel.sendMessage).not.toHaveBeenCalled();
  });

  it('Test 3: aiBookingAgent receives the preprocessed annotated text, not the raw message', async () => {
    const channel = makeChannel();

    await routeConversationMessage(BUSINESS, 'tg123', 'θέλω ραντεβού αύριο', channel);

    expect(mockedAiBookingAgent).toHaveBeenCalledWith(
      'θέλω ραντεβού αύριο [ΣΥΣΤΗΜΑ: πιθανή ημερομηνία=2026-07-09, πιθανή ώρα=άγνωστη]',
      BUSINESS,
      'tg123',
      null
    );
  });

  it('Test 4: previousInteractionId is derived from findLatestConversationTurn (present vs null)', async () => {
    mockedFindLatestConversationTurn.mockResolvedValue(makeConversationTurn({ interactionId: 'priorInt' }));
    await routeConversationMessage(BUSINESS, 'tg123', 'msg', makeChannel());
    expect(mockedAiBookingAgent).toHaveBeenCalledWith(expect.any(String), BUSINESS, 'tg123', 'priorInt');

    jest.clearAllMocks();
    mockedResolveGreekTemporalExpressions.mockReturnValue({
      resolvedDate: null,
      resolvedTime: null,
      annotatedText: 'msg',
    });
    mockedAiBookingAgent.mockResolvedValue({ text: 'Εντάξει!', interactionId: 'int9', requestId: 'req9', toolCalls: [] });
    mockedInsertConversationTurn.mockResolvedValue(makeConversationTurn());
    mockedGetOrCreateClientRelationship.mockResolvedValue({ isFirstContact: false, consentGiven: true });
    mockedFindLatestConversationTurn.mockResolvedValue(null);

    await routeConversationMessage(BUSINESS, 'tg123', 'msg', makeChannel());
    expect(mockedAiBookingAgent).toHaveBeenCalledWith(expect.any(String), BUSINESS, 'tg123', null);
  });
});
