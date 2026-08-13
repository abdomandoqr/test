import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert';

const supabaseAdmin = { from: () => ({}) };
const supabaseState = {
    findPatientByChatId: null,
    readState: 'NEW',
};

const geminiState = {
    reply: '',
    intent: { intent: 'other', info_topic: 'general', appointment_type: 'checkup' },
};

describe('message handler', () => {
    let handleMessage;
    let sentMessages = [];
    let sentKeyboards = [];
    let states = [];
    let pendingBookings = [];

    before(async () => {
        mock.module('../src/services/telegramService.js', {
            namedExports: {
                sendMessage: async (chatId, text) => {
                    sentMessages.push({ chatId, text });
                },
                sendInlineKeyboard: async (chatId, text, buttons) => {
                    sentKeyboards.push({ chatId, text, buttons });
                },
                sendTyping: async () => {},
            },
        });

        mock.module('../src/services/supabaseService.js', {
            namedExports: {
                supabaseAdmin,
                findPatientByChatId: async () => supabaseState.findPatientByChatId,
                findPatientByPhone: async () => null,
                createPatient: async (patient) => ({ id: 'patient-1', ...patient }),
                updatePatient: async (id, updates) => ({ id, ...updates }),
                listOpenSlots: async () => [],
                appendMessage: async () => {},
                getRecentMessages: async () => [],
            },
        });

        mock.module('../src/utils/state.js', {
            namedExports: {
                readState: async () => supabaseState.readState,
                writeState: async (_admin, chatId, state) => { states.push({ chatId, state }); },
                resetState: async () => { states.push({ state: 'NEW' }); },
                readPendingBooking: async () => ({ text: '', intent: 'book' }),
                writePendingBooking: async (_admin, chatId, text, intent) => {
                    pendingBookings.push({ chatId, text, intent });
                },
                clearPendingBooking: async () => {},
                readPendingReschedule: async () => ({ appointmentId: '', appointmentType: '' }),
                writePendingReschedule: async () => {},
                clearPendingReschedule: async () => {},
            },
        });

        mock.module('../src/services/geminiService.js', {
            namedExports: {
                askGemini: async () => ({ reply: geminiState.reply, intent: geminiState.intent }),
            },
        });

        mock.module('../src/config.js', {
            namedExports: {
                clinicEnv: {},
                config: {
                    supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'test-key' },
                    telegram: { botToken: 'test-token' },
                    gemini: { apiKey: 'test-key', model: 'test' },
                    env: 'test',
                    logLevel: 'silent',
                },
                rules: {
                    timezone: 'Africa/Cairo',
                    defaultSlotMinutes: 30,
                    bookingLeadHours: 2,
                    maxActiveAppointments: 1,
                    reminderEnabled: true,
                    reminderHoursBefore: [24, 1],
                    reminderCronMinutes: 5,
                },
            },
        });

        const messageHandler = await import('../src/handlers/messageHandler.js');
        handleMessage = messageHandler.handleMessage;
    });

    after(() => {
        mock.reset();
    });

    beforeEach(() => {
        sentMessages = [];
        sentKeyboards = [];
        states = [];
        pendingBookings = [];
        supabaseState.findPatientByChatId = null;
        supabaseState.readState = 'NEW';
        geminiState.reply = '';
        geminiState.intent = { intent: 'other', info_topic: 'general', appointment_type: 'checkup' };
    });

    describe('case 3 — invalid phone stays on AWAITING_PHONE', () => {
        it('re-prompts for phone and does not ask name when phone is invalid', async () => {
            supabaseState.readState = 'AWAITING_PHONE';
            supabaseState.findPatientByChatId = null;

            await handleMessage({ chat: { id: 'chat-case3' }, text: '123' });

            const askPhoneSent = sentMessages.some(m => m.text.includes('phone number'));
            const askNameSent = sentMessages.some(m => m.text.includes('full name'));
            assert.ok(askPhoneSent, 'should ask for phone again');
            assert.ok(!askNameSent, 'should NOT ask for name');
            assert.ok(states.every(s => s.state !== 'AWAITING_NAME'), 'state should not switch to AWAITING_NAME');
        });
    });

    describe('case 11 — identity gate on book/reschedule only', () => {
        beforeEach(() => {
            supabaseState.readState = 'READY';
            supabaseState.findPatientByChatId = {
                id: 'patient-1',
                name: 'Ahmed Hassan',
                phone: '+201234567890',
                country_code: '+20',
            };
        });

        it('shows identity confirmation for book intent', async () => {
            geminiState.intent = { intent: 'book', info_topic: 'general', appointment_type: 'checkup' };

            await handleMessage({ chat: { id: 'chat-case11-book' }, text: 'I want to book' });

            assert.strictEqual(sentKeyboards.length, 1, 'should send identity confirmation keyboard');
            assert.match(sentKeyboards[0].text, /Please confirm before booking/i);
        });

        it('shows identity confirmation for reschedule intent', async () => {
            geminiState.intent = { intent: 'reschedule', info_topic: 'general', appointment_type: 'checkup' };

            await handleMessage({ chat: { id: 'chat-case11-reschedule' }, text: 'reschedule' });

            assert.strictEqual(sentKeyboards.length, 1, 'should send identity confirmation keyboard');
            assert.match(sentKeyboards[0].text, /Please confirm before booking/i);
        });

        it('does NOT show identity confirmation for info/services intent', async () => {
            geminiState.reply = 'Our services: checkup, cleaning, filling.';
            geminiState.intent = { intent: 'info', info_topic: 'services', appointment_type: 'checkup' };

            await handleMessage({ chat: { id: 'chat-case11-info' }, text: 'services' });

            assert.strictEqual(sentKeyboards.length, 0, 'should not send any keyboard');
            assert.ok(sentMessages.some(m => m.text.includes('services')), 'should send FAQ reply');
        });

        it('does NOT show identity confirmation for ack messages', async () => {
            await handleMessage({ chat: { id: 'chat-case11-ack' }, text: 'ok' });

            assert.strictEqual(sentKeyboards.length, 0, 'should not send identity keyboard');
            assert.ok(sentMessages.length > 0, 'should send ack prompt');
        });
    });
});
