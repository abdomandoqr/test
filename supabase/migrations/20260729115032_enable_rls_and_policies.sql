-- =============================================================================
-- 20260729115032_enable_rls_and_policies.sql
-- Phase 2 — Enable Row Level Security and create policies for the anon role.
-- Run this after 20260729114852_create_triggers.sql.
--
-- NOTE: The patient-facing policies use a placeholder mechanism for matching
-- "own record" (current_setting('app.current_chat_id', true)).
-- In production, replace this with a proper Supabase Auth JWT claim.
-- =============================================================================

-- Enable RLS on all tables.
ALTER TABLE public.dentists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.available_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- dentists: public read, no write via anon
-- -----------------------------------------------------------------------------
CREATE POLICY "dentists_select_anon"
    ON public.dentists
    FOR SELECT
    TO anon
    USING (is_active = true);

-- -----------------------------------------------------------------------------
-- available_slots: public read, no write via anon
-- -----------------------------------------------------------------------------
CREATE POLICY "available_slots_select_anon"
    ON public.available_slots
    FOR SELECT
    TO anon
    USING (true);

-- -----------------------------------------------------------------------------
-- patients:
--   - anon INSERT allowed (self-registration via bot)
--   - anon SELECT/UPDATE only on own record (placeholder chat_id match)
-- -----------------------------------------------------------------------------
CREATE POLICY "patients_insert_anon"
    ON public.patients
    FOR INSERT
    TO anon
    WITH CHECK (true);

CREATE POLICY "patients_select_own"
    ON public.patients
    FOR SELECT
    TO anon
    USING (
        chat_id = current_setting('app.current_chat_id', true)::text
    );

CREATE POLICY "patients_update_own"
    ON public.patients
    FOR UPDATE
    TO anon
    USING (
        chat_id = current_setting('app.current_chat_id', true)::text
    )
    WITH CHECK (
        chat_id = current_setting('app.current_chat_id', true)::text
    );

-- -----------------------------------------------------------------------------
-- appointments: anon SELECT only on own appointments
-- No direct INSERT/UPDATE/DELETE via anon (bot uses service role for writes)
-- -----------------------------------------------------------------------------
CREATE POLICY "appointments_select_own"
    ON public.appointments
    FOR SELECT
    TO anon
    USING (
        patient_id IN (
            SELECT id FROM public.patients
            WHERE chat_id = current_setting('app.current_chat_id', true)::text
              AND deleted_at IS NULL
        )
        AND deleted_at IS NULL
    );

-- TODO: The RLS policies above use current_setting('app.current_chat_id', true)
-- which defaults to NULL if the setting is not set (silent fallback).
-- This means anon users without the setting set will see NO rows.
-- Replace with a Supabase Auth JWT claim (e.g.
-- auth.jwt() ->> 'chat_id') before production deployment.