#!/usr/bin/env node
/**
 * scripts/seed_demo_slots.mjs — Seed demo available_slots for development.
 *
 * Run: node scripts/seed_demo_slots.mjs  (or: npm run seed:slots)
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
 *
 * Behavior:
 *   - Fetches active dentists. If none exist, inserts a demo dentist
 *     ("Dr. Demo Dentist", General Dentistry) and uses it.
 *   - Clears all future unbooked demo slots ONLY when we auto-created the
 *     demo dentist (`isDemoDentist === true`). If the script picks up an
 *     existing real (non-demo) dentist, it skips the clear step and just
 *     inserts new slots alongside that dentist's existing schedule. A
 *     warning is printed in that case so the operator knows new slots are
 *     being appended rather than replacing anything.
 *   - Generates 6-10 future open slots across the next 7 days in the windows
 *     09:00-12:00 and 14:00-17:00 (30 min slot + 10 min buffer).
 *   - Prints the dentist used, whether it was auto-created, number cleared
 *     (if any), number inserted, and 3 sample starts_at times.
 */

import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const url = process.env.SUPABASE_URL
    ?.replace(/\/rest\/v1\/?$/, '')
    ?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(url, key, { realtime: { transport: WebSocket } });

console.log('Seeding demo slots...');

// ---------------------------------------------------------------------------
// 1. Pick (or create) an active dentist.
// ---------------------------------------------------------------------------
let dentist = null;

const { data: dentists, error: dErr } = await supabase
    .from('dentists')
    .select('id, name')
    .eq('is_active', true)
    .limit(1);

if (dErr) {
    console.error('❌ Failed to fetch dentists:', dErr.message);
    process.exit(1);
}

// `isDemoDentist` tracks whether we auto-created the demo dentist (true) or
// reused an existing real dentist (false). We only clear future unbooked
// slots when this is true, so we never wipe a real dentist's schedule.
const isDemoDentist = !(dentists && dentists.length > 0);

if (!isDemoDentist) {
    dentist = dentists[0];
} else {
    const { data: created, error: cErr } = await supabase
        .from('dentists')
        .insert({
            name: 'Dr. Demo Dentist',
            specialty: 'General Dentistry',
            is_active: true,
        })
        .select('id, name')
        .single();

    if (cErr || !created) {
        console.error('❌ Failed to create demo dentist:', cErr?.message || 'unknown error');
        process.exit(1);
    }

    dentist = created;
    console.log(`No active dentists found; created demo dentist ${dentist.name} (${dentist.id}).`);
}

console.log(`Using dentist: ${dentist.name} (${dentist.id}) [isDemoDentist=${isDemoDentist}]`);

// ---------------------------------------------------------------------------
// 2. Clear future unbooked demo slots ONLY when we auto-created the demo
//    dentist. For existing real dentists, skip the clear step and just
//    append new slots (with a warning).
// ---------------------------------------------------------------------------
const nowIso = new Date().toISOString();
let clearedCount = 0;

if (isDemoDentist) {
    const { data: cleared, error: clrErr } = await supabase
        .from('available_slots')
        .delete()
        .eq('dentist_id', dentist.id)
        .eq('is_booked', false)
        .gt('starts_at', nowIso)
        .select('id');

    if (clrErr) {
        console.error('❌ Failed to clear old demo slots:', clrErr.message);
        process.exit(1);
    }

    clearedCount = cleared?.length ?? 0;
    console.log(`Cleared ${clearedCount} future unbooked demo slot(s) for this dentist.`);
} else {
    console.warn(`⚠️  Using existing dentist ${dentist.name} (${dentist.id}); skipping clear step. New slots will be added alongside existing ones.`);
}

// ---------------------------------------------------------------------------
// 3. Generate 6-10 future open slots across the next 7 days.
//    Morning: 09:00-12:00, Afternoon: 14:00-17:00.
//    30 min slot + 10 min buffer (40 min cadence).
//    We emit one morning slot and one afternoon slot per day.
//    Start from tomorrow so slots are never "today" and always clear the
//    BOOKING_LEAD_HOURS window.
// ---------------------------------------------------------------------------
const TARGET_TOTAL = 8;            // within the 6-10 range required by the spec
const DAYS = TARGET_TOTAL / 2;     // 4 days => 2 slots/day => 8 slots total
const BOOKING_LEAD_HOURS = Number(process.env.BOOKING_LEAD_HOURS || 2);
const slots = [];
const now = new Date();
const minStart = new Date(now.getTime() + BOOKING_LEAD_HOURS * 60 * 60 * 1000);

for (let d = 1; d <= DAYS; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    date.setHours(0, 0, 0, 0);

    // Morning slot at 09:00 (one per day, within 09:00-12:00 window).
    const morning = new Date(date);
    morning.setHours(9, 0, 0, 0);

    // Afternoon slot at 14:00 (one per day, within 14:00-17:00 window).
    const afternoon = new Date(date);
    afternoon.setHours(14, 0, 0, 0);

    slots.push({
        dentist_id: dentist.id,
        starts_at: morning.toISOString(),
        duration_minutes: 30,
        buffer_minutes: 10,
        is_booked: false,
    });

    slots.push({
        dentist_id: dentist.id,
        starts_at: afternoon.toISOString(),
        duration_minutes: 30,
        buffer_minutes: 10,
        is_booked: false,
    });
}

// Drop any slot that is in the past or inside the booking lead-time window.
const futureSlots = slots.filter(s => new Date(s.starts_at) > minStart);
const droppedCount = slots.length - futureSlots.length;
if (droppedCount > 0) {
    console.log(`Dropped ${droppedCount} slot(s) that were inside the ${BOOKING_LEAD_HOURS}h lead-time window.`);
}

if (futureSlots.length === 0) {
    console.log('Nothing to insert.');
    process.exit(0);
}

const { data: inserted, error: iErr } = await supabase
    .from('available_slots')
    .upsert(futureSlots, { onConflict: 'dentist_id,starts_at', ignoreDuplicates: true })
    .select('starts_at');

if (iErr) {
    console.error('❌ Upsert error:', iErr.message);
    process.exit(1);
}

const insertedCount = inserted?.length ?? 0;
console.log(`Inserted/upserted ${insertedCount} demo slot(s) for ${dentist.name}.`);

// Print at least 3 sample starts_at times.
const sample = (inserted ?? []).slice(0, 3).map(r => r.starts_at);
console.log('Sample starts_at:');
for (const s of sample) {
    console.log(`  - ${s}`);
}

console.log('\nNext steps:');
console.log('  1. Run: node src/index.js');
console.log('  2. Open Telegram, send /start to your bot');
console.log('  3. Try /start → name → phone → "I want to book"');
console.log('  4. Click Confirm/Cancel buttons to test booking');
