const required = [
    'GEMINI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TELEGRAM_BOT_TOKEN',
];

const optional = {
    'NODE_ENV': 'development',
    'LOG_LEVEL': 'info',
};

function validateEnv() {
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:', missing.join(', '));
        console.error('   Check your .env file against .env.example');
        process.exit(1);
    }
}

validateEnv();

export const config = {
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: 'gemini-3.5-flash-lite',
    },
    supabase: {
        url: process.env.SUPABASE_URL,
        anonKey: process.env.SUPABASE_ANON_KEY,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
    },
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
};

/**
 * Clinic content env vars, read once at config load.
 *
 * These are the single source of truth for clinic data that gets
 * substituted into outbound replies. If a value is empty/missing,
 * utils/clinic.js falls back to DEFAULTS.
 */
export const clinicEnv = {
    name: process.env.CLINIC_NAME || '',
    address: process.env.CLINIC_ADDRESS || '',
    phone: process.env.CLINIC_PHONE || '',
    hours: process.env.CLINIC_HOURS || '',
    services: process.env.CLINIC_SERVICES || '',
    firstVisitNotes: process.env.CLINIC_FIRST_VISIT_NOTES || '',
    emergencyNote: process.env.CLINIC_EMERGENCY_NOTE || '',
    timezone: process.env.CLINIC_TIMEZONE || 'Africa/Cairo',
    defaultSlotMinutes: process.env.DEFAULT_SLOT_MINUTES || '30',
    bookingLeadHours: process.env.BOOKING_LEAD_HOURS || '2',
    maxActiveAppointments: process.env.MAX_ACTIVE_APPOINTMENTS || '1',
    reminderEnabled: process.env.REMINDER_ENABLED || 'true',
    reminderHoursBefore: process.env.REMINDER_HOURS_BEFORE || '24,1',
    reminderCronMinutes: process.env.REMINDER_CRON_MINUTES || '5',
};

function parseIntOr(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Parsed clinic rule values with safe fallbacks.
 */
export const rules = {
    timezone: clinicEnv.timezone || 'Africa/Cairo',
    defaultSlotMinutes: parseIntOr(clinicEnv.defaultSlotMinutes, 30),
    bookingLeadHours: parseIntOr(clinicEnv.bookingLeadHours, 2),
    maxActiveAppointments: parseIntOr(clinicEnv.maxActiveAppointments, 1),
    reminderEnabled: clinicEnv.reminderEnabled !== 'false',
    reminderHoursBefore: (clinicEnv.reminderHoursBefore || '24,1')
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n)),
    reminderCronMinutes: parseIntOr(clinicEnv.reminderCronMinutes, 5),
};
