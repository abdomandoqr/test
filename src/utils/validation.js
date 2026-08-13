/**
 * Lightweight validators for onboarding inputs.
 */

const REJECT_NAME_PATTERNS = [
    /^(ما\s*اسمك|ما\s*اسمك\?|what\s+is\s+your\s+name|what's\s+your\s+name|whats\s+your\s+name|who\s+am\s+i|tell\s+me\s+your\s+name|my\s+name\s+is)\b/i,
    /^(اسمي)(\s|$|\?)/i,
    /^(مرحبا|مرحبا\?|hello|hi|hey|ahlan|ahlan\?|اهلا|اهلا\?|أهلاً|أهلا)(\s|$|\?)/i,
    /^(متى|متي|متا|متى\s|متي\s|كيف|اين|أين|أي\s+موعد|أي\s+وقت|what\s+time|when\s|where\s|how\s|what\s+is|what\s+are)\b/i,
    /^\/start$/,
    /^[0-9+\s]+$/, // phone-like strings
    /^.{0,1}$/, // too short
];

export function isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    const t = name.trim();
    if (t.length < 2) return false;
    for (const re of REJECT_NAME_PATTERNS) {
        if (re.test(t)) return false;
    }
    return true;
}

export function displayName(name) {
    return (name || '').trim();
}