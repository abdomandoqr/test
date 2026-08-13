-- =============================================================================
-- 20260729114532_create_tables.sql
-- Phase 2 — Create the core tables for the dental clinic booking bot.
-- Target countries: Egypt (+20), Saudi Arabia (+966), UAE (+971).
-- All timestamp columns use timestamptz (UTC).
-- Run this first in Supabase SQL Editor.
-- =============================================================================

-- Extension for gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- dentists
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dentists (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    specialty   text        NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- patients
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patients (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    text        NOT NULL,
    phone                   text        NOT NULL UNIQUE,
    chat_id                 text        NOT NULL,
    channel                 text        NOT NULL DEFAULT 'telegram',
    country_code            text        NOT NULL,
    date_of_birth           date        NOT NULL,
    gender                  text        NOT NULL,
    national_id             text        NULL,
    data_consent            boolean     NOT NULL DEFAULT false,
    data_consent_date       timestamptz NULL,
    treatment_consent       boolean     NOT NULL DEFAULT false,
    treatment_consent_date  timestamptz NULL,
    compliance_status       text        NOT NULL DEFAULT 'incomplete',
    deleted_at              timestamptz NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT patients_channel_chk
        CHECK (channel IN ('telegram', 'whatsapp')),
    CONSTRAINT patients_country_chk
        CHECK (country_code IN ('+20', '+966', '+971')),
    CONSTRAINT patients_gender_chk
        CHECK (gender IN ('male', 'female')),
    CONSTRAINT patients_compliance_chk
        CHECK (compliance_status IN ('incomplete', 'complete'))
);

-- -----------------------------------------------------------------------------
-- available_slots
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.available_slots (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    dentist_id        uuid        NULL REFERENCES public.dentists(id) ON DELETE SET NULL,
    starts_at         timestamptz NOT NULL,
    duration_minutes  integer     NOT NULL DEFAULT 30,
    buffer_minutes    integer     NOT NULL DEFAULT 10,
    is_booked         boolean     NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT available_slots_duration_chk
        CHECK (duration_minutes > 0),
    CONSTRAINT available_slots_buffer_chk
        CHECK (buffer_minutes >= 0),
    CONSTRAINT available_slots_unique_dentist_start
        UNIQUE (dentist_id, starts_at)
);

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointments (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          uuid        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
    slot_id             uuid        NOT NULL REFERENCES public.available_slots(id) ON DELETE RESTRICT,
    appointment_type    text        NOT NULL,
    status              text        NOT NULL DEFAULT 'scheduled',
    cancelled_at        timestamptz NULL,
    cancellation_reason text        NULL,
    deleted_at          timestamptz NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT appointments_type_chk
        CHECK (appointment_type IN ('checkup', 'cleaning', 'filling', 'extraction', 'other')),
    CONSTRAINT appointments_status_chk
        CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled', 'no_show')),
    CONSTRAINT appointments_cancelled_meta_chk
        CHECK (
            (status <> 'cancelled')
            OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
        ),
    CONSTRAINT appointments_unique_slot
        UNIQUE (slot_id)
);
