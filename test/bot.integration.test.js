import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config } from '../src/config.js';

const supabaseUrl = config.supabase.url
    ?.replace(/\/rest\/v1\/?$/, '')
    ?.replace(/\/$/, '');

const supabaseAdmin = createClient(supabaseUrl, config.supabase.serviceRoleKey, {
    realtime: { transport: WebSocket },
});

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

describe('bot callback integration', () => {
    let mockBot;
    const runId = `bot-int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const testIds = { dentistId: null, slotIds: [], patientId: null };

    before(async () => {
        mockBot = new MockBot();

        mock.module('../src/services/telegramService.js', {
            namedExports: {
                bot: mockBot,
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
            },
        });

        await import('../src/bot.js');

        // Create real test data in Supabase
        const { data: dentist } = await supabaseAdmin
            .from('dentists')
            .insert({ name: `Bot Int Dentist ${runId}`, is_active: true })
            .select()
            .single();
        testIds.dentistId = dentist.id;

        const now = new Date();
        const { data: slots } = await supabaseAdmin
            .from('available_slots')
            .insert([
                {
                    dentist_id: dentist.id,
                    starts_at: new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString(),
                    duration_minutes: 30,
                    buffer_minutes: 10,
                    is_booked: false,
                },
            ])
            .select();
        testIds.slotIds.push(slots[0].id);

        const { data: patient } = await supabaseAdmin
            .from('patients')
            .insert({
                name: `Bot Int Patient ${runId}`,
                phone: `+20${runId.slice(-10)}`,
                chat_id: `chat-${runId}`,
                channel: 'telegram',
                country_code: '+20',
                date_of_birth: '1990-01-01',
                gender: 'male',
            })
            .select()
            .single();
        testIds.patientId = patient.id;
    });

    after(async () => {
        mock.reset();
        if (testIds.patientId) {
            await supabaseAdmin.from('patients').delete().eq('id', testIds.patientId);
        }
        if (testIds.slotIds.length > 0) {
            await supabaseAdmin.from('available_slots').delete().in('id', testIds.slotIds);
        }
        if (testIds.dentistId) {
            await supabaseAdmin.from('dentists').delete().eq('id', testIds.dentistId);
        }
    });

    beforeEach(async () => {
        mockBot.sendMessageCalls = [];
        mockBot.editMessageTextCalls = [];
        mockBot.answerCallbackQueryCalls = [];

        // Clean state, pending bookings, appointments, and reset slot booking flags
        // so each integration test starts from a known DB state.
        await supabaseAdmin
            .from('conversation_history')
            .delete()
            .eq('chat_id', `chat-${runId}`)
            .in('role', ['state', 'pending_booking']);

        if (testIds.patientId) {
            await supabaseAdmin.from('appointments').delete().eq('patient_id', testIds.patientId);
        }
        if (testIds.slotIds.length > 0) {
            await supabaseAdmin.from('available_slots').update({ is_booked: false }).in('id', testIds.slotIds);
        }
    });

    it('identity_yes with real Supabase offers a slot and does NOT ask name', async () => {
        const chatId = `chat-${runId}`;

        // Set state and pending booking as messageHandler would
        await supabaseAdmin
            .from('conversation_history')
            .insert([
                { chat_id: chatId, role: 'state', content: 'AWAITING_BOOKING_IDENTITY_CONFIRM' },
                { chat_id: chatId, role: 'pending_booking', content: JSON.stringify({ text: 'I want to book', intent: 'book', created_at: new Date().toISOString() }) },
            ]);

        const query = {
            id: 'query-int-1',
            data: 'identity_yes',
            message: { chat: { id: chatId }, message_id: 200, text: 'Please confirm before booking:\nName: ...' },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 500);
        });

        const askNameSent = mockBot.sendMessageCalls.some(m =>
            (m.text || '').includes('full name') || (m.text || '').includes('اسمك')
        );
        const slotOfferSent = mockBot.sendMessageCalls.some(m =>
            (m.text || '').includes('Appointment Details') || (m.text || '').includes('تفاصيل الموعد')
        );
        const noSlotsSent = mockBot.sendMessageCalls.some(m =>
            (m.text || '').includes('no slots') || (m.text || '').includes('لا توجد مواعيد')
        );

        assert.strictEqual(askNameSent, false, 'should NOT ask for name after identity_yes');
        assert.strictEqual(slotOfferSent || noSlotsSent, true, 'should send slot offer or noSlots message');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer callback');
    });

    it('reschedule_appointment offers a new slot and confirm_reschedule swaps appointments', async () => {
        const chatId = `chat-${runId}`;
        const oldSlotId = testIds.slotIds[0];

        // Create active appointment on oldSlotId
        const { data: appointment } = await supabaseAdmin
            .from('appointments')
            .insert({
                patient_id: testIds.patientId,
                slot_id: oldSlotId,
                appointment_type: 'checkup',
                status: 'confirmed',
            })
            .select()
            .single();

        // Mark old slot booked
        await supabaseAdmin.from('available_slots').update({ is_booked: true }).eq('id', oldSlotId);

        mockBot.sendMessageCalls = [];
        mockBot.editMessageTextCalls = [];
        mockBot.answerCallbackQueryCalls = [];

        // Press Reschedule on active appointment card
        const rescheduleQuery = {
            id: 'query-reschedule-1',
            data: `rs:${appointment.id}`,
            message: { chat: { id: chatId }, message_id: 400, text: 'Appointment summary' },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(rescheduleQuery);
            setTimeout(resolve, 500);
        });

        const slotOfferSent = mockBot.sendMessageCalls.some(m =>
            (m.text || '').includes('Choose a new slot') || (m.text || '').includes('اختر موعداً جديداً')
        );
        assert.strictEqual(slotOfferSent, true, 'should offer a new slot for reschedule');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer reschedule callback');

        // Extract the offered slot id from the confirm_reschedule button
        const offerMsg = mockBot.sendMessageCalls.find(m => m.buttons);
        const confirmButton = offerMsg?.buttons?.flat().find(b =>
            (b.callback_data || '').startsWith('crs:')
        );
        assert.ok(confirmButton, 'should have crs confirm button');
        assert.ok(confirmButton.callback_data.length <= 64, `crs callback_data must be <= 64 bytes, got ${confirmButton.callback_data.length}`);
        const confirmMatch = confirmButton.callback_data.match(/^crs:([^:]+)$/);
        assert.ok(confirmMatch, 'crs callback_data should match pattern');
        const [, offeredSlotId] = confirmMatch;
        assert.notStrictEqual(offeredSlotId, oldSlotId, 'offered slot should differ from the old slot');

        const { data: offeredSlot } = await supabaseAdmin
            .from('available_slots')
            .select('is_booked')
            .eq('id', offeredSlotId)
            .single();
        assert.strictEqual(offeredSlot.is_booked, false, 'offered slot should be free');

        mockBot.sendMessageCalls = [];
        mockBot.editMessageTextCalls = [];
        mockBot.answerCallbackQueryCalls = [];

        // Press Confirm on the new slot
        const confirmQuery = {
            id: 'query-confirm-reschedule-1',
            data: confirmButton.callback_data,
            message: { chat: { id: chatId }, message_id: 401, text: 'Reschedule confirmation' },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(confirmQuery);
            setTimeout(resolve, 500);
        });

        const successEdited = mockBot.editMessageTextCalls.some(m =>
            (m.text || '').includes('Appointment rescheduled') || (m.text || '').includes('تمت إعادة جدولة الموعد')
        );
        assert.strictEqual(successEdited, true, 'should edit message to reschedule success');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer confirm callback');

        // Verify DB state
        const { data: oldAppt } = await supabaseAdmin
            .from('appointments')
            .select('status, cancelled_at')
            .eq('id', appointment.id)
            .single();
        assert.strictEqual(oldAppt.status, 'cancelled', 'old appointment should be cancelled');
        assert.ok(oldAppt.cancelled_at, 'old appointment should have cancelled_at');

        const { data: oldSlot } = await supabaseAdmin
            .from('available_slots')
            .select('is_booked')
            .eq('id', oldSlotId)
            .single();
        assert.strictEqual(oldSlot.is_booked, false, 'old slot should be freed');

        const { data: newSlot } = await supabaseAdmin
            .from('available_slots')
            .select('is_booked')
            .eq('id', offeredSlotId)
            .single();
        assert.strictEqual(newSlot.is_booked, true, 'new slot should be booked');

        const { data: newAppointments } = await supabaseAdmin
            .from('appointments')
            .select('id, status, appointment_type, slot_id')
            .eq('patient_id', testIds.patientId)
            .eq('slot_id', offeredSlotId)
            .is('deleted_at', null);
        assert.strictEqual(newAppointments.length, 1, 'new appointment should be created');
        assert.strictEqual(newAppointments[0].status, 'confirmed');
        assert.strictEqual(newAppointments[0].appointment_type, appointment.appointment_type);

        // Clean up new appointment so other tests are not affected
        await supabaseAdmin.from('appointments').delete().eq('id', newAppointments[0].id);
    });

    it('confirm:<slotId>:checkup creates appointment and edits success summary', async () => {
        const chatId = `chat-${runId}`;
        const slotId = testIds.slotIds[0];

        await supabaseAdmin
            .from('conversation_history')
            .insert([
                { chat_id: chatId, role: 'state', content: 'READY' },
            ]);

        const query = {
            id: 'query-int-confirm',
            data: `confirm:${slotId}:checkup`,
            message: { chat: { id: chatId }, message_id: 300, text: 'Appointment Details' },
        };

        await new Promise((resolve) => {
            mockBot.emitCallback(query);
            setTimeout(resolve, 500);
        });

        const askNameSent = mockBot.sendMessageCalls.some(m =>
            (m.text || '').includes('full name') || (m.text || '').includes('اسمك')
        );
        const successEdited = mockBot.editMessageTextCalls.some(m =>
            (m.text || '').includes('Appointment confirmed') || (m.text || '').includes('تم تأكيد الموعد')
        );

        assert.strictEqual(askNameSent, false, 'should NOT ask for name after confirm');
        assert.strictEqual(successEdited, true, 'should edit message to success summary');
        assert.strictEqual(mockBot.answerCallbackQueryCalls.length, 1, 'should answer callback');

        // Verify DB state
        const { data: slot } = await supabaseAdmin.from('available_slots').select('is_booked').eq('id', slotId).single();
        assert.strictEqual(slot.is_booked, true, 'slot should be marked booked');

        const { data: appointments } = await supabaseAdmin
            .from('appointments')
            .select('id, status, appointment_type')
            .eq('patient_id', testIds.patientId)
            .eq('slot_id', slotId)
            .is('deleted_at', null);
        assert.strictEqual(appointments.length, 1, 'appointment should be created');
        assert.strictEqual(appointments[0].status, 'confirmed');
        assert.strictEqual(appointments[0].appointment_type, 'checkup');

        // Clean up appointment for other tests
        await supabaseAdmin.from('appointments').delete().eq('id', appointments[0].id);
    });
});
