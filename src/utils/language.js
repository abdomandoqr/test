/**
 * utils/language.js — Lightweight Arabic/English detection helper.
 *
 * The primary language logic is delegated to Gemini, but this helper is used
 * for logging, telemetry, and as a fallback for template-based responses.
 */

const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

/**
 * Detect whether the input contains Arabic characters.
 * Returns 'ar' if any Arabic character is found, otherwise 'en'.
 *
 * @param {string} text
 * @returns {'ar' | 'en'}
 */
export function detectLanguage(text) {
    if (!text || typeof text !== 'string') return 'en';
    return ARABIC_RANGE.test(text) ? 'ar' : 'en';
}

/**
 * Pick the right variant from a bilingual object.
 *
 * @param {{ ar?: string, en?: string }} snippets
 * @param {'ar' | 'en'} lang
 * @param {string} fallback
 * @returns {string}
 */
export function pickLocalized(snippets, lang, fallback = '') {
    if (!snippets) return fallback;
    return snippets[lang] || snippets.en || snippets.ar || fallback;
}