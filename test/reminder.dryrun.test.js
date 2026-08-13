import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert';

describe('reminder script dry run', () => {
    let fetchDueAppointments;
    let sendReminder;
    let run;
    let updates = [];
    let sentMessages = [];

    before(async () => {
        mock.module('@supabase/supabase-js', {
            namedExports: {
                createClient: () => ({}),
            },
        });

        mock.module('node-telegram-bot-api', {
            defaultExport: class MockBot {
                constructor() {}
                async sendMessage(chatId, text) {
                    sentMessages.push({ chatId, text });
                }
            },
        });

        mock.module('../src/config.js', {
            namedExports: {
                clinicEnv: {},
                config: {
                    supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'test-key' },
                    telegram: { botToken: 'test-token' },
                },
                rules: {
                    reminderEnabled: true,
                    reminderHoursBefore: [24, 1],
                },
            },
        });

        const reminderModule = await import('../scripts/send_reminders.mjs');
        fetchDueAppointments = reminderModule.fetchDueAppointments;
        sendReminder = reminderModule.sendReminder;
        run = reminderModule.run;
    });

    after(() => {
        mock.reset();
    });

    beforeEach(() => {
        updates = [];
        sentMessages = [];
    });

    it('fetchDueAppointments returns appointments from the query', async () => {
        const now = new Date();
        const slot = { starts_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(), dentists: { name: 'Dr. A' } };

        const mockSupabase = {
            from: () => ({
                select: () => ({
                    in: () => ({
                        is: () => ({
                            is: () => ({
                                gt: () => ({
                                    gt: () => ({
                                        lte: async () => ({
                                            data: [
                                                { id: 'appt-24h', status: 'confirmed', reminder_24h_sent_at: null, patients: { chat_id: 'chat-24h' }, available_slots: slot },
                                            ],
                                            error: null,
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        };

        const result = await fetchDueAppointments(mockSupabase, 24, now);

        assert.strictEqual(result.appointments.length, 1);
        assert.strictEqual(result.appointments[0].id, 'appt-24h');
        assert.strictEqual(result.flagColumn, 'reminder_24h_sent_at');
    });

    it('fetchDueAppointments query skips cancelled by construction', async () => {
        const now = new Date();
        const slot = { starts_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(), dentists: { name: 'Dr. B' } };

        const mockSupabase = {
            from: () => ({
                select: () => ({
                    in: () => ({
                        is: () => ({
                            is: () => ({
                                gt: () => ({
                                    gt: () => ({
                                        lte: async () => ({
                                            data: [
                                                { id: 'appt-1h', status: 'confirmed', reminder_1h_sent_at: null, patients: { chat_id: 'chat-1h' }, available_slots: slot },
                                            ],
                                            error: null,
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        };

        const result = await fetchDueAppointments(mockSupabase, 1, now);
        assert.strictEqual(result.appointments.length, 1);
        assert.strictEqual(result.appointments[0].status, 'confirmed');
    });

    it('sendReminder sends message and updates flag', async () => {
        const mockSupabase = {
            from: () => ({
                update: (payload) => ({
                    eq: (id) => {
                        updates.push({ id, payload });
                        return Promise.resolve({ data: null, error: null });
                    },
                }),
            }),
        };
        const mockBot = { sendMessage: async (chatId, text) => { sentMessages.push({ chatId, text }); } };
        const appt = {
            id: 'appt-1',
            patients: { chat_id: 'chat-1' },
            available_slots: { starts_at: new Date().toISOString(), dentists: { name: 'Dr. X' } },
        };

        const result = await sendReminder({ supabaseClient: mockSupabase, botClient: mockBot, appt, hours: 24, flagColumn: 'reminder_24h_sent_at' });

        assert.strictEqual(result.sent, true);
        assert.strictEqual(sentMessages.length, 1);
        assert.strictEqual(sentMessages[0].chatId, 'chat-1');
        assert.strictEqual(updates.length, 1);
        assert.ok(updates[0].payload.reminder_24h_sent_at);
    });

    it('sendReminder skips appointments without chat_id', async () => {
        const mockSupabase = { from: () => ({ update: () => ({ eq: () => Promise.resolve({}) }) }) };
        const mockBot = { sendMessage: async () => { sentMessages.push({}); } };
        const appt = { id: 'appt-2', patients: {}, available_slots: { starts_at: new Date().toISOString(), dentists: { name: 'Dr. Y' } } };

        const result = await sendReminder({ supabaseClient: mockSupabase, botClient: mockBot, appt, hours: 1, flagColumn: 'reminder_1h_sent_at' });

        assert.strictEqual(result.sent, false);
        assert.strictEqual(sentMessages.length, 0);
    });

    it('run is idempotent and logs counts', async () => {
        const now = new Date();
        const slot = { starts_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(), dentists: { name: 'Dr. Z' } };
        const appts = [
            { id: 'appt-a', status: 'confirmed', reminder_24h_sent_at: null, patients: { chat_id: 'chat-a' }, available_slots: slot },
        ];

        let queryCount = 0;
        const mockSupabase = {
            from: () => ({
                select: () => ({
                    in: () => ({
                        is: () => ({
                            is: () => ({
                                gt: () => ({
                                    gt: () => ({
                                        lte: async () => {
                                            queryCount += 1;
                                            return { data: queryCount === 1 ? appts : [], error: null };
                                        },
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
                update: (payload) => ({
                    eq: (id) => {
                        updates.push({ id, payload });
                        return Promise.resolve({ data: null, error: null });
                    },
                }),
            }),
        };
        const mockBot = { sendMessage: async (chatId, text) => { sentMessages.push({ chatId, text }); } };

        await run({ supabaseClient: mockSupabase, botClient: mockBot });
        assert.strictEqual(sentMessages.length, 1, 'first run should send one 24h reminder');

        await run({ supabaseClient: mockSupabase, botClient: mockBot });
        assert.strictEqual(sentMessages.length, 1, 'second run should not send duplicate reminders');
    });

    it('run respects REMINDER_ENABLED=false', async () => {
        await run({
            supabaseClient: {},
            botClient: {},
            rules: { reminderEnabled: false, reminderHoursBefore: [24, 1] },
        });

        assert.strictEqual(sentMessages.length, 0, 'no reminders when disabled');
    });
});
