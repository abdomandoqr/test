import { bot } from './services/telegramService.js';
import { handleMessage } from './handlers/messageHandler.js';
import { handler } from './handlers/intentHandler.js';
import { detectLanguage } from './utils/language.js';
import * as supabase from './services/supabaseService.js';
import { sendMessage, editMessageText } from './services/telegramService.js';
import { t } from './utils/templates.js';
import { readPendingBooking, clearPendingBooking, writeState, readPendingReschedule, clearPendingReschedule } from './utils/state.js';
import { rules } from './config.js';

function formatSlotDate(iso) {
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = days[d.getUTCDay()];
        const date = d.getUTCDate();
        const month = months[d.getUTCMonth()];
        const year = d.getUTCFullYear();
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        return `${day} ${date} ${month} ${year}, ${hh}:${mm}`;
    } catch {
        return String(iso);
    }
}

// Normalized inbound message shape for future multi-channel adapter:
// { channel: 'telegram', senderId: chatId, text: msg.text, raw: msg }
export async function handleTelegramMessage(msg) {
    console.log('📩 Received message: chat_id=*** text_len=', msg.text?.length);
    try {
        await handleMessage(msg);
    } catch (err) {
        console.error('❌ bot.on(message) error:', err.message);
        console.error(err.stack);
    }
}

bot.on('message', (msg) => handleTelegramMessage(msg));

const CONFIRM_RE = /^confirm:([^:]+):([^:]+)$/;
const CANCEL_RE = /^cancel:([^:]+)$/;
const CANCEL_APPOINTMENT_RE = /^cancel_appointment:([^:]+)$/;
const CONFIRM_CANCEL_RE = /^confirm_cancel:([^:]+)$/;
const RESCHEDULE_APPOINTMENT_RE = /^rs:([^:]+)$/;
const CONFIRM_RESCHEDULE_RE = /^crs:([^:]+)$/;

// Telegram-specific channel adapter boundary: callback queries are a
// Telegram-only interaction concept. A future WhatsApp adapter would
// translate its equivalent interactions into the same handler entry points.
export async function handleTelegramCallback(query) {
    const data = query.data;
    const chatId = query.message.chat.id.toString();
    const lang = detectLanguage(query.message.text || '');

    console.log(`[CALLBACK] data=${data} chat_id=${(chatId || '').slice(0, 3)}***`);

    try {
        const confirmMatch = data.match(CONFIRM_RE);
        const cancelMatch = data.match(CANCEL_RE);
        const cancelAppointmentMatch = data.match(CANCEL_APPOINTMENT_RE);
        const confirmCancelMatch = data.match(CONFIRM_CANCEL_RE);
        const rescheduleAppointmentMatch = data.match(RESCHEDULE_APPOINTMENT_RE);
        const confirmRescheduleMatch = data.match(CONFIRM_RESCHEDULE_RE);

        if (data === 'identity_yes') {
            console.log(`[IDENTITY] yes branch`);
            // Answer the callback immediately so Telegram does not time out while we fetch DB state.
            await bot.answerCallbackQuery(query.id, { text: t('ackPrompt', lang), show_alert: false });

            const patient = await supabase.findPatientByChatId(chatId);
            if (!patient) {
                console.log(`[IDENTITY] yes: patient not found`);
                await sendMessage(chatId, t('notRecognized', lang));
                return;
            }
            const { text: pendingText, intent: pendingIntent } = await readPendingBooking(supabase.supabaseAdmin, chatId);
            console.log(`[IDENTITY] yes: patient=${patient?.id} pendingIntent=${pendingIntent}`);
            await clearPendingBooking(supabase.supabaseAdmin, chatId);
            await writeState(supabase.supabaseAdmin, chatId, 'READY');

            try {
                if (pendingIntent === 'reschedule') {
                    await handler.reschedule(chatId, patient.id, lang, { text: pendingText });
                } else {
                    await handler.book(chatId, patient.id, lang, { text: pendingText });
                }
                console.log(`[IDENTITY] yes: slot offer sent`);
            } catch (slotErr) {
                console.error(`[IDENTITY] yes: error offering slots: ${slotErr.message}`);
                console.error(slotErr.stack);
                await sendMessage(chatId, t('genericError', lang));
            }
            return;
        }

        if (data === 'identity_fix') {
            console.log(`[IDENTITY] fix branch`);
            await bot.answerCallbackQuery(query.id, { text: t('askName', lang), show_alert: false });
            await writeState(supabase.supabaseAdmin, chatId, 'AWAITING_REVERIFY_NAME');
            await sendMessage(chatId, t('askName', lang));
            return;
        }

        if (cancelAppointmentMatch) {
            const patient = await supabase.findPatientByChatId(chatId);
            if (!patient) {
                await sendMessage(chatId, t('notRecognized', lang));
                await bot.answerCallbackQuery(query.id, { text: t('notRecognized', lang), show_alert: false });
                return;
            }
            await bot.answerCallbackQuery(query.id, { text: '', show_alert: false });
            await handler.cancel(chatId, patient.id, lang);
            return;
        }

        if (confirmCancelMatch) {
            const [, id] = confirmCancelMatch;
            await supabase.cancelAppointment(id, 'Cancelled by patient via bot');
            await editMessageText(chatId, query.message.message_id, t('cancelSuccess', lang), []);
            await bot.answerCallbackQuery(query.id, { text: t('cancelSuccess', lang), show_alert: false });
            return;
        }

        if (data === 'back:cancel') {
            await editMessageText(chatId, query.message.message_id, t('ackPrompt', lang), []);
            await bot.answerCallbackQuery(query.id, { text: t('ackPrompt', lang), show_alert: false });
            return;
        }

        if (rescheduleAppointmentMatch) {
            const [, appointmentId] = rescheduleAppointmentMatch;
            console.log(`[RESCHEDULE] raw_data=${data} chat_id=${chatId} appointment_id=${appointmentId} len=${data.length}`);
            const patient = await supabase.findPatientByChatId(chatId);
            if (!patient) {
                console.log('[RESCHEDULE] patient not found');
                await sendMessage(chatId, t('notRecognized', lang));
                await bot.answerCallbackQuery(query.id, { text: t('notRecognized', lang), show_alert: false });
                return;
            }
            await bot.answerCallbackQuery(query.id, { text: '', show_alert: false });
            try {
                console.log(`[RESCHEDULE] calling handler.reschedule patient_id=${patient.id}`);
                await handler.reschedule(chatId, patient.id, lang, {});
                console.log('[RESCHEDULE] slot offer sent');
            } catch (rescheduleErr) {
                console.error('[RESCHEDULE] handler.reschedule error:', rescheduleErr.message);
                console.error(rescheduleErr.stack);
                await sendMessage(chatId, t('genericError', lang));
            }
            return;
        }

        if (confirmRescheduleMatch) {
            const [, slotId] = confirmRescheduleMatch;
            console.log(`[CONFIRM_RESCHEDULE] raw_data=${data} chat_id=${chatId} slot_id=${slotId} len=${data.length}`);
            const patient = await supabase.findPatientByChatId(chatId);
            if (!patient) {
                console.log('[CONFIRM_RESCHEDULE] patient not found');
                await sendMessage(chatId, t('notRecognized', lang));
                await bot.answerCallbackQuery(query.id, { text: t('notRecognized', lang), show_alert: false });
                return;
            }
            const pending = await readPendingReschedule(supabase.supabaseAdmin, chatId);
            console.log(`[CONFIRM_RESCHEDULE] pending appointment_id=${pending.appointmentId || 'null'} type=${pending.appointmentType || 'null'}`);
            if (!pending.appointmentId) {
                console.log('[CONFIRM_RESCHEDULE] no pending reschedule state');
                await sendMessage(chatId, t('noAppointments', lang));
                await bot.answerCallbackQuery(query.id, { text: t('noAppointments', lang), show_alert: true });
                return;
            }
            const slot = await supabase.getSlotById(slotId);
            console.log(`[CONFIRM_RESCHEDULE] slot=${slot ? 'found' : 'not found'} is_booked=${slot?.is_booked} starts_at=${slot?.starts_at || 'null'}`);
            if (!slot || slot.is_booked) {
                console.log('[CONFIRM_RESCHEDULE] slot unavailable');
                await editMessageText(chatId, query.message.message_id, t('slotTaken', lang), []);
                await bot.answerCallbackQuery(query.id, { text: t('slotTaken', lang), show_alert: true });
                return;
            }
            try {
                const { newAppointment, newSlot } = await supabase.rescheduleAppointment({
                    appointmentId: pending.appointmentId,
                    newSlotId: slotId,
                    appointmentType: pending.appointmentType,
                });
                await clearPendingReschedule(supabase.supabaseAdmin, chatId);
                console.log('[CONFIRM_RESCHEDULE] appointment rescheduled');
                const successText = t('rescheduleSuccess', lang)
                    .replace('{{date}}', formatSlotDate(newSlot.starts_at))
                    .replace('{{dentist}}', newSlot.dentist?.name || '')
                    .replace('{{appointmentType}}', newAppointment.appointment_type);
                await editMessageText(chatId, query.message.message_id, successText, []);
                await bot.answerCallbackQuery(query.id, { text: successText, show_alert: false });
            } catch (rescheduleErr) {
                console.error('[CONFIRM_RESCHEDULE] rescheduleAppointment error:', rescheduleErr.message);
                console.error(rescheduleErr.stack);
                await sendMessage(chatId, t('genericError', lang));
                await bot.answerCallbackQuery(query.id, { text: 'Error processing your request', show_alert: false });
            }
            return;
        }

        if (data === 'crs_cancel') {
            await clearPendingReschedule(supabase.supabaseAdmin, chatId);
            await editMessageText(chatId, query.message.message_id, t('cancelled', lang), []);
            await bot.answerCallbackQuery(query.id, { text: t('cancelled', lang), show_alert: false });
            return;
        }

        if (confirmMatch) {
            const [, slotId, appointmentType] = confirmMatch;
            const now = new Date();
            const minStart = new Date(now.getTime() + rules.bookingLeadHours * 60 * 60 * 1000);
            console.log(`[CONFIRM] raw_data=${data} chat_id=${chatId} parsed_slot_id=${slotId} type=${appointmentType} now=${now.toISOString()} lead=${minStart.toISOString()}`);

            const patient = await supabase.findPatientByChatId(chatId);
            if (!patient) {
                console.log('[CONFIRM] patient not found');
                await sendMessage(chatId, t('notRecognized', lang));
                await bot.answerCallbackQuery(query.id, { text: t('notRecognized', lang), show_alert: true });
                return;
            }

            // Race/staleness guard: verify the slot is still available and far enough in the future.
            let slot;
            let slotError;
            try {
                slot = await supabase.getSlotById(slotId);
            } catch (err) {
                slotError = err;
                console.error(`[CONFIRM] getSlotById exception for slot_id=${slotId}: ${err.message}`);
            }
            const slotStart = slot?.starts_at ? new Date(slot.starts_at) : null;
            const isBooked = !!slot?.is_booked;
            const isPast = slotStart ? slotStart <= now : false;
            const isTooSoon = slotStart ? slotStart <= minStart : false;
            console.log(`[CONFIRM] slot_result=${slot ? 'found' : slotError ? 'error' : 'null'} row=${JSON.stringify(slot)} is_booked=${isBooked} is_past=${isPast} is_too_soon=${isTooSoon}`);

            async function handleUnavailableSlot(reason) {
                console.log(`[CONFIRM] unavailable reason=${reason}`);
                await editMessageText(chatId, query.message.message_id, t('slotTaken', lang), []);
                await bot.answerCallbackQuery(query.id, { text: t('slotTaken', lang), show_alert: true });
                // Auto-re-offer a fresh slot without asking for name or resetting onboarding.
                try {
                    console.log('[CONFIRM] offering fresh slot');
                    await handler.book(chatId, patient.id, lang, { text: appointmentType || 'book' });
                } catch (reofferErr) {
                    console.error('[CONFIRM] re-offer error:', reofferErr.message);
                    // Ensure the user sees a next step even if re-offer crashes.
                    await sendMessage(chatId, t('noSlots', lang));
                }
            }

            if (slotError || !slot || isBooked || isPast || isTooSoon) {
                const reason = slotError ? 'slot_query_error' : !slot ? 'slot_not_found' : isBooked ? 'slot_booked' : isPast ? 'slot_past' : 'slot_too_soon';
                await handleUnavailableSlot(reason);
                return;
            }

            try {
                await supabase.createAppointment({
                    patient_id: patient.id,
                    slot_id: slotId,
                    appointment_type: appointmentType || 'checkup',
                    status: 'confirmed',
                });
                console.log('[CONFIRM] appointment created');
            } catch (createErr) {
                console.error('[CONFIRM] createAppointment error:', createErr.message);
                // Only slot-level unique errors are treated as "taken";
                // patient-level active-appointment errors must surface correctly.
                if (/appointments_unique_slot/i.test(createErr.message)) {
                    await handleUnavailableSlot('slot_unique_violation');
                    return;
                }
                if (/idx_appointments_one_active_per_patient/i.test(createErr.message)) {
                    await editMessageText(chatId, query.message.message_id, t('activeAppointmentExists', lang), []);
                    await bot.answerCallbackQuery(query.id, { text: t('activeAppointmentExists', lang), show_alert: true });
                    return;
                }
                throw createErr;
            }

            try {
                await supabase.markSlotBooked(slotId, true);
                console.log('[CONFIRM] slot marked booked');
            } catch (markErr) {
                console.error('[CONFIRM] markSlotBooked error:', markErr.message);
                // Slot already marked booked by another path; continue to summary.
            }

            const dateFormatted = slot.starts_at ? formatSlotDate(slot.starts_at) : '';
            const dentistName = slot.dentist?.name || '';
            const typeLabel = appointmentType || 'checkup';
            const summaryText = t('bookingSummary', lang)
                .replace('{{date}}', dateFormatted)
                .replace('{{dentist}}', dentistName)
                .replace('{{appointmentType}}', typeLabel);

            try {
                await editMessageText(chatId, query.message.message_id, summaryText, []);
                console.log('[CONFIRM] summary edited');
            } catch (editErr) {
                console.error('[CONFIRM] editMessageText error:', editErr.message);
                // Fallback: send a fresh success message so the user isn't left with an error.
                await sendMessage(chatId, summaryText);
            }

            await bot.answerCallbackQuery(query.id, {
                text: t('booked', lang),
                show_alert: false,
            });
        } else if (cancelMatch) {
            const [, slotId] = cancelMatch;

            const cancelledText = `❌ ${t('cancelled', lang)}`;
            await editMessageText(
                chatId,
                query.message.message_id,
                cancelledText,
                [],
            );

            await bot.answerCallbackQuery(query.id, {
                text: t('cancelled', lang),
                show_alert: false,
            });
        } else {
            await bot.answerCallbackQuery(query.id, {
                text: 'Unknown action',
                show_alert: false,
            });
        }
    } catch (err) {
        console.error('❌ bot.on(callback_query) error:', err.message);
        console.error(err.stack);
        try {
            await bot.answerCallbackQuery(query.id, {
                text: 'Error processing your request',
                show_alert: false,
            });
        } catch {
            // best-effort error handling
        }
    }
}

bot.on('callback_query', (query) => handleTelegramCallback(query));