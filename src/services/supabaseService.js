import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config, rules } from '../config.js';

const supabaseUrl = config.supabase.url
    ?.replace(/\/rest\/v1\/?$/, '')
    ?.replace(/\/$/, '');

export const supabaseAdmin = createClient(
    supabaseUrl,
    config.supabase.serviceRoleKey,
    {
        realtime: { transport: WebSocket },
    },
);

// Startup warnings — run exactly once at module load.
let startupWarningsDone = false;
async function startupWarnings() {
    if (startupWarningsDone) return;
    startupWarningsDone = true;
    try {
        const { count: dentistCount } = await supabaseAdmin
            .from('dentists')
            .select('id', { count: 'exact', head: true })
            .eq('is_active', true);
        if (!dentistCount || dentistCount === 0) {
            console.warn('⚠️  No active dentists in database. Bookings cannot be assigned.');
        }

        const { count: slotCount } = await supabaseAdmin
            .from('available_slots')
            .select('id', { count: 'exact', head: true })
            .eq('is_booked', false)
            .gte('starts_at', new Date().toISOString());
        if (!slotCount || slotCount === 0) {
            console.warn('⚠️  No open slots in database. Run scripts/seed_demo_slots.mjs to add demo slots.');
        } else {
            console.log(`[supabase:startup] open slots: ${slotCount}`);
        }
    } catch (err) {
        console.error('[supabase:startup] warning check failed:', err.message);
    }
}

// Fire-and-forget startup check
startupWarnings();

function logWrite(op, table, details) {
    const safe = { ...details };
    for (const k of Object.keys(safe)) {
        if (['phone', 'national_id', 'name', 'chat_id'].includes(k) && typeof safe[k] === 'string') {
            safe[k] = `${safe[k].slice(0, 3)}***`;
        }
    }
    console.log(`[supabase:write] ${op} ${table}`, JSON.stringify(safe));
}

export async function findPatientByChatId(chatId) {
    const { data, error } = await supabaseAdmin
        .from('patients')
        .select('*')
        .eq('chat_id', chatId)
        .is('deleted_at', null)
        .maybeSingle();

    if (error) throw new Error(`findPatientByChatId: ${error.message}`);
    return data;
}

export async function findPatientByPhone(phone) {
    const { data, error } = await supabaseAdmin
        .from('patients')
        .select('*')
        .eq('phone', phone)
        .is('deleted_at', null)
        .maybeSingle();

    if (error) throw new Error(`findPatientByPhone: ${error.message}`);
    return data;
}

export async function createPatient(patient) {
    const clean = Object.fromEntries(
        Object.entries(patient).filter(([, v]) => v !== null && v !== undefined),
    );

    const required = ['name', 'phone', 'chat_id', 'channel', 'country_code', 'date_of_birth', 'gender'];
    const missing = required.filter((k) => clean[k] === undefined || clean[k] === null || clean[k] === '');
    if (missing.length > 0) {
        throw new Error(`createPatient: missing required field(s): ${missing.join(', ')}`);
    }

    const validGenders = ['male', 'female'];
    if (!validGenders.includes(clean.gender)) {
        throw new Error(`createPatient: invalid gender "${clean.gender}"`);
    }

    logWrite('insert', 'patients', clean);
    const { data, error } = await supabaseAdmin
        .from('patients')
        .insert(clean)
        .select()
        .single();

    if (error) throw new Error(`createPatient: ${error.message}`);
    return data;
}

export async function updatePatient(id, updates) {
    const clean = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== null && v !== undefined),
    );
    if (Object.keys(clean).length === 0) {
        throw new Error('updatePatient: no non-null fields to update');
    }
    logWrite('update', 'patients', { id, ...clean });
    const { data, error } = await supabaseAdmin
        .from('patients')
        .update(clean)
        .eq('id', id)
        .select()
        .single();

    if (error) throw new Error(`updatePatient: ${error.message}`);
    return data;
}

export async function listActiveDentists() {
    const { data, error } = await supabaseAdmin
        .from('dentists')
        .select('id, name, specialty')
        .eq('is_active', true)
        .order('name');

    if (error) throw new Error(`listActiveDentists: ${error.message}`);
    return data || [];
}

export async function listOpenSlots({ dentistId = null, limit = 10 } = {}) {
    const minStart = new Date(Date.now() + rules.bookingLeadHours * 60 * 60 * 1000).toISOString();
    let q = supabaseAdmin
        .from('available_slots')
        .select(`
            id,
            starts_at,
            duration_minutes,
            buffer_minutes,
            dentist_id,
            dentist:dentists ( id, name, specialty )
        `)
        .eq('is_booked', false)
        .gte('starts_at', minStart)
        .order('starts_at', { ascending: true })
        .limit(limit);

    if (dentistId) q = q.eq('dentist_id', dentistId);

    const { data, error } = await q;
    if (error) throw new Error(`listOpenSlots: ${error.message}`);
    return data || [];
}

export async function getSlotById(slotId) {
    const { data, error } = await supabaseAdmin
        .from('available_slots')
        .select(`
            id,
            starts_at,
            is_booked,
            dentist:dentists ( id, name )
        `)
        .eq('id', slotId)
        .maybeSingle();
    if (error) throw new Error(`getSlotById: ${error.message}`);
    return data;
}

export async function markSlotBooked(slotId, isBooked) {
    logWrite('update', 'available_slots', { slot_id: slotId, is_booked: isBooked });
    const { error } = await supabaseAdmin
        .from('available_slots')
        .update({ is_booked: isBooked })
        .eq('id', slotId);
    if (error) throw new Error(`markSlotBooked: ${error.message}`);
}

export async function listAppointmentsByPatient(patientId) {
    const { data, error } = await supabaseAdmin
        .from('appointments')
        .select(`
            id,
            appointment_type,
            status,
            cancelled_at,
            cancellation_reason,
            slot:available_slots ( id, starts_at, dentist:dentists ( name ) )
        `)
        .eq('patient_id', patientId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

    if (error) throw new Error(`listAppointmentsByPatient: ${error.message}`);
    return data || [];
}

export async function createAppointment(appointment) {
    logWrite('insert', 'appointments', appointment);
    const { data, error } = await supabaseAdmin
        .from('appointments')
        .insert(appointment)
        .select()
        .single();
    if (error) throw new Error(`createAppointment: ${error.message}`);
    return data;
}

export async function cancelAppointment(id, reason) {
    logWrite('update', 'appointments', { id, status: 'cancelled', reason });
    const { data, error } = await supabaseAdmin
        .from('appointments')
        .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancellation_reason: reason || 'Cancelled by patient',
        })
        .eq('id', id)
        .select()
        .single();
    if (error) throw new Error(`cancelAppointment: ${error.message}`);
    return data;
}

export async function findNextActiveAppointment(patientId) {
    const { data, error } = await supabaseAdmin
        .from('appointments')
        .select(`
            id,
            appointment_type,
            status,
            patient_id,
            slot:available_slots ( id, starts_at, dentist:dentists ( id, name ) )
        `)
        .eq('patient_id', patientId)
        .in('status', ['scheduled', 'confirmed'])
        .is('deleted_at', null)
        .gte('slot.starts_at', new Date().toISOString());

    if (error) throw new Error(`findNextActiveAppointment: ${error.message}`);

    // Sort in JS: PostgREST fails to parse .order on the embedded alias `slot.starts_at`.
    const future = (data || [])
        .filter((a) => a.slot?.starts_at && new Date(a.slot.starts_at) >= new Date())
        .sort((a, b) => new Date(a.slot.starts_at) - new Date(b.slot.starts_at));

    return future.length > 0 ? future[0] : null;
}

export async function getAppointmentById(id) {
    const { data, error } = await supabaseAdmin
        .from('appointments')
        .select(`
            id,
            appointment_type,
            status,
            patient_id,
            slot_id,
            slot:available_slots ( id, starts_at, dentist:dentists ( id, name ) )
        `)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();

    if (error) throw new Error(`getAppointmentById: ${error.message}`);
    return data;
}

export async function rescheduleAppointment({ appointmentId, newSlotId, appointmentType }) {
    const old = await getAppointmentById(appointmentId);
    if (!old) {
        throw new Error('rescheduleAppointment: appointment not found');
    }
    if (!['scheduled', 'confirmed'].includes(old.status)) {
        throw new Error('rescheduleAppointment: appointment is not active');
    }

    const { data: newSlot, error: slotError } = await supabaseAdmin
        .from('available_slots')
        .select('id, is_booked, starts_at, dentist:dentists ( id, name )')
        .eq('id', newSlotId)
        .maybeSingle();

    if (slotError) throw new Error(`rescheduleAppointment: ${slotError.message}`);
    if (!newSlot) throw new Error('rescheduleAppointment: new slot not found');
    if (newSlot.is_booked) throw new Error('rescheduleAppointment: new slot is no longer available');

    await cancelAppointment(appointmentId, 'Rescheduled by patient');
    await markSlotBooked(newSlotId, true);

    const newAppointment = await createAppointment({
        patient_id: old.patient_id,
        slot_id: newSlotId,
        appointment_type: appointmentType || old.appointment_type,
        status: 'confirmed',
    });

    return { newAppointment, newSlot };
}

export async function updateAppointmentReminder(id, { reminder_24h_sent_at, reminder_1h_sent_at }) {
    const update = {};
    if (reminder_24h_sent_at !== undefined && reminder_24h_sent_at !== null) {
        update.reminder_24h_sent_at = reminder_24h_sent_at;
    }
    if (reminder_1h_sent_at !== undefined && reminder_1h_sent_at !== null) {
        update.reminder_1h_sent_at = reminder_1h_sent_at;
    }
    if (Object.keys(update).length === 0) {
        throw new Error('updateAppointmentReminder: no reminder fields to update');
    }

    logWrite('update', 'appointments', { id, ...update });
    const { data, error } = await supabaseAdmin
        .from('appointments')
        .update(update)
        .eq('id', id)
        .select()
        .single();

    if (error) throw new Error(`updateAppointmentReminder: ${error.message}`);
    return data;
}

export async function appendMessage(chatId, role, content) {
    logWrite('insert', 'conversation_history', { chat_id: chatId, role, content_len: content?.length });
    const { error } = await supabaseAdmin
        .from('conversation_history')
        .insert({ chat_id: chatId, role, content });
    if (error) throw new Error(`appendMessage: ${error.message}`);
}

export async function getRecentMessages(chatId, limit = 20) {
    const { data, error } = await supabaseAdmin
        .from('conversation_history')
        .select('role, content, created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw new Error(`getRecentMessages: ${error.message}`);
    return (data || []).reverse();
}