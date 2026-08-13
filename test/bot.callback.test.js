import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';

class MockBot extends EventEmitter {
    constructor() {
        super();
        this.answerCallbackQueryCalls = [];
        this.sendMessageCalls = [];
        this.editMessageTextCalls = [];
    }

    async answerCallbackQuery(queryId, options) {
        this.answerCallbackQueryCalls.push({ queryId, options });
    }

    async sendMessage(chatId, text, options) {
        this.sendMessageCalls.push({ chatId, text, options });
    }

    async editMessageText(text, options) {
        this.editMessageTextCalls.push({ text, options });
    }

    emitCallback(query) {
        this.emit('callback_query', query);
    }
}

describe('bot callback_query handler', () => {
    let mockBot;
    let handlerBookCalls = [];
    let handlerRescheduleCalls = [];

    // Mutable mock state lets individual tests vary behavior without re-mocking modules.
    const mockSupabase = {
        findPatientByChatId: async () => ({
            id: 'patient-1',
            name: 'Ahmed Hassan',
            phone: '+201234567890',
            country_code: '+20',
        }),
        listOpenSlots: async () => [
            {
                id: 'slot-1',
                starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
                dentist: { name: 'Dr. Smith' },
            },
        ],
        getSlotById: async (slotId) => ({
            id: slotId,
            starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            is_booked: false,
            dentist: { name: 'Dr. Smith' },
        }),
        createAppointment: async () => ({ id: 'appt-1' }),
        markSlotBooked: async () => {},
    };

    const mockTelegram = {
        bot: null, // set after mockBot is constructed
        sendMessage: async (chatId, text) => {
            mockBot.sendMessageCalls.push({ chatId, text });
        },
        sendInlineKeyboard: async (chatId, text, buttons) => {
            mockBot.sendMessageCalls.push({ chatId, text, buttons });
        },
        editMessageText: async (chatId, messageId, text, buttons) => {
            mockBot.editMessageTextCalls.push({ chatId, messageId, text, buttons });
        },
        sendTyping: async () => {},
        startPolling: async () => {},
    };

    before(async () => {
        mockBot = new MockBot();
        mockTelegram.bot = mockBot;

        mock.module('../src/services/telegramService.js', {
            namedExports: {
                bot: mockTelegram.bot,
                sendMessage: async (...args) => mockTelegram.sendMessage(...args),
                sendInlineKeyboard: async (...args) => mockTelegram.sendInlineKeyboard(...args),
                editMessageText: async (...args) => mockTelegram.editMessageText(...args),
                sendTyping: async (...args) => mockTelegram.sendTyping(...args),
                startPolling: async (...args) => mockTelegram.startPolling(...args),
            },
        });

        mock.module('../src/services/supabaseService.js', {
            namedExports: {
                supabaseAdmin: {},
                findPatientByChatId: async (...args) => mockSupabase.findPatientByChatId(...args),
                listOpenSlots: async (...args) => mockSupabase.listOpenSlots(...args),
                getSlotById: async (...args) => mockSupabase.getSlotById(...args),
                createAppointment: async (...args) => mockSupabase.createAppointment(...args),
                markSlotBooked: async (...args) => mockSupabase.markSlotBooked(...args),
            },
        });

        mock.module('../src/utils/state.js', {
            namedExports: {
                readState: async () => 'READY',
                writeState: async () => {},
                resetState: async () => {},
                readPendingBooking: async () => ({ text: 'I want to book', intent: 'book' }),
                writePendingBooking: async () => {},
                clearPendingBooking: async () => {},
                readPendingReschedule: async () => ({ appointmentId: '', appointmentType: '' }),
                writePendingReschedule: async () => {},
                clearPendingReschedule: async () => {},
            },
        });

        mock.module('../src/handlers/intentHandler.js', {
            namedExports: {
                handler: {
                    book: async (chatId, userId, lang, ctx) => {
                        handlerBookCalls.push({ chatId, userId, lang, ctx });
                        return { chatId, userId, lang, ctx };
                    },
                    reschedule: async (chatId, userId, lang, ctx) => {
                        handlerRescheduleCalls.push({ chatId, userId, lang, ctx });
                        return { chatId, userId, lang, ctx };
                    },
                },
                route: async () => {},
                isAck: (text) => ['ok', 'thanks', 'yes', 'حسنا', 'تمام', 'شكرا'].includes((text || '').trim().toLowerCase()),
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

        await import('../src/bot.js');
    });

    after(() => {
        mock.reset();
    });

    beforeEach(() => {
        mockBot.sendMessageCalls = [];
        mockBot.editMessageTextCalls = [];
        mockBot.answerCallbackQueryCalls = [];
        handlerBookCalls = [];
        handlerRescheduleCalls = [];

        // Restore default mock behavior.
        mockSupabase.findPatientByChatId = async () => ({
            id: 'patient-1',
            name: 'Ahmed Hassan',
            phone: '+201234567890',
            country_code: '+20',
        });
        mockSupabase.listOpenSlots = async () => [
            {
                id: 'slot-1',
                starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
                dentist: { name: 'Dr. Smith' },
            },
        ];
        mockSupabase.getSlotById = async (slotId) => ({
            id: slotId,
            starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            is_booked: false,
            dentist: { name: 'Dr. Smith' },
        });
        mockSupabase.createAppointment = async () => ({ id: 'appt-1' });
        mockSupabase.markSlotBooked = async () => {};

        mockTelegram.sendMessage = async (chatId, text) => {
            mockBot.sendMessageCalls.push({ chatId, text });
        };
        mockTelegram.sendInlineKeyboard = async (chatId, text, buttons) => {
            mockBot.sendMessageCalls.push({ chatId, text, buttons });
        };
        mockTelegram.editMessageText = async (chatId, messageId, text, buttons) => {
            mockBot.editMessageTextCalls.push({ chatId, messageId, text, buttons });
        };
        mockTelegram.sendTyping = async () => {};
        mockTelegram.startPolling = async () => {};
    });

    it('identity_yes triggers handler.book and answers callback', async () => {
        const query = {
            id: 'query-1',
            data: 'identity_yes',
            message: { chat: { id: 'chat-1' }, message_id: 100 },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 50);
        });

        assert.strictEqual(handlerBookCalls.length, 1, 'handler.book should be called once');
        assert.strictEqual(handlerBookCalls[0].chatId, 'chat-1');
        assert.strictEqual(handlerBookCalls[0].userId, 'patient-1');
        assert.strictEqual(handlerBookCalls[0].ctx.text, 'I want to book');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'answerCallbackQuery should be called');
    });

    it('identity_fix asks for name and answers callback', async () => {
        const query = {
            id: 'query-2',
            data: 'identity_fix',
            message: { chat: { id: 'chat-1' }, message_id: 100 },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 50);
        });

        assert.strictEqual(mockBot.sendMessageCalls.length, 1, 'should ask for name once');
        assert.match(mockBot.sendMessageCalls[0].text, /full name/i);
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'answerCallbackQuery should be called');
    });

    it('confirm callback books slot and edits success summary', async () => {
        const query = {
            id: 'query-3',
            data: 'confirm:slot-1:checkup',
            message: { chat: { id: 'chat-1' }, message_id: 200 },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 50);
        });

        assert.strictEqual(mockBot.editMessageTextCalls.length, 1, 'should edit message to success summary');
        assert.match(mockBot.editMessageTextCalls[0].text, /confirmed/i);
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer callback');
    });

    it('confirm callback shows slotTaken when slot is already booked', async () => {
        mockSupabase.getSlotById = async (slotId) => ({
            id: slotId,
            starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            is_booked: true,
            dentist: { name: 'Dr. Smith' },
        });

        const query = {
            id: 'query-4',
            data: 'confirm:slot-1:checkup',
            message: { chat: { id: 'chat-1' }, message_id: 200 },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 50);
        });

        const slotTakenEdited = mockBot.editMessageTextCalls.some(m =>
            (m.text || '').includes('no longer available') || (m.text || '').includes('غير متاح')
        );
        assert.strictEqual(slotTakenEdited, true, 'should edit slotTaken message');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer callback');
    });

    it('confirm callback shows slotTaken on unique constraint race', async () => {
        mockSupabase.createAppointment = async () => {
            throw new Error('duplicate key value violates unique constraint "appointments_unique_slot"');
        };

        const query = {
            id: 'query-5',
            data: 'confirm:slot-1:checkup',
            message: { chat: { id: 'chat-1' }, message_id: 200 },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 50);
        });

        const slotTakenEdited = mockBot.editMessageTextCalls.some(m =>
            (m.text || '').includes('no longer available') || (m.text || '').includes('غير متاح')
        );
        assert.strictEqual(slotTakenEdited, true, 'should edit slotTaken message on race');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer callback');
    });

    it('confirm callback falls back to sendMessage when editMessageText fails', async () => {
        mockTelegram.editMessageText = async () => {
            throw new Error('MESSAGE_NOT_MODIFIED');
        };

        const query = {
            id: 'query-6',
            data: 'confirm:slot-1:checkup',
            message: { chat: { id: 'chat-1' }, message_id: 200 },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 50);
        });

        assert.strictEqual(mockBot.sendMessageCalls.length, 1, 'should send fallback success message');
        assert.match(mockBot.sendMessageCalls[0].text, /confirmed/i);
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer callback');
    });

    it('confirm callback auto-re-offers when slot is already booked', async () => {
        const bookCallsBefore = handlerBookCalls.length;
        mockSupabase.getSlotById = async (slotId) => ({
            id: slotId,
            starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            is_booked: true,
            dentist: { name: 'Dr. Smith' },
        });

        const query = {
            id: 'query-7',
            data: 'confirm:slot-1:checkup',
            message: { chat: { id: 'chat-1' }, message_id: 200 },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 50);
        });

        const slotTakenEdited = mockBot.editMessageTextCalls.some(m =>
            (m.text || '').includes('no longer available') || (m.text || '').includes('غير متاح')
        );
        assert.strictEqual(slotTakenEdited, true, 'should edit slotTaken message');
        assert.strictEqual(handlerBookCalls.length, bookCallsBefore + 1, 'should auto-re-offer a fresh slot');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer callback');
    });

    it('confirm callback auto-re-offers when slot is past lead time', async () => {
        const bookCallsBefore = handlerBookCalls.length;
        // 30 minutes in the future, but default lead time is 2 hours => too soon.
        mockSupabase.getSlotById = async (slotId) => ({
            id: slotId,
            starts_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            is_booked: false,
            dentist: { name: 'Dr. Smith' },
        });

        const query = {
            id: 'query-8',
            data: 'confirm:slot-1:checkup',
            message: { chat: { id: 'chat-1' }, message_id: 200 },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 50);
        });

        const slotTakenEdited = mockBot.editMessageTextCalls.some(m =>
            (m.text || '').includes('no longer available') || (m.text || '').includes('غير متاح')
        );
        assert.strictEqual(slotTakenEdited, true, 'should edit slotTaken message');
        assert.strictEqual(handlerBookCalls.length, bookCallsBefore + 1, 'should auto-re-offer a fresh slot');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer callback');
    });

    it('confirm callback auto-re-offers on slot unique constraint race', async () => {
        const bookCallsBefore = handlerBookCalls.length;
        mockSupabase.createAppointment = async () => {
            throw new Error('duplicate key value violates unique constraint "appointments_unique_slot"');
        };

        const query = {
            id: 'query-9',
            data: 'confirm:slot-1:checkup',
            message: { chat: { id: 'chat-1' }, message_id: 200 },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 50);
        });

        const slotTakenEdited = mockBot.editMessageTextCalls.some(m =>
            (m.text || '').includes('no longer available') || (m.text || '').includes('غير متاح')
        );
        assert.strictEqual(slotTakenEdited, true, 'should edit slotTaken message on race');
        assert.strictEqual(handlerBookCalls.length, bookCallsBefore + 1, 'should auto-re-offer a fresh slot');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer callback');
    });

    it('confirm callback auto-re-offers when slot id no longer exists', async () => {
        const bookCallsBefore = handlerBookCalls.length;
        mockSupabase.getSlotById = async () => null;

        const query = {
            id: 'query-10',
            data: 'confirm:deleted-slot-id:checkup',
            message: { chat: { id: 'chat-1' }, message_id: 200 },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 50);
        });

        const slotTakenEdited = mockBot.editMessageTextCalls.some(m =>
            (m.text || '').includes('no longer available') || (m.text || '').includes('غير متاح')
        );
        assert.strictEqual(slotTakenEdited, true, 'should edit slotTaken message');
        assert.strictEqual(handlerBookCalls.length, bookCallsBefore + 1, 'should auto-re-offer a fresh slot');
        assert.strictEqual(mockBot.sendMessageCalls.length, 0, 'should not fall back to noSlots when re-offer works');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer callback');
    });
});
