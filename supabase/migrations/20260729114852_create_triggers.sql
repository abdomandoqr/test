-- =============================================================================
-- 20260729114852_create_triggers.sql
-- Phase 2 — Create database triggers and helper functions.
-- Run this after 20260729114712_create_indexes.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: set_updated_at()
-- Keeps appointments.updated_at current on every UPDATE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1) Auto-set data_consent_date when data_consent changes false -> true
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_data_consent_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.data_consent IS TRUE AND (OLD.data_consent IS FALSE OR OLD.data_consent IS NULL) THEN
        NEW.data_consent_date = now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_patients_data_consent_date
BEFORE UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.set_data_consent_date();

-- -----------------------------------------------------------------------------
-- 2) Auto-set treatment_consent_date when treatment_consent changes false -> true
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_treatment_consent_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.treatment_consent IS TRUE AND (OLD.treatment_consent IS FALSE OR OLD.treatment_consent IS NULL) THEN
        NEW.treatment_consent_date = now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_patients_treatment_consent_date
BEFORE UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.set_treatment_consent_date();

-- -----------------------------------------------------------------------------
-- 3) Auto-set compliance_status based on country_code
--    Egypt (+20): requires data_consent + treatment_consent
--    Saudi Arabia (+966) / UAE (+971): + national_id
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_compliance_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    required_complete boolean;
BEGIN
    IF NEW.country_code = '+20' THEN
        required_complete := (NEW.data_consent IS TRUE) AND (NEW.treatment_consent IS TRUE);
    ELSIF NEW.country_code IN ('+966', '+971') THEN
        required_complete := (NEW.data_consent IS TRUE)
                          AND (NEW.treatment_consent IS TRUE)
                          AND (NEW.national_id IS NOT NULL AND NEW.national_id <> '');
    ELSE
        required_complete := false;
    END IF;

    NEW.compliance_status := CASE WHEN required_complete THEN 'complete' ELSE 'incomplete' END;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_patients_compliance_status
BEFORE INSERT OR UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.update_compliance_status();

-- -----------------------------------------------------------------------------
-- 4) Cascade soft-delete: when patient.deleted_at is set, soft-delete their
--    appointments (sets deleted_at on all related appointments).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cascade_patient_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND (OLD.deleted_at IS NULL OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) THEN
        UPDATE public.appointments
        SET deleted_at = NEW.deleted_at
        WHERE patient_id = NEW.id
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_patients_cascade_soft_delete
AFTER UPDATE ON public.patients
FOR EACH ROW
EXECUTE FUNCTION public.cascade_patient_soft_delete();

-- -----------------------------------------------------------------------------
-- 5) Auto-revert available_slots.is_booked to false when appointment is cancelled
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_slot_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
        UPDATE public.available_slots
        SET is_booked = false
        WHERE id = NEW.slot_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_appointments_revert_slot
AFTER UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.revert_slot_on_cancel();

-- -----------------------------------------------------------------------------
-- 6) Auto-update updated_at on appointments on every UPDATE
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_appointments_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- TODO: The data_consent_date and treatment_consent_date triggers only fire
-- on UPDATE, not INSERT. If a patient is INSERTed with consent=true from the
-- start, the date is not set automatically. Consider adding an AFTER INSERT
-- trigger to populate these dates, or handle this in the application layer.