/**
 * Normalize and validate international phone numbers.
 *
 * Accepts:
 * - optional leading + or 00
 * - separators: spaces, dashes, parentheses, dots
 * - 8–15 digits after cleaning
 *
 * Returns E.164-like string and a country code when a leading prefix is present.
 * Does NOT restrict to Egypt/Saudi/UAE.
 */

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

// Known country codes for best-effort detection. Longer prefixes checked first.
const KNOWN_COUNTRY_CODES = new Set([
    '+20', '+966', '+971',
    '+1',
    '+44', '+49',
    '+33', '+34', '+39', '+41',
    '+61', '+64',
    '+81', '+82', '+86', '+91',
    '+55', '+52', '+54',
    '+27', '+31', '+32', '+351', '+352', '+353', '+358',
    '+45', '+46', '+47', '+48',
    '+60', '+62', '+63', '+65', '+66',
    '+84', '+90', '+92', '+94', '+95',
    '+98', '+211', '+212', '+213', '+216', '+218', '+220', '+221', '+222',
    '+223', '+224', '+225', '+226', '+227', '+228', '+229', '+230', '+231',
    '+232', '+233', '+234', '+235', '+236', '+237', '+238', '+239', '+240',
    '+241', '+242', '+243', '+244', '+245', '+246', '+247', '+248', '+249',
    '+250', '+251', '+252', '+253', '+254', '+255', '+256', '+257', '+258',
    '+260', '+261', '+262', '+263', '+264', '+265', '+266', '+267', '+268',
    '+269', '+290', '+291', '+297', '+298', '+299',
    '+350', '+357', '+359', '+370', '+371', '+372', '+373', '+374', '+375',
    '+376', '+377', '+378', '+380', '+381', '+382', '+383', '+385', '+386',
    '+387', '+389',
    '+420', '+421', '+423',
    '+500', '+501', '+502', '+503', '+504', '+505', '+506', '+507', '+508',
    '+509', '+590', '+591', '+592', '+593', '+594', '+595', '+596', '+597',
    '+598', '+599',
    '+670', '+672', '+673', '+674', '+675', '+676', '+677', '+678', '+679',
    '+680', '+681', '+682', '+683', '+684', '+685', '+686', '+687', '+688',
    '+689', '+690', '+691', '+692',
    '+850', '+852', '+853', '+855', '+856', '+880', '+886',
    '+960', '+961', '+962', '+963', '+964', '+965', '+967', '+968', '+970',
    '+971', '+972', '+973', '+974', '+975', '+976', '+977', '+992', '+993',
    '+994', '+995', '+996', '+998',
]);

function cleanPhone(phone) {
    if (!phone || typeof phone !== 'string') return '';
    return phone.replace(/[\s\-().]/g, '').replace(/^00/, '+');
}

function detectCountryCode(phone) {
    const cleaned = cleanPhone(phone);
    if (!cleaned || !cleaned.startsWith('+')) return '';

    // Try to match the longest known prefix (up to 4 digits after +).
    for (let len = 4; len >= 1; len -= 1) {
        const prefix = cleaned.slice(0, len + 1);
        if (KNOWN_COUNTRY_CODES.has(prefix)) {
            return prefix;
        }
    }

    return '';
}

function normalizePhone(phone) {
    const cleaned = cleanPhone(phone);

    if (!/^\+?\d+$/.test(cleaned)) {
        return null;
    }

    const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
    if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
        return null;
    }

    const countryCode = detectCountryCode(phone);
    const normalized = cleaned.startsWith('+') ? cleaned : digits;

    return {
        phone: normalized,
        countryCode: countryCode || null,
    };
}

function isValidPhone(phone) {
    return normalizePhone(phone) !== null;
}

function getCountryFromCode(code) {
    const map = {
        '+20': 'Egypt',
        '+966': 'Saudi Arabia',
        '+971': 'UAE',
        '+1': 'USA/Canada',
        '+44': 'UK',
        '+49': 'Germany',
    };
    return map[code] || null;
}

function formatPhoneExample(cc) {
    const examples = {
        '+20': '+201234567890',
        '+966': '+966501234567',
        '+971': '+971501234567',
        '+1': '+14155552671',
        '+44': '+447911123456',
        '+49': '+4912345678',
    };
    return examples[cc] || '+14155552671';
}

export {
    cleanPhone,
    detectCountryCode,
    normalizePhone,
    isValidPhone,
    getCountryFromCode,
    formatPhoneExample,
};
