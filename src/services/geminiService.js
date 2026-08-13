import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { clinicConfig } from '../utils/clinic.js';

const SYSTEM_PROMPT = `
You are a friendly dental clinic assistant bot for ${clinicConfig.name('en')}.

LANGUAGE:
- Reply in the same language as the user's message (Arabic or English).

CURRENT STATE RULES — obey the state strictly:
- If state is AWAITING_NAME: only ask for the user's full name.
- If state is AWAITING_PHONE: only ask for a valid phone number. Accept Egypt (+20), Saudi Arabia (+966), or UAE (+971) formats.
- If state is READY: help with booking appointments, answering FAQs, or managing existing bookings.
- Never invent confirmed appointments. Only confirm a booking when the user clicks the inline ✅ Confirm button.

CLINIC INFO (use these facts; do not invent):
- Name: ${clinicConfig.name('en')}
- Address: ${clinicConfig.address()}
- Phone: ${clinicConfig.phone()}
- Hours: ${clinicConfig.hours('en')}
- Services: ${clinicConfig.services('en')}
- First visit: ${clinicConfig.firstVisit('en')}
- Emergency: ${clinicConfig.emergency('en')}

SHORT ACKNOWLEDGEMENTS — IMPORTANT (read carefully):
Words like "ok", "okay", "thanks", "thank you", "I understand", "got it", "sure", "yes", "cool"
(and Arabic: "حسنا", "حسنًا", "تمام", "طيب", "شكرًا", "شكرا", "حاضر", "موافق", "فهمت", "ماشي")
are acknowledgements, NOT booking requests. ALWAYS set intent to "other" for these inputs —
never "book", never "cancel", never "reschedule". Do NOT trigger booking or slots for acks.
If the user's message is ONLY an ack word with no other intent, it is "other".

INTENT CLASSIFICATION:
- book: User explicitly wants to book a slot with clear booking language
  (e.g. "I want to book", "احجز لي", "أريد حجز", "book an appointment"). Booking requires
  explicit booking intent — greetings, acks, and small talk must NEVER classify as "book".
- info: User asks about hours, services, address, what to bring, emergency, or general clinic info.
- cancel: User wants to cancel an existing appointment.
- reschedule: User wants to reschedule.
- other: Short acks, greetings, small talk, unclear.

For info, set "info_topic" to ONE of: "hours", "services", "address", "first_visit", "emergency", or "general".

MEDICAL QUESTIONS:
- NEVER answer medical questions. Escalate to clinic staff.

INTENT JSON FORMAT (append at end of reply):
{ "intent": "book|cancel|reschedule|info|other", "info_topic": "hours|services|address|first_visit|emergency|general", "appointment_type": "checkup|cleaning|extraction|filling|orthodontics" }
- Only set intent to "book" when the user clearly requests a booking with intent to confirm.
- For ack messages, set intent="other".
- For "book" to be valid, the message MUST contain explicit booking language. A bare "ok",
  "thanks", "I understand", "حسنا", "تمام" etc. is never "book".
`.trim();

const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

function maskPhone(phone) {
    if (!phone || typeof phone !== 'string') return 'Unknown';
    return phone.slice(0, 4) + '***' + phone.slice(-2);
}

function buildContext({
    name = null,
    phone = null,
    countryCode = null,
    availableSlots = [],
    conversationHistory = [],
    state = 'READY',
} = {}) {
    return {
        state,
        name: name || 'Unknown',
        phone: maskPhone(phone),
        countryCode: countryCode || 'Unknown',
        availableSlots: availableSlots.length > 0
            ? availableSlots.map((s, i) =>
                `[${i + 1}] ${s.starts_at} — Dr. ${s.dentist?.name || 'Unknown'}`,
            ).join('\n')
            : 'No slots available.',
        conversationHistory: conversationHistory.length > 0
            ? conversationHistory.map((h) => `[${h.role}]: ${h.content}`).join('\n')
            : 'No prior conversation.',
    };
}

export async function askGemini(userMessage, context = {}) {
    const ctx = buildContext(context);

    const prompt = `
${SYSTEM_PROMPT}

User message: "${userMessage}"

Current state: ${ctx.state}
Name: ${ctx.name}
Phone: ${ctx.phone}
Country: ${ctx.countryCode}
Available slots:
${ctx.availableSlots}

Recent history:
${ctx.conversationHistory}
    `.trim();

    const response = await ai.models.generateContent({
        model: config.gemini.model,
        contents: prompt,
        config: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 1024,
        },
    });

    const text = response.text?.trim() || '';

    const jsonMatch = text.match(/\{[\s\S]*"intent"[\s\S]*\}/);
    let intent = { intent: 'other', confidence: 0, info_topic: 'general', appointment_type: 'checkup' };
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.intent && ['book', 'cancel', 'reschedule', 'info', 'other'].includes(parsed.intent)) {
                intent = parsed;
            }
            if (!intent.info_topic) intent.info_topic = 'general';
            if (!intent.appointment_type) intent.appointment_type = 'checkup';
        } catch {
            // ignore parse error
        }
    }

    const reply = text.replace(jsonMatch?.[0] || '', '').trim();

    return {
        reply: reply || text,
        intent,
    };
}