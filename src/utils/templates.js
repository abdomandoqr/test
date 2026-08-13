import { pickLocalized } from './language.js';
import { substitutePlaceholders } from './clinic.js';

/**
 * Templates use {{CLINIC_*}} placeholders that are substituted before sending.
 * NEVER send raw {{...}} to Telegram.
 */
const snippets = {
    welcome: {
        ar: 'مرحباً بك في {{CLINIC_NAME}} 👋 كيف يمكنني مساعدتك اليوم؟',
        en: "Welcome to {{CLINIC_NAME}} 👋 How can I help you today?",
    },
    askName: {
        ar: 'من فضلك، ما اسمك الكامل؟',
        en: 'Please tell me your full name.',
    },
    askPhone: {
        ar: 'شكراً لك. من فضلك، ما رقم هاتفك؟ (مثال: +201234567890 أو 0501234567)',
        en: 'Thank you. Please share your phone number (e.g. +201234567890 or 0501234567).',
    },
    invalidPhone: {
        ar: 'رقم الهاتف غير صالح. يرجى إدخال رقم صحيح مثل +201234567890',
        en: 'Invalid phone number. Please enter a valid number like +201234567890',
    },
    readyToBook: {
        ar: 'شكراً لك! كيف يمكنني مساعدتك اليوم؟ يمكنك الحجز أو الاستفسار عن الخدمات أو ساعات العمل.',
        en: 'Thank you! How can I help you today? You can book, ask about services, or check opening hours.',
    },
    bookingConfirmHint: {
        ar: 'اضغط ✅ لتأكيد الحجز أو ❌ للإلغاء.',
        en: 'Tap ✅ to confirm or ❌ to cancel.',
    },
    noAppointments: {
        ar: 'لا توجد مواعيد نشطة حالياً.',
        en: 'No active appointments at the moment.',
    },
    confirmBtn: {
        ar: '✅ تأكيد',
        en: '✅ Confirm',
    },
    cancelBtn: {
        ar: '❌ إلغاء',
        en: '❌ Cancel',
    },
    date: {
        ar: 'التاريخ',
        en: 'Date',
    },
    dentist: {
        ar: 'طبيب الأسنان',
        en: 'Dentist',
    },
    appointmentType: {
        ar: 'نوع الموعد',
        en: 'Appointment type',
    },
    bookingConfirmTitle: {
        ar: '📋 تفاصيل الموعد',
        en: '📋 Appointment Details',
    },
    booked: {
        ar: '✅ تم حجز موعدك بنجاح!',
        en: '✅ Your appointment is confirmed!',
    },
    bookingSummary: {
        ar: '✅ تم تأكيد الموعد.\n🗓 {{date}}\n🦷 {{dentist}}\n🩺 {{appointmentType}}',
        en: '✅ Appointment confirmed.\n🗓 {{date}}\n🦷 {{dentist}}\n🩺 {{appointmentType}}',
    },
    slotTaken: {
        ar: 'عذراً، هذا الموعد لم يعد متاحاً. يرجى اختيار موعد آخر.',
        en: 'Sorry, this slot is no longer available. Please choose another one.',
    },
    cancelled: {
        ar: '❌ تم إلغاء الحجز.',
        en: '❌ Booking cancelled.',
    },
    noSlots: {
        ar: 'عذراً، لا توجد مواعيد متاحة حالياً. يرجى المحاولة لاحقاً.',
        en: 'Sorry, no slots are available right now. Please try again later.',
    },
    notRecognized: {
        ar: 'لم أفهم طلبك. من فضلك أعد صياغته، أو اكتب "حجز" أو "الخدمات" أو "المواعيد".',
        en: "I didn't understand that. Could you rephrase, or type 'book', 'services', or 'hours'.",
    },
    clinicHours: {
        ar: '🕒 {{CLINIC_HOURS}}',
        en: '🕒 {{CLINIC_HOURS}}',
    },
    services: {
        ar: '🩺 خدماتنا: {{CLINIC_SERVICES}}.',
        en: '🩺 Our services: {{CLINIC_SERVICES}}.',
    },
    address: {
        ar: '📍 العنوان: {{CLINIC_ADDRESS}}. للحجز والاستفسار: {{CLINIC_PHONE}}.',
        en: '📍 Address: {{CLINIC_ADDRESS}}. For booking and inquiries: {{CLINIC_PHONE}}.',
    },
    emergency: {
        ar: '🚨 {{CLINIC_EMERGENCY_NOTE}}',
        en: '🚨 {{CLINIC_EMERGENCY_NOTE}}',
    },
    firstVisit: {
        ar: '{{CLINIC_FIRST_VISIT_NOTES}}',
        en: '{{CLINIC_FIRST_VISIT_NOTES}}',
    },
    genericError: {
        ar: 'حدث خطأ. يرجى المحاولة مرة أخرى.',
        en: 'Something went wrong. Please try again.',
    },
    restricted: {
        ar: 'لا يمكنني الإجابة على أسئلة طبية. سيتم تحويلك إلى موظف العيادة.',
        en: 'I cannot answer medical questions. I will escalate you to a clinic staff member.',
    },
    // Short helpful reply for short acks
    ackPrompt: {
        ar: 'حاضر. كيف يمكنني مساعدتك؟ يمكنك الحجز، الاستفسار عن الخدمات، أو معرفة ساعات العمل.',
        en: 'Got it. How can I help? You can book, ask about our services, or check opening hours.',
    },
    canIHelp: {
        ar: 'هل تحتاج مساعدة في الحجز أو الاستفسار عن الخدمات أو ساعات العمل؟',
        en: 'Do you need help booking, asking about services, or checking opening hours?',
    },
    restart: {
        ar: 'تم إعادة تعيين المحادثة. {{CLINIC_NAME}} — كيف يمكنني مساعدتك اليوم؟',
        en: 'Conversation reset. {{CLINIC_NAME}} — how can I help you today?',
    },
    whichInfo: {
        ar: 'ماذا تريد أن تعرف؟ ساعات العمل، الخدمات، العنوان، أو الطوارئ؟',
        en: 'What would you like to know? Hours, services, address, or emergency?',
    },
    confirmIdentity: {
        ar: 'للتأكيد قبل الحجز:\nالاسم: {{name}}\nالهاتف: {{phone}}\nهل البيانات صحيحة؟',
        en: 'Please confirm before booking:\nName: {{name}}\nPhone: {{phone}}\nIs this information correct?',
    },
    identityYesBtn: { ar: '✅ نعم', en: '✅ Yes' },
    identityFixBtn: { ar: '❌ تصحيح', en: '❌ Fix' },
    alreadyHasAppointment: {
        ar: 'لديك موعد نشط بالفعل:\n{{summary}}\n\nيمكنك إلغاؤه أو إعادة جدولته.',
        en: 'You already have an active appointment:\n{{summary}}\n\nYou can cancel or reschedule it.',
    },
    cancelConfirmTitle: {
        ar: 'هل تريد إلغاء هذا الموعد؟',
        en: 'Do you want to cancel this appointment?',
    },
    cancelConfirmBtn: { ar: '❌ نعم، إلغاء', en: '❌ Yes, cancel' },
    backBtn: { ar: '⬅️ رجوع', en: '⬅️ Back' },
    rescheduleTitle: {
        ar: 'موعدك الحالي:\n{{summary}}\n\nاختر موعداً جديداً:',
        en: 'Your current appointment:\n{{summary}}\n\nChoose a new slot:',
    },
    rescheduleConfirmBtn: { ar: '🔄 إعادة الجدولة لهذا الموعد', en: '🔄 Reschedule to this slot' },
    appointmentSummary: {
        ar: '🗓 {{date}}\n🦷 {{dentist}}\n🩺 {{appointmentType}}',
        en: '🗓 {{date}}\n🦷 {{dentist}}\n🩺 {{appointmentType}}',
    },
    rescheduleSuccess: {
        ar: '✅ تمت إعادة جدولة الموعد.\n🗓 {{date}}\n🦷 {{dentist}}\n🩺 {{appointmentType}}',
        en: '✅ Appointment rescheduled.\n🗓 {{date}}\n🦷 {{dentist}}\n🩺 {{appointmentType}}',
    },
    cancelSuccess: {
        ar: '✅ تم إلغاء الموعد.',
        en: '✅ Appointment cancelled.',
    },
    reminderBody: {
        ar: '🔔 تذكير: لديك موعد في {{CLINIC_NAME}} يوم {{date}} مع {{dentist}}.',
        en: '🔔 Reminder: you have an appointment at {{CLINIC_NAME}} on {{date}} with {{dentist}}.',
    },
};

export function t(key, lang = 'en') {
    const raw = pickLocalized(snippets[key], lang, snippets[key]?.en || '');
    return substitutePlaceholders(raw, lang);
}

export function localizedButton(text) {
    return text;
}

export { snippets };