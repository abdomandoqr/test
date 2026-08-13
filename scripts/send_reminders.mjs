import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import TelegramBot from 'node-telegram-bot-api';
import ws from 'ws';

import { config, rules } from '../src/config.js';
import { t } from '../src/utils/templates.js';

// Strip trailing /rest/v1 from Supabase URL when constructing the admin client.
const supabaseUrl = config.supabase.url.replace(/\/rest\/v1$/, '');
const supabase = createClient(supabaseUrl, config.supabase.serviceRoleKey, { realtime: { transport: ws } });

const bot = new TelegramBot(config.telegram.botToken, { polling: false });

// Simple inline slot formatter, kept identical to the one in intentHandler.js.
function formatSlot(value) {
  const d = new Date(value);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = days[d.getDay()];
  const monthName = months[d.getMonth()];
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dayName}, ${monthName} ${day} at ${hh}:${mm}`;
}

export async function fetchDueAppointments(supabaseClient, hours, now) {
  const flagColumn = hours === 1 ? 'reminder_1h_sent_at' : `reminder_${hours}h_sent_at`;

  const upper = new Date(now.getTime() + hours * 3600 * 1000).toISOString();
  const nowIso = now.toISOString();
  const lower = hours === 1
    ? nowIso
    : new Date(now.getTime() + 1 * 3600 * 1000).toISOString();

  const { data: appointments, error } = await supabaseClient
    .from('appointments')
    .select(`
      id,
      patients!inner(chat_id),
      available_slots!inner(
        starts_at,
        dentists(name)
      )
    `)
    .in('status', ['scheduled', 'confirmed'])
    .is('deleted_at', null)
    .is(flagColumn, null)
    .gt('available_slots.starts_at', nowIso)
    .gt('available_slots.starts_at', lower)
    .lte('available_slots.starts_at', upper);

  if (error) {
    throw new Error(`${hours}h query error: ${error.message}`);
  }

  return { appointments: appointments || [], flagColumn, upper, lower, nowIso };
}

export async function sendReminder({ supabaseClient, botClient, appt, hours, flagColumn }) {
  const chatId = appt.patients && appt.patients.chat_id;
  if (!chatId) {
    return { sent: false, reason: 'no chat_id' };
  }

  const slot = appt.available_slots;
  const dentistName = (slot && slot.dentists && slot.dentists.name) || '';
  const dateStr = formatSlot(slot.starts_at);

  const body = t('reminderBody', 'en')
    .replace('{{date}}', dateStr)
    .replace('{{dentist}}', dentistName);

  try {
    await botClient.sendMessage(chatId, body);
    await supabaseClient
      .from('appointments')
      .update({ [flagColumn]: new Date().toISOString() })
      .eq('id', appt.id);
    return { sent: true };
  } catch (sendErr) {
    console.error(`[reminders] send error for appointment ${appt.id}:`, sendErr.message);
    return { sent: false, reason: sendErr.message };
  }
}

export async function run({ supabaseClient = supabase, botClient = bot, rules: rulesOverride = null } = {}) {
  const activeRules = rulesOverride || rules;
  if (!activeRules.reminderEnabled) {
    console.log('[reminders] disabled');
    return;
  }

  const hoursList = activeRules.reminderHoursBefore || [24, 1];
  const now = new Date();

  for (const hours of hoursList) {
    const { appointments, flagColumn } = await fetchDueAppointments(supabaseClient, hours, now);
    const due = appointments.length;
    let sent = 0;

    for (const appt of appointments) {
      const result = await sendReminder({ supabaseClient, botClient, appt, hours, flagColumn });
      if (result.sent) sent += 1;
    }

    console.log(`[reminders] ${hours}h due=${due} sent=${sent}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run().catch(err => { console.error(err); process.exit(1); });
}
