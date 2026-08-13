-- =============================================================================
-- scripts/seed_demo_slots.sql
--
-- Manual SQL equivalent of scripts/seed_demo_slots.mjs for use in the
-- Supabase SQL Editor.
--
-- Requires the `pgcrypto` extension (Supabase enables it by default; it
-- provides `gen_random_uuid()`). If you ever need to bootstrap it manually:
--   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--
-- What this script does:
--   1. Inserts a demo dentist ("Dr. Demo Dentist", General Dentistry) if no
--      active dentist exists, then uses that dentist for the rest of the run.
--   2. Clears any future unbooked demo slots for the chosen dentist so the
--      script is idempotent (re-running never duplicates slots).
--   3. Inserts 8 future open slots (one morning + one afternoon per day for
--      the next 4 days), all within the next 7 days, in the 09:00-12:00 and
--      14:00-17:00 windows. Each slot is 30 min + 10 min buffer.
--
-- Run in Supabase SQL Editor as the `postgres` role or any role with write
-- access to `public.dentists` and `public.available_slots`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ensure a demo dentist exists; capture its id into a temp variable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    demo_id uuid;
BEGIN
    SELECT id INTO demo_id
    FROM public.dentists
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF demo_id IS NULL THEN
        INSERT INTO public.dentists (name, specialty, is_active)
        VALUES ('Dr. Demo Dentist', 'General Dentistry', true)
        RETURNING id INTO demo_id;

        RAISE NOTICE 'No active dentists found; created demo dentist Dr. Demo Dentist (%)', demo_id;
    ELSE
        RAISE NOTICE 'Using existing active dentist id=%', demo_id;
    END IF;

    -- Stash for the statements below.
    PERFORM set_config('seed.demo_dentist_id', demo_id::text, false);
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Clear future unbooked demo slots for the chosen dentist.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    demo_id uuid := current_setting('seed.demo_dentist_id')::uuid;
    cleared_count integer;
BEGIN
    WITH deleted AS (
        DELETE FROM public.available_slots
        WHERE dentist_id = demo_id
          AND is_booked = false
          AND starts_at > now()
        RETURNING id
    )
    SELECT count(*) INTO cleared_count FROM deleted;

    RAISE NOTICE 'Cleared % future unbooked demo slot(s) for dentist %', cleared_count, demo_id;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Insert 8 future open slots across the next 4 days (within next 7 days).
--    Each day: one morning slot at 09:00 and one afternoon slot at 14:00.
--    30 min slot + 10 min buffer.
-- ---------------------------------------------------------------------------
INSERT INTO public.available_slots
    (dentist_id, starts_at, duration_minutes, buffer_minutes, is_booked)
SELECT
    current_setting('seed.demo_dentist_id')::uuid AS dentist_id,
    slot_start                                      AS starts_at,
    30                                              AS duration_minutes,
    10                                              AS buffer_minutes,
    false                                           AS is_booked
FROM (
    -- 4 days × 2 windows = 8 slots
    SELECT generate_series(0, 3) AS day_offset, '09:00'::time AS slot_time UNION ALL
    SELECT generate_series(0, 3) AS day_offset, '14:00'::time AS slot_time
) AS windows
CROSS JOIN LATERAL (
    SELECT (current_date + day_offset + slot_time) AT TIME ZONE 'UTC' AS slot_start
) AS computed
WHERE slot_start > now()
ON CONFLICT (dentist_id, starts_at) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Report what we inserted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    demo_id uuid := current_setting('seed.demo_dentist_id')::uuid;
    inserted_count integer;
    sample_count integer;
BEGIN
    SELECT count(*) INTO inserted_count
    FROM public.available_slots
    WHERE dentist_id = demo_id
      AND starts_at > now()
      AND is_booked = false;

    SELECT count(*) INTO sample_count
    FROM (
        SELECT starts_at
        FROM public.available_slots
        WHERE dentist_id = demo_id
          AND starts_at > now()
          AND is_booked = false
        ORDER BY starts_at ASC
        LIMIT 3
    ) AS s;

    RAISE NOTICE 'Inserted % demo slot(s) for dentist %. Sample count: %',
        inserted_count, demo_id, sample_count;
END
$$;

-- Show the 3 sample starts_at times as a result set for the SQL Editor UI.
SELECT starts_at
FROM public.available_slots
WHERE dentist_id = current_setting('seed.demo_dentist_id')::uuid
  AND starts_at > now()
  AND is_booked = false
ORDER BY starts_at ASC
LIMIT 3;
