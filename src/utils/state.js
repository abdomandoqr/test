/**
 * Per-chat state machine persisted in conversation_history.
 *
 * States:
 *   NEW            – no patient row yet, initial /start
 *   AWAITING_NAME  – waiting for a valid full name
 *   AWAITING_PHONE – waiting for a valid phone number
 *   READY          – name + phone collected; can book / FAQ / help
 *   AWAITING_BOOKING_CONFIRM – booking offer shown, waiting for ✅/❌
 *   AWAITING_BOOKING_IDENTITY_CONFIRM – identity card shown, waiting for ✅ نعم / ❌ تصحيح
 *   AWAITING_REVERIFY_NAME  – re-collecting name for an existing patient
 *   AWAITING_REVERIFY_PHONE – re-collecting phone for an existing patient
 */

const STATE_ROW_ROLE = 'state';

export async function readState(supabaseAdmin, chatId) {
    const { data, error } = await supabaseAdmin
        .from('conversation_history')
        .select('content')
        .eq('chat_id', chatId)
        .eq('role', STATE_ROW_ROLE)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(`readState: ${error.message}`);
    return data?.content || 'NEW';
}

export async function writeState(supabaseAdmin, chatId, newState) {
    const { error } = await supabaseAdmin
        .from('conversation_history')
        .insert({ chat_id: chatId, role: STATE_ROW_ROLE, content: newState });
    if (error) throw new Error(`writeState: ${error.message}`);
}

export async function resetState(supabaseAdmin, chatId) {
    const { error } = await supabaseAdmin
        .from('conversation_history')
        .delete()
        .eq('chat_id', chatId)
        .eq('role', STATE_ROW_ROLE);
    if (error) throw new Error(`resetState: ${error.message}`);
    await writeState(supabaseAdmin, chatId, 'NEW');
}

export const STATES = ['NEW', 'AWAITING_NAME', 'AWAITING_PHONE', 'READY', 'AWAITING_BOOKING_CONFIRM', 'AWAITING_BOOKING_IDENTITY_CONFIRM', 'AWAITING_REVERIFY_NAME', 'AWAITING_REVERIFY_PHONE'];

export async function readPendingBooking(supabaseAdmin, chatId) {
    const { data, error } = await supabaseAdmin
        .from('conversation_history')
        .select('content')
        .eq('chat_id', chatId)
        .eq('role', 'pending_booking')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(`readPendingBooking: ${error.message}`);
    const raw = data?.content || '';
    if (!raw) return { text: '', intent: 'book' };
    // Backward compatibility: legacy rows stored raw text only.
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'text' in parsed) {
            return {
                text: parsed.text || '',
                intent: parsed.intent || 'book',
            };
        }
    } catch {
        // not JSON — fall through to legacy raw-text handling
    }
    return { text: raw, intent: 'book' };
}

export async function writePendingBooking(supabaseAdmin, chatId, text, intent = 'book') {
    const payload = JSON.stringify({
        chat_id: chatId,
        text: text || '',
        intent: intent || 'book',
        created_at: new Date().toISOString(),
    });
    const { error } = await supabaseAdmin
        .from('conversation_history')
        .insert({ chat_id: chatId, role: 'pending_booking', content: payload });
    if (error) throw new Error(`writePendingBooking: ${error.message}`);
}

export async function clearPendingBooking(supabaseAdmin, chatId) {
    const { error } = await supabaseAdmin
        .from('conversation_history')
        .delete()
        .eq('chat_id', chatId)
        .eq('role', 'pending_booking');
    if (error) throw new Error(`clearPendingBooking: ${error.message}`);
}

export async function readPendingReschedule(supabaseAdmin, chatId) {
    const { data, error } = await supabaseAdmin
        .from('conversation_history')
        .select('content')
        .eq('chat_id', chatId)
        .eq('role', 'pending_reschedule')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(`readPendingReschedule: ${error.message}`);
    const raw = data?.content || '';
    if (!raw) return { appointmentId: '', appointmentType: '' };
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return {
                appointmentId: parsed.appointmentId || '',
                appointmentType: parsed.appointmentType || '',
            };
        }
    } catch {
        // ignore parse error
    }
    return { appointmentId: '', appointmentType: '' };
}

export async function writePendingReschedule(supabaseAdmin, chatId, appointmentId, appointmentType = '') {
    const payload = JSON.stringify({
        chat_id: chatId,
        appointmentId,
        appointmentType,
        created_at: new Date().toISOString(),
    });
    const { error } = await supabaseAdmin
        .from('conversation_history')
        .insert({ chat_id: chatId, role: 'pending_reschedule', content: payload });
    if (error) throw new Error(`writePendingReschedule: ${error.message}`);
}

export async function clearPendingReschedule(supabaseAdmin, chatId) {
    const { error } = await supabaseAdmin
        .from('conversation_history')
        .delete()
        .eq('chat_id', chatId)
        .eq('role', 'pending_reschedule');
    if (error) throw new Error(`clearPendingReschedule: ${error.message}`);
}