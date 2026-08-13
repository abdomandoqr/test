-- =============================================================================
-- 20260729114712_create_indexes.sql
-- Phase 2 — Create all indexes for the dental clinic booking bot.
-- Run this after 20260729114532_create_tables.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- dentists
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_dentists_is_active
    ON public.dentists (is_active);

-- -----------------------------------------------------------------------------
-- patients
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_patients_phone
    ON public.patients (phone);

CREATE INDEX IF NOT EXISTS idx_patients_chat_id
    ON public.patients (chat_id);

CREATE INDEX IF NOT EXISTS idx_patients_country_code
    ON public.patients (country_code);

CREATE INDEX IF NOT EXISTS idx_patients_deleted_at
    ON public.patients (deleted_at);

-- -----------------------------------------------------------------------------
-- available_slots
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_available_slots_starts_at_is_booked
    ON public.available_slots (starts_at, is_booked);

CREATE INDEX IF NOT EXISTS idx_available_slots_dentist_starts
    ON public.available_slots (dentist_id, starts_at);

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id
    ON public.appointments (patient_id);

CREATE INDEX IF NOT EXISTS idx_appointments_status
    ON public.appointments (status);

CREATE INDEX IF NOT EXISTS idx_appointments_type
    ON public.appointments (appointment_type);

CREATE INDEX IF NOT EXISTS idx_appointments_deleted_at
    ON public.appointments (deleted_at);

-- TODO: The partial unique index below allows exactly one active appointment
-- per patient. If a patient has a 'scheduled' or 'confirmed' appointment that
-- is not soft-deleted, any further appointment of that type will be rejected
-- at the INDEX level. Consider whether this should be a CHECK constraint instead
-- for clearer error messages, or kept as an index for performance.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_one_active_per_patient
    ON public.appointments (patient_id)
    WHERE status IN ('scheduled', 'confirmed')
      AND deleted_at IS NULL;