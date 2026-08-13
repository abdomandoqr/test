/**
 * utils/clinic.js — Single source of truth for clinic configuration.
 *
 * Reads CLINIC_* env vars (via clinicEnv in config.js) and provides safe
 * fallbacks so we never send raw ${...} / {{...}} placeholders to Telegram.
 *
 * All env substitution for templates is done here, NOT scattered.
 */

import { clinicEnv } from '../config.js';

const DEFAULTS = {
    CLINIC_NAME: 'عيادة الأسنان',
    CLINIC_NAME_EN: 'Dental Clinic',
    CLINIC_ADDRESS: '123 Main Street, Cairo',
    CLINIC_PHONE: '+201234567890',
    CLINIC_HOURS: 'السبت إلى الخميس من 9 صباحاً حتى 5 مساءً. الجمعة إجازة.',
    CLINIC_HOURS_EN: 'Saturday to Thursday 9am–5pm. Friday closed.',
    CLINIC_SERVICES: 'فحص، تنظيف، حشو، خلع',
    CLINIC_SERVICES_EN: 'checkup, cleaning, filling, extraction',
    CLINIC_FIRST_VISIT_NOTES: 'في زيارتك الأولى، يرجى إحضار هويتك وأي سجلات طبية سابقة.',
    CLINIC_FIRST_VISIT_NOTES_EN: 'For your first visit, please bring your ID and any previous medical records.',
    CLINIC_EMERGENCY_NOTE: 'في حالة الطوارئ، يرجى الاتصال بالعيادة فوراً.',
    CLINIC_EMERGENCY_NOTE_EN: 'For emergencies, please call the clinic immediately.',
};

// Map CLINIC_* env var name → short clinicEnv key in config.js.
// Used by envOrDefault() to consult clinicEnv first.
const ENV_TO_CLINIC_KEY = {
    CLINIC_NAME: 'name',
    CLINIC_NAME_EN: 'name',
    CLINIC_ADDRESS: 'address',
    CLINIC_PHONE: 'phone',
    CLINIC_HOURS: 'hours',
    CLINIC_HOURS_EN: 'hours',
    CLINIC_SERVICES: 'services',
    CLINIC_SERVICES_EN: 'services',
    CLINIC_FIRST_VISIT_NOTES: 'firstVisitNotes',
    CLINIC_FIRST_VISIT_NOTES_EN: 'firstVisitNotes',
    CLINIC_EMERGENCY_NOTE: 'emergencyNote',
    CLINIC_EMERGENCY_NOTE_EN: 'emergencyNote',
};

function envOrDefault(key) {
    // 1) clinicEnv (primary source)
    const shortKey = ENV_TO_CLINIC_KEY[key];
    if (shortKey !== undefined) {
        const fromClinicEnv = clinicEnv[shortKey];
        if (fromClinicEnv && String(fromClinicEnv).trim().length > 0) {
            return String(fromClinicEnv).trim();
        }
    }
    // 2) raw process.env (covers any future var not in clinicEnv)
    const fromEnv = process.env[key];
    if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
    // 3) DEFAULTS fallback
    return DEFAULTS[key];
}

function localize(arKey, enKey, lang) {
    if (lang === 'ar') return envOrDefault(arKey);
    return envOrDefault(enKey);
}

export const clinicConfig = {
    name: (lang = 'en') => localize('CLINIC_NAME', 'CLINIC_NAME_EN', lang),
    address: () => envOrDefault('CLINIC_ADDRESS'),
    phone: () => envOrDefault('CLINIC_PHONE'),
    hours: (lang = 'en') => localize('CLINIC_HOURS', 'CLINIC_HOURS_EN', lang),
    services: (lang = 'en') => localize('CLINIC_SERVICES', 'CLINIC_SERVICES_EN', lang),
    firstVisit: (lang = 'en') => localize('CLINIC_FIRST_VISIT_NOTES', 'CLINIC_FIRST_VISIT_NOTES_EN', lang),
    emergency: (lang = 'en') => {
        const note = localize('CLINIC_EMERGENCY_NOTE', 'CLINIC_EMERGENCY_NOTE_EN', lang);
        const phone = clinicConfig.phone();
        const phrase = lang === 'ar' ? 'على الرقم' : 'at';
        return `${note} ${phrase} ${phone}`;
    },
};

/**
 * Substitute all {{KEY}} or ${KEY} placeholders in a template string.
 * Uses clinicConfig values. Falls back to defaults if env missing.
 *
 * SAFETY: Any placeholder that is not in the known map is replaced
 * with an empty string. No raw {{...}} or ${...} ever escapes this
 * function — callers can rely on the output being safe to send.
 */
export function substitutePlaceholders(text, lang = 'en') {
    if (!text || typeof text !== 'string') return text;
    const map = {
        '{{CLINIC_NAME}}': clinicConfig.name(lang),
        '{{CLINIC_ADDRESS}}': clinicConfig.address(),
        '{{CLINIC_PHONE}}': clinicConfig.phone(),
        '{{CLINIC_HOURS}}': clinicConfig.hours(lang),
        '{{CLINIC_SERVICES}}': clinicConfig.services(lang),
        '{{CLINIC_FIRST_VISIT_NOTES}}': clinicConfig.firstVisit(lang),
        '{{CLINIC_EMERGENCY_NOTE}}': clinicConfig.emergency(lang),
        '${CLINIC_NAME}': clinicConfig.name(lang),
        '${CLINIC_ADDRESS}': clinicConfig.address(),
        '${CLINIC_PHONE}': clinicConfig.phone(),
        '${CLINIC_HOURS}': clinicConfig.hours(lang),
        '${CLINIC_SERVICES}': clinicConfig.services(lang),
        '${CLINIC_FIRST_VISIT_NOTES}': clinicConfig.firstVisit(lang),
        '${CLINIC_EMERGENCY_NOTE}': clinicConfig.emergency(lang),
    };
    // Single regex handles both {{...}} and ${...}.
    // Unknown placeholders collapse to '' instead of being left in the text.
    return text.replace(/\{\{[A-Z_]+\}\}|\$\{[A-Z_]+\}/g, (m) => (m in map ? map[m] : ''));
}
