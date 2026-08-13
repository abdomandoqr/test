import { detectLanguage } from '../utils/language.js';
import * as supabase from '../services/supabaseService.js';
import { askGemini } from '../services/geminiService.js';
import { route, isAck } from './intentHandler.js';
import { sendTyping, sendMessage, sendInlineKeyboard } from '../services/telegramService.js';
import { t } from '../utils/templates.js';
import { isValidName, displayName } from '../utils/validation.js';
import { normalizePhone } from '../utils/phone.js';
import { readState, writeState, resetState, readPendingBooking, writePendingBooking, clearPendingBooking } from '../utils/state.js';

const DOB_PLACEHOLDER = '1970-01-01';
const GENDER_PLACEHOLDER = 'male';

async function promptIdentityConfirmation(chatId, patient, lang, ctx) {
    await writePendingBooking(supabase.supabaseAdmin, chatId, ctx.text || '', ctx.intent || 'book');
    await writeState(supabase.supabaseAdmin, chatId, 'AWAITING_BOOKING_IDENTITY_CONFIRM');
    const name = patient?.name || '';
    const phone = patient?.phone || '';
    const body = t('confirmIdentity', lang).replace('{{name}}', name).replace('{{phone}}', phone);
    const buttons = [
        [{ text: t('identityYesBtn', lang), callback_data: 'identity_yes' }],
        [{ text: t('identityFixBtn', lang), callback_data: 'identity_fix' }],
    ];
    await sendInlineKeyboard(chatId, body, buttons);
}

async function findPendingName(chatId) {
    const recent = await supabase.getRecentMessages(chatId, 20);
    const userMsgs = recent.filter((m) => m.role === 'user');
    if (userMsgs.length >= 2) {
        const nameMsg = userMsgs[userMsgs.length - 2];
        if (isValidName(nameMsg.content)) return displayName(nameMsg.content);
    }
    for (let i = userMsgs.length - 1; i >= 0; i--) {
        const content = displayName(userMsgs[i].content);
        if (isValidName(content)) return content;
    }
    return '';
}

export async function handleMessage(msg) {
    const chatId = msg.chat.id.toString();
    const text = (msg.text || '').trim();
    const lang = detectLanguage(text);

    try {
        await sendTyping(chatId);

        let patient = await supabase.findPatientByChatId(chatId);
        const state = await readState(supabase.supabaseAdmin, chatId);

        const patientExists = patient !== null;
        const hasName = !!(patient && patient.name);
        const hasPhone = !!(patient && patient.phone);

        console.log(`[BRANCH] state=${state} text_len=${text.length}`);

        // ── /start ────────────────────────────────────────────────────────
        if (msg.text === '/start') {
            if (patientExists && hasName && hasPhone) {
                await writeState(supabase.supabaseAdmin, chatId, 'READY');
                await sendMessage(chatId, t('readyToBook', lang));
                return;
            }
            await resetState(supabase.supabaseAdmin, chatId);
            await sendMessage(chatId, t('welcome', lang));
            const askNameMsg = t('askName', lang);
            await sendMessage(chatId, askNameMsg);
            await supabase.appendMessage(chatId, 'user', text);
            await supabase.appendMessage(chatId, 'assistant', askNameMsg);
            return;
        }

        // ── /restart ──────────────────────────────────────────────────────
        if (msg.text === '/restart') {
            await resetState(supabase.supabaseAdmin, chatId);
            const restartMsg = t('restart', lang);
            await sendMessage(chatId, restartMsg);
            const askNameMsg = t('askName', lang);
            await sendMessage(chatId, askNameMsg);
            await supabase.appendMessage(chatId, 'user', text);
            await supabase.appendMessage(chatId, 'assistant', restartMsg);
            await supabase.appendMessage(chatId, 'assistant', askNameMsg);
            return;
        }

        // ── READY ── Gemini + booking + FAQ ─────────────────────────────
        if (state === 'READY') {
            // Short-ack safety net: before paying for a Gemini call, check
            // whether the user just said "ok / thanks / حسنا / etc.".
            // Acks must NEVER route to book/cancel/reschedule.
            if (isAck(text)) {
                console.log(`[INTENT] short ack intercepted before askGemini`);
                const ackMsg = t('ackPrompt', lang);
                await supabase.appendMessage(chatId, 'user', text);
                await supabase.appendMessage(chatId, 'assistant', ackMsg);
                await sendMessage(chatId, ackMsg);
                return;
            }

            const slots = await supabase.listOpenSlots({ limit: 5 });
            console.log(`[SLOTS] count=${slots.length}`);

            const recent = await supabase.getRecentMessages(chatId, 10);
            const context = {
                name: patient.name,
                phone: patient.phone,
                countryCode: patient.country_code,
                availableSlots: slots,
                conversationHistory: recent,
                state: 'READY',
            };

            const { reply, intent } = await askGemini(text, context);
            console.log(`[INTENT] ${intent.intent}`);

            if (intent.intent === 'book' || intent.intent === 'reschedule') {
                await promptIdentityConfirmation(chatId, patient, lang, { text, intent: intent.intent });
                await supabase.appendMessage(chatId, 'user', text);
                const identityBody = t('confirmIdentity', lang)
                    .replace('{{name}}', patient?.name || '')
                    .replace('{{phone}}', patient?.phone || '');
                await supabase.appendMessage(chatId, 'assistant', identityBody);
                return;
            }

            if (intent.intent === 'cancel') {
                await route(chatId, patient.id, 'cancel', lang, { text, slots, reply });
                return;
            }

            if (intent.intent === 'status') {
                await route(chatId, patient.id, 'status', lang, { text, slots, reply });
                return;
            }

            await supabase.appendMessage(chatId, 'user', text);
            await supabase.appendMessage(chatId, 'assistant', reply);

            if (['book', 'cancel', 'reschedule', 'status', 'info'].includes(intent.intent)) {
                await route(chatId, patient.id, intent.intent, lang, { text, slots, reply });
            } else {
                await sendMessage(chatId, reply);
            }
            return;
        }

        // ── AWAITING_BOOKING_IDENTITY_CONFIRM ─────────────────────────────
        if (state === 'AWAITING_BOOKING_IDENTITY_CONFIRM') {
            // Free text should not skip the gate; resend confirmation.
            const { text: pendingText, intent: pendingIntent } = await readPendingBooking(supabase.supabaseAdmin, chatId);
            await promptIdentityConfirmation(chatId, patient, lang, { text: pendingText, intent: pendingIntent });
            return;
        }

        // ── AWAITING_REVERIFY_NAME ────────────────────────────────────────
        if (state === 'AWAITING_REVERIFY_NAME') {
            console.log(`[REVERIFY_NAME] text_len=${text.length}`);
            if (!isValidName(text)) {
                await sendMessage(chatId, t('askName', lang));
                return;
            }
            if (patient && patient.id) {
                await supabase.updatePatient(patient.id, { name: displayName(text) });
                console.log(`[REVERIFY_NAME] updated id=${patient.id}`);
            }
            await writeState(supabase.supabaseAdmin, chatId, 'AWAITING_REVERIFY_PHONE');
            const askPhoneMsg = t('askPhone', lang);
            await sendMessage(chatId, askPhoneMsg);
            await supabase.appendMessage(chatId, 'user', text);
            await supabase.appendMessage(chatId, 'assistant', askPhoneMsg);
            return;
        }

        // ── AWAITING_REVERIFY_PHONE ───────────────────────────────────────
        if (state === 'AWAITING_REVERIFY_PHONE') {
            const normalized = normalizePhone(text);
            console.log(`[REVERIFY_PHONE] country=${normalized ? normalized.countryCode : 'null'} status=${normalized ? 'valid' : 'invalid'}`);
            if (!normalized) {
                await sendMessage(chatId, t('askPhone', lang));
                return;
            }
            if (patient && patient.id) {
                await supabase.updatePatient(patient.id, {
                    phone: normalized.phone,
                    country_code: normalized.countryCode,
                });
                console.log(`[REVERIFY_PHONE] updated id=${patient.id}`);
            }
            // Reload patient with updated data
            patient = await supabase.findPatientByChatId(chatId);
            await writeState(supabase.supabaseAdmin, chatId, 'AWAITING_BOOKING_IDENTITY_CONFIRM');
            const { text: pendingText, intent: pendingIntent } = await readPendingBooking(supabase.supabaseAdmin, chatId);
            await promptIdentityConfirmation(chatId, patient, lang, { text: pendingText, intent: pendingIntent });
            await supabase.appendMessage(chatId, 'user', text);
            return;
        }

        // ── AWAITING_PHONE ────────────────────────────────────────────────
        if (state === 'AWAITING_PHONE' || (patientExists && hasName && !hasPhone)) {
            const normalized = normalizePhone(text);
            console.log(`[PHONE] country=${normalized ? normalized.countryCode : 'null'} status=${normalized ? 'valid' : 'invalid'}`);

            if (!normalized) {
                await sendMessage(chatId, t('askPhone', lang));
                return;
            }

            if (patientExists && patient.id) {
                patient = await supabase.updatePatient(patient.id, {
                    phone: normalized.phone,
                    country_code: normalized.countryCode,
                });
            } else {
                const name = await findPendingName(chatId);
                if (!name) {
                    await writeState(supabase.supabaseAdmin, chatId, 'AWAITING_NAME');
                    await sendMessage(chatId, t('askName', lang));
                    return;
                }
                const payload = {
                    chat_id: chatId,
                    name,
                    phone: normalized.phone,
                    channel: 'telegram', // transport adapter boundary: today Telegram is the only inbound channel; future adapter should pass 'telegram' | 'whatsapp'
                    country_code: normalized.countryCode,
                    date_of_birth: DOB_PLACEHOLDER,
                    gender: GENDER_PLACEHOLDER,
                };
                console.log(`[CREATE_PATIENT] chat_id=${(payload.chat_id || '').slice(0, 3)}*** name=${(payload.name || '').slice(0, 2)}*** phone=${(payload.phone || '').slice(0, 4)}***`);
                try {
                    patient = await supabase.createPatient(payload);
                    console.log(`[CREATE_PATIENT] success id=${patient?.id}`);
                } catch (err) {
                    console.error(`[CREATE_PATIENT] failed: ${err.message}`);
                    if (err.message.includes('duplicate') || err.message.includes('unique')) {
                        const existing = await supabase.findPatientByPhone(normalized.phone);
                        if (existing && existing.chat_id === chatId) {
                            patient = existing;
                            console.log(`[CREATE_PATIENT] using existing same-chat patient id=${patient?.id}`);
                        } else {
                            throw err;
                        }
                    } else {
                        throw err;
                    }
                }
            }

            await writeState(supabase.supabaseAdmin, chatId, 'READY');
            const readyMsg = t('readyToBook', lang);
            await sendMessage(chatId, readyMsg);
            await supabase.appendMessage(chatId, 'user', text);
            await supabase.appendMessage(chatId, 'assistant', readyMsg);
            return;
        }

        // ── AWAITING_NAME / NEW ───────────────────────────────────────────
        if (!isValidName(text)) {
            await sendMessage(chatId, t('askName', lang));
            return;
        }

        await supabase.appendMessage(chatId, 'user', text);
        await writeState(supabase.supabaseAdmin, chatId, 'AWAITING_PHONE');
        const askPhoneMsg = t('askPhone', lang);
        await sendMessage(chatId, askPhoneMsg);
        await supabase.appendMessage(chatId, 'assistant', askPhoneMsg);
        return;
    } catch (err) {
        console.error('❌ handleMessage error:', err.message);
        console.error(err.stack);
        try {
            await sendMessage(chatId, t('genericError', lang));
        } catch {
            // best-effort error reply
        }
    }
}