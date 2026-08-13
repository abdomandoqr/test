import { describe, it, before, beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert';
import {
    supabaseAdmin,
    listOpenSlots,
    cancelAppointment,
    rescheduleAppointment,
    createAppointment,
    markSlotBooked,
    getSlotById,
} from '../src/services/supabaseService.js';

const runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const testIds = {
    dentistId: null,
    slotIds: [],
    patientId: null,
    appointmentIds: [],
};

async function cleanup() {
    if (testIds.appointmentIds.length > 0) {
        await supabaseAdmin.from('appointments').delete().in('id', testIds.appointmentIds);
    }
    if (testIds.patientId) {
        await supabaseAdmin.from('patients').delete().eq('id', testIds.patientId);
    }
    if (testIds.slotIds.length > 0) {
        await supabaseAdmin.from('available_slots').delete().in('id', testIds.slotIds);
    }
    if (testIds.dentistId) {
        await supabaseAdmin.from('dentists').delete().eq('id', testIds.dentistId);
    }
}

describe('supabase integration', () => {
    before(async () => {
        await cleanup();

        const { data: dentist } = await supabaseAdmin
            .from('dentists')
            .insert({ name: `Test Dentist ${runId}`, specialty: 'Test', is_active: true })
            .select()
            .single();
        testIds.dentistId = dentist.id;

        const now = new Date();
        const slotTimes = [
            new Date(now.getTime() + 1 * 60 * 60 * 1000), // 1h from now — inside lead time
            new Date(now.getTime() + 3 * 60 * 60 * 1000), // 3h from now — outside lead time
            new Date(now.getTime() + 5 * 60 * 60 * 1000), // 5h from now — outside lead time, for reschedule target
        ];

        const { data: slots } = await supabaseAdmin
            .from('available_slots')
            .insert(slotTimes.map(t => ({
                dentist_id: dentist.id,
                starts_at: t.toISOString(),
                duration_minutes: 30,
                buffer_minutes: 10,
                is_booked: false,
            })))
            .select();

        for (const slot of slots) {
            testIds.slotIds.push(slot.id);
        }

        const { data: patient } = await supabaseAdmin
            .from('patients')
            .insert({
                name: `Test Patient ${runId}`,
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
        await cleanup();
    });

    beforeEach(async () => {
        // Reset slot states and remove any appointments from previous tests.
        if (testIds.appointmentIds.length > 0) {
            await supabaseAdmin.from('appointments').delete().in('id', testIds.appointmentIds);
            testIds.appointmentIds = [];
        }
        for (const slotId of testIds.slotIds) {
            await supabaseAdmin.from('available_slots').update({ is_booked: false }).eq('id', slotId);
        }
    });

    it('listOpenSlots respects BOOKING_LEAD_HOURS and is_booked=false', async () => {
        const slots = await listOpenSlots({ limit: 10 });
        const slotIds = slots.map(s => s.id);
        assert.ok(slotIds.includes(testIds.slotIds[1]), '3h slot should be included (outside lead time)');
        assert.ok(slotIds.includes(testIds.slotIds[2]), '5h slot should be included');
        assert.ok(!slotIds.includes(testIds.slotIds[0]), '1h slot should be excluded (inside lead time)');
    });

    it('cancelAppointment marks appointment cancelled and frees slot', async () => {
        const [slotId] = testIds.slotIds.slice(1);
        await markSlotBooked(slotId, true);

        const { data: appt } = await supabaseAdmin
            .from('appointments')
            .insert({
                patient_id: testIds.patientId,
                slot_id: slotId,
                appointment_type: 'checkup',
                status: 'confirmed',
            })
            .select()
            .single();
        testIds.appointmentIds.push(appt.id);

        const cancelled = await cancelAppointment(appt.id, 'Test cancellation');
        assert.strictEqual(cancelled.status, 'cancelled');

        const slot = await getSlotById(slotId);
        assert.strictEqual(slot.is_booked, false, 'slot should be freed after cancel');
    });

    it('rescheduleAppointment swaps slots safely', async () => {
        const oldSlotId = testIds.slotIds[1];
        const newSlotId = testIds.slotIds[2];

        await markSlotBooked(oldSlotId, true);
        await markSlotBooked(newSlotId, false);

        const { data: appt, error: apptError } = await supabaseAdmin
            .from('appointments')
            .insert({
                patient_id: testIds.patientId,
                slot_id: oldSlotId,
                appointment_type: 'cleaning',
                status: 'confirmed',
            })
            .select()
            .single();
        assert.ifError(apptError);
        assert.ok(appt, 'appointment should be created');
        testIds.appointmentIds.push(appt.id);

        const result = await rescheduleAppointment({
            appointmentId: appt.id,
            newSlotId,
            appointmentType: 'cleaning',
        });

        assert.strictEqual(result.newAppointment.status, 'confirmed');
        assert.strictEqual(result.newAppointment.appointment_type, 'cleaning');
        assert.strictEqual(result.newAppointment.slot_id, newSlotId);

        const oldSlot = await getSlotById(oldSlotId);
        const newSlot = await getSlotById(newSlotId);
        assert.strictEqual(oldSlot.is_booked, false, 'old slot should be freed');
        assert.strictEqual(newSlot.is_booked, true, 'new slot should be booked');
    });
});
