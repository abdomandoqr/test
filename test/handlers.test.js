import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert';

const supabaseState = {
    findNextActiveAppointment: null,
    listOpenSlots: [],
};

describe('intent handlers', () => {
    let handler;
    let route;
    let sentMessages = [];
    let sentKeyboards = [];

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
                supabaseAdmin: {
                    from: () => ({
                        insert: async () => ({ error: null }),
                        delete: () => ({
                            eq: () => ({
                                eq: async () => ({ error: null }),
                            }),
                        }),
                    }),
                },
                findNextActiveAppointment: async () => supabaseState.findNextActiveAppointment,
                listOpenSlots: async () => supabaseState.listOpenSlots,
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

        const intentHandler = await import('../src/handlers/intentHandler.js');
        handler = intentHandler.handler;
        route = intentHandler.route;
    });

    after(() => {
        mock.reset();
    });

    beforeEach(() => {
        sentMessages = [];
        sentKeyboards = [];
        supabaseState.findNextActiveAppointment = null;
        supabaseState.listOpenSlots = [];
    });

    it('blocks second booking when active appointment exists', async () => {
        supabaseState.findNextActiveAppointment = {
            id: 'appt-1',
            appointment_type: 'cleaning',
            status: 'confirmed',
            slot: {
                starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                dentist: { name: 'Dr. Smith' },
            },
        };
        supabaseState.listOpenSlots = [
            { id: 'slot-2', starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), dentist: { name: 'Dr. Jones' } },
        ];

        await handler.book('chat-1', 'patient-1', 'en', { text: 'book' });

        assert.strictEqual(sentKeyboards.length, 1, 'should send a keyboard');
        const kb = sentKeyboards[0];
        assert.match(kb.text, /already have an active appointment/i);
        assert.ok(kb.buttons.some(row => row.some(b => b.callback_data.startsWith('cancel_appointment:'))));
        assert.ok(kb.buttons.some(row => row.some(b => b.callback_data.startsWith('rs:'))));
    });

    it('cancel shows summary + confirm/back buttons when active appointment exists', async () => {
        supabaseState.findNextActiveAppointment = {
            id: 'appt-1',
            appointment_type: 'filling',
            status: 'confirmed',
            slot: {
                starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                dentist: { name: 'Dr. Smith' },
            },
        };

        await handler.cancel('chat-1', 'patient-1', 'en');

        assert.strictEqual(sentKeyboards.length, 1);
        const kb = sentKeyboards[0];
        assert.match(kb.text, /cancel this appointment/i);
        assert.ok(kb.buttons.some(row => row.some(b => b.callback_data.startsWith('confirm_cancel:'))));
        assert.ok(kb.buttons.some(row => row.some(b => b.callback_data === 'back:cancel')));
    });

    it('reschedule preserves existing appointment type when no new type requested', async () => {
        supabaseState.findNextActiveAppointment = {
            id: 'appt-1',
            appointment_type: 'extraction',
            status: 'confirmed',
            slot: {
                starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                dentist: { name: 'Dr. Smith' },
            },
        };
        supabaseState.listOpenSlots = [
            { id: 'slot-2', starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), dentist: { name: 'Dr. Jones' } },
        ];

        await handler.reschedule('chat-1', 'patient-1', 'en', { text: '' });

        assert.strictEqual(sentKeyboards.length, 1);
        const kb = sentKeyboards[0];
        const confirmBtn = kb.buttons.flat().find(b => b.callback_data.startsWith('crs:'));
        assert.ok(confirmBtn, 'should have reschedule confirm button');
        assert.ok(confirmBtn.callback_data.match(/^crs:[^:]+$/), `expected short crs callback, got ${confirmBtn.callback_data}`);
        assert.ok(confirmBtn.callback_data.length <= 64, `callback_data must be <= 64 bytes, got ${confirmBtn.callback_data.length}`);
    });

    it('route does not map ack messages to book', async () => {
        supabaseState.listOpenSlots = [];

        await route('chat-1', 'patient-1', 'book', 'en', { text: 'ok' });

        assert.strictEqual(sentMessages.length, 1);
        assert.doesNotMatch(sentMessages[0].text, /appointment details/i);
    });
});
