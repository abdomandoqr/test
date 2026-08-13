import { t } from '../utils/templates.js';
import * as supabase from '../services/supabaseService.js';
import { sendMessage, sendInlineKeyboard } from '../services/telegramService.js';
import { rules } from '../config.js';
import { writePendingReschedule, clearPendingReschedule } from '../utils/state.js';

const APPOINTMENT_TYPES = {
    checkup: ['checkup', 'فحص', 'كشف'],
    cleaning: ['cleaning', 'تنظيف'],
    extraction: ['extraction', 'خلع'],
    filling: ['filling', 'حشو'],
    orthodontics: ['orthodontics', 'تقويم'],
};

const EMERGENCY_KEYWORDS = ['emergency', 'طوارئ', 'urgent'];

// Short acknowledgements that must NOT trigger booking.
// Exact list per spec — do not add extras (e.g. "fine", "alright", "أوكي").
// English: ok, okay, thanks, thank you, I understand, got it, sure, yes, cool
// Arabic: حسنا، حسنًا، تمام، طيب، شكرًا، شكرا، حاضر، موافق، فهمت، ماشي
const ACK_PATTERNS = [
    /^(ok|okay|thanks|thank\s+you|i\s+understand|got\s+it|sure|yes|cool)[\s.,!?]*$/i,
    /^(حسنا|حسنًا|تمام|طيب|شكرا|شكرًا|حاضر|موافق|فهمت|ماشي)[\s.,!؟،]*$/u,
];

export function isAck(text) {
    const t = (text || '').trim().toLowerCase();
    if (t.length === 0 || t.length > 30) return false; // long messages are not acks
    return ACK_PATTERNS.some(re => re.test(t));
}

function detectAppointmentType(text, defaultType = 'checkup') {
    const lower = (text || '').toLowerCase();
    for (const emergency of EMERGENCY_KEYWORDS) {
        if (lower.includes(emergency)) return 'emergency';
    }
    for (const [type, keywords] of Object.entries(APPOINTMENT_TYPES)) {
        for (const kw of keywords) {
            if (lower.includes(kw.toLowerCase())) return type;
        }
    }
    return defaultType;
}

export function formatSlot(iso) {
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

const lastSlotIndex = new Map();

function sectionedInfoReply(text, lang) {
    const lower = (text || '').toLowerCase();
    if (/hour|ساع|وقت|متى/.test(lower)) return t('clinicHours', lang);
    if (/service|خدم|تنظيف|فحص|خلع|حشو|تقويم/.test(lower)) return t('services', lang);
    if (/address|عنوان|موقع|فين|أين|اين/.test(lower)) return t('address', lang);
    if (/first\s+visit|أول\s+زيارة|هوية|سجل/.test(lower)) return t('firstVisit', lang);
    if (/emergency|urg|طوارئ|حادث|حادثة/.test(lower)) return t('emergency', lang);
    return null;
}

function buildAppointmentSummaryText(appointment, lang) {
    const when = formatSlot(appointment.slot?.starts_at);
    const dentistName = appointment.slot?.dentist?.name || '—';
    return t('appointmentSummary', lang)
        .replace('{{date}}', when)
        .replace('{{dentist}}', dentistName)
        .replace('{{appointmentType}}', appointment.appointment_type);
}

const handler = {
    async book(chatId, userId, lang, ctx = {}) {
        if (!userId) {
            return sendMessage(chatId, t('welcome', lang));
        }

        const text = ctx.text || '';

        // Hard guard: short acks must NEVER trigger booking
        if (isAck(text)) {
            console.log(`[INTENT] short ack detected in book() — replying with helpful prompt instead`);
            return sendMessage(chatId, t('ackPrompt', lang));
        }

        const requestedType = detectAppointmentType(text);

        if (requestedType === 'emergency') {
            return sendMessage(chatId, t('emergency', lang));
        }

        // Single active appointment rule: do not offer another slot if patient already has one.
        if (rules.maxActiveAppointments > 0) {
            const active = await supabase.findNextActiveAppointment(userId);
            if (active) {
                const summary = buildAppointmentSummaryText(active, lang);
                const messageText = t('alreadyHasAppointment', lang).replace('{{summary}}', summary);
                const buttons = [
                    [{ text: t('cancelBtn', lang), callback_data: `cancel_appointment:${active.id}` }],
                    [{ text: t('rescheduleConfirmBtn', lang), callback_data: `rs:${active.id}` }],
                ];
                return sendInlineKeyboard(chatId, messageText, buttons);
            }
        }

        const slots = ctx.slots && ctx.slots.length > 0
            ? ctx.slots
            : await supabase.listOpenSlots({ limit: 5 });
        console.log(`[SLOTS] count=${slots.length}`);

        if (!slots || slots.length === 0) {
            return sendMessage(chatId, t('noSlots', lang));
        }

        const currentIndex = lastSlotIndex.get(chatId) || 0;
        const slotIndex = currentIndex % slots.length;
        lastSlotIndex.set(chatId, currentIndex + 1);

        const slot = slots[slotIndex];
        const appointmentType = requestedType === 'emergency' ? 'other' : requestedType;
        const when = formatSlot(slot.starts_at);
        const dentistName = slot.dentist?.name || '—';

        const messageText = [
            `📋 ${t('bookingConfirmTitle', lang)}`,
            '',
            `🗓 ${t('date', lang)}: ${when}`,
            `🦷 ${t('dentist', lang)}: ${dentistName}`,
            `🩺 ${t('appointmentType', lang)}: ${appointmentType}`,
            '',
            t('bookingConfirmHint', lang),
        ].join('\n');

        const buttons = [
            [{ text: t('confirmBtn', lang), callback_data: `confirm:${slot.id}:${appointmentType}` }],
            [{ text: t('cancelBtn', lang), callback_data: `cancel:${slot.id}` }],
        ];

        return sendInlineKeyboard(chatId, messageText, buttons);
    },

    async cancel(chatId, userId, lang) {
        if (!userId) {
            return sendMessage(chatId, t('askName', lang));
        }
        const active = await supabase.findNextActiveAppointment(userId);
        if (!active) {
            return sendMessage(chatId, t('noAppointments', lang));
        }

        const summary = buildAppointmentSummaryText(active, lang);
        const messageText = [
            t('cancelConfirmTitle', lang),
            '',
            summary,
        ].join('\n');

        const buttons = [
            [{ text: t('cancelConfirmBtn', lang), callback_data: `confirm_cancel:${active.id}` }],
            [{ text: t('backBtn', lang), callback_data: 'back:cancel' }],
        ];

        return sendInlineKeyboard(chatId, messageText, buttons);
    },

    async status(chatId, userId, lang) {
        if (!userId) {
            return sendMessage(chatId, t('askName', lang));
        }
        const active = await supabase.findNextActiveAppointment(userId);
        if (!active) {
            return sendMessage(chatId, t('noAppointments', lang));
        }
        const summary = buildAppointmentSummaryText(active, lang);
        return sendMessage(chatId, summary);
    },
    async reschedule(chatId, userId, lang, ctx = {}) {
        if (!userId) {
            return sendMessage(chatId, t('welcome', lang));
        }

        const active = await supabase.findNextActiveAppointment(userId);
        if (!active) {
            await sendMessage(chatId, t('noAppointments', lang));
            // Fall back to booking path; caller still controls identity confirmation.
            return handler.book(chatId, userId, lang, ctx);
        }

        const text = ctx.text || '';
        const requestedType = detectAppointmentType(text, active.appointment_type);
        if (requestedType === 'emergency') {
            return sendMessage(chatId, t('emergency', lang));
        }
        const appointmentType = requestedType === 'emergency' ? 'other' : requestedType;

        const slots = ctx.slots && ctx.slots.length > 0
            ? ctx.slots
            : await supabase.listOpenSlots({ limit: 5 });
        console.log(`[RESCHEDULE SLOTS] count=${slots.length}`);

        if (!slots || slots.length === 0) {
            await clearPendingReschedule(supabase.supabaseAdmin, chatId);
            return sendMessage(chatId, t('noSlots', lang));
        }

        const currentIndex = lastSlotIndex.get(chatId) || 0;
        const slotIndex = currentIndex % slots.length;
        lastSlotIndex.set(chatId, currentIndex + 1);

        const slot = slots[slotIndex];
        const currentSummary = buildAppointmentSummaryText(active, lang);
        const newWhen = formatSlot(slot.starts_at);
        const dentistName = slot.dentist?.name || '—';

        // Persist the appointment being rescheduled so the confirm button can
        // stay under Telegram's 64-byte callback_data limit.
        await writePendingReschedule(supabase.supabaseAdmin, chatId, active.id, appointmentType);

        const messageText = [
            t('rescheduleTitle', lang).replace('{{summary}}', currentSummary),
            '',
            `🗓 ${t('date', lang)}: ${newWhen}`,
            `🦷 ${t('dentist', lang)}: ${dentistName}`,
            `🩺 ${t('appointmentType', lang)}: ${appointmentType}`,
        ].join('\n');

        const buttons = [
            [{ text: t('rescheduleConfirmBtn', lang), callback_data: `crs:${slot.id}` }],
            [{ text: t('cancelBtn', lang), callback_data: 'crs_cancel' }],
        ];

        return sendInlineKeyboard(chatId, messageText, buttons);
    },

    async info(chatId, _userId, lang, ctx = {}) {
        const text = ctx.text || '';
        const section = sectionedInfoReply(text, lang);
        if (section) return sendMessage(chatId, section);

        // Default fallback (no matched section): ask which info they want,
        // instead of dumping the full FAQ block.
        return sendMessage(chatId, t('whichInfo', lang));
    },

    async other(chatId, _userId, lang, ctx = {}) {
        const text = (ctx.text || '').trim();
        if (isAck(text)) {
            return sendMessage(chatId, t('ackPrompt', lang));
        }
        // For any non-ack "other", offer a helpful prompt
        return sendMessage(chatId, t('canIHelp', lang));
    },
};

export async function route(chatId, userId, intent, lang, ctx = {}) {
    // Short ack safety net — never reach book/cancel/reschedule for acks
    if (isAck(ctx.text)) {
        console.log(`[INTENT] ack intercepted at router — intent=${intent} overridden to other`);
        return handler.other(chatId, userId, lang, ctx);
    }

    const fn = handler[intent];
    if (fn) return fn(chatId, userId, lang, ctx);
    return sendMessage(chatId, t('notRecognized', lang));
}

export { handler };