-- =============================================================================
-- 20260729115212_seed_data.sql
-- Phase 2 — Fake test data for the dental clinic booking bot.
-- Run this last, after 20260729115032_enable_rls_and_policies.sql.
-- All data is speculative and for testing only — do not use in production.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Dentists (3)
-- -----------------------------------------------------------------------------
INSERT INTO public.dentists (id, name, specialty, is_active, created_at) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Ahmed Hassan', 'General Dentistry', true, now()),
    ('22222222-2222-2222-2222-222222222222', 'Sara Mahmoud', 'Orthodontics', true, now()),
    ('33333333-3333-3333-3333-333333333333', 'Khalid Al-Sayed', 'Endodontics', true, now())
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2) Patients (5) — mix of Egypt, Saudi, UAE; mix of genders; all consent given
-- -----------------------------------------------------------------------------
INSERT INTO public.patients (
    id, name, phone, chat_id, channel, country_code,
    date_of_birth, gender, national_id,
    data_consent, treatment_consent,
    created_at
) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'Omar Hassan', '+201012345678', 'chat_1001', 'telegram', '+20',
     '1990-05-15', 'male', '29005151234567',
     true, true, now()),

    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     'Fatima Ali', '+201098765432', 'chat_1002', 'telegram', '+20',
     '1985-11-22', 'female', '28511221234567',
     true, true, now()),

    ('cccccccc-cccc-cccc-cccc-cccccccccccc',
     'Abdullah Al-Rashid', '+966501234567', 'chat_2001', 'telegram', '+966',
     '1992-03-08', 'male', '1092030800123',
     true, true, now()),

    ('dddddddd-dddd-dddd-dddd-dddddddddddd',
     'Noura Al-Saud', '+966509876543', 'chat_2002', 'whatsapp', '+966',
     '1998-07-30', 'female', '1198073000456',
     true, true, now()),

    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
     'Mohammed Al-Mansoori', '+971501112233', 'chat_3001', 'telegram', '+971',
     '1988-12-01', 'male', '784198812345678',
     true, true, now())
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3) Available Slots (20 slots across the next 14 days)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    d date;
    slot_time timestamptz;
    i int := 0;
BEGIN
    FOR d IN SELECT generate_series(
        (CURRENT_DATE + interval '1 day')::date,
        (CURRENT_DATE + interval '14 days')::date,
        interval '1 day'
    ) LOOP
        -- Morning slots for Ahmed (dentist 1)
        FOR slot_time IN SELECT * FROM unnest(ARRAY[
            d + time '07:00',
            d + time '08:30',
            d + time '10:00'
        ]::timestamptz[]) LOOP
            i := i + 1;
            IF i > 20 THEN EXIT; END IF;
            INSERT INTO public.available_slots (id, dentist_id, starts_at, duration_minutes, buffer_minutes, is_booked, created_at)
            VALUES (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', slot_time, 30, 10, false, now())
            ON CONFLICT (dentist_id, starts_at) DO NOTHING;
        END LOOP;

        -- Afternoon slots for Sara (dentist 2)
        FOR slot_time IN SELECT * FROM unnest(ARRAY[
            d + time '12:00',
            d + time '13:30',
            d + time '15:00'
        ]::timestamptz[]) LOOP
            i := i + 1;
            IF i > 20 THEN EXIT; END IF;
            INSERT INTO public.available_slots (id, dentist_id, starts_at, duration_minutes, buffer_minutes, is_booked, created_at)
            VALUES (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', slot_time, 30, 10, false, now())
            ON CONFLICT (dentist_id, starts_at) DO NOTHING;
        END LOOP;

        -- Morning slots for Khalid (dentist 3) on even days only
        IF EXTRACT(day FROM d)::int % 2 = 0 THEN
            FOR slot_time IN SELECT * FROM unnest(ARRAY[
                d + time '07:30',
                d + time '09:00'
            ]::timestamptz[]) LOOP
                i := i + 1;
                IF i > 20 THEN EXIT; END IF;
                INSERT INTO public.available_slots (id, dentist_id, starts_at, duration_minutes, buffer_minutes, is_booked, created_at)
                VALUES (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', slot_time, 30, 10, false, now())
                ON CONFLICT (dentist_id, starts_at) DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4) Appointments (5) — mix of statuses
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid;
BEGIN
    -- Pick the first available slot for each dentist
    SELECT id INTO s1 FROM public.available_slots WHERE dentist_id = '11111111-1111-1111-1111-111111111111' ORDER BY starts_at LIMIT 1;
    SELECT id INTO s2 FROM public.available_slots WHERE dentist_id = '11111111-1111-1111-1111-111111111111' ORDER BY starts_at LIMIT 1 OFFSET 1;
    SELECT id INTO s3 FROM public.available_slots WHERE dentist_id = '22222222-2222-2222-2222-222222222222' ORDER BY starts_at LIMIT 1;
    SELECT id INTO s4 FROM public.available_slots WHERE dentist_id = '22222222-2222-2222-2222-222222222222' ORDER BY starts_at LIMIT 1 OFFSET 1;
    SELECT id INTO s5 FROM public.available_slots WHERE dentist_id = '33333333-3333-3333-3333-333333333333' ORDER BY starts_at LIMIT 1;

    IF s1 IS NULL OR s2 IS NULL OR s3 IS NULL OR s4 IS NULL OR s5 IS NULL THEN
        RAISE NOTICE 'Not enough slots generated for seed appointments';
        RETURN;
    END IF;

    -- Mark the slots as booked
    UPDATE public.available_slots SET is_booked = true WHERE id IN (s1, s2, s3, s4, s5);

    -- Create appointments with varied statuses
    INSERT INTO public.appointments (id, patient_id, slot_id, appointment_type, status, cancelled_at, cancellation_reason, created_at) VALUES
        (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', s1, 'checkup', 'scheduled', null, null, now()),
        (gen_random_uuid(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', s2, 'cleaning', 'confirmed', null, null, now()),
        (gen_random_uuid(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', s3, 'filling', 'completed', null, null, now()),
        (gen_random_uuid(), 'dddddddd-dddd-dddd-dddd-dddddddddddd', s4, 'extraction', 'cancelled', now(), 'Patient requested cancellation', now()),
        (gen_random_uuid(), 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', s5, 'checkup', 'no_show', null, null, now())
    ON CONFLICT (slot_id) DO NOTHING;
END $$;