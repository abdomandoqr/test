-- Phase 4 follow-up — Relax country_code constraint for international phone numbers.
-- Run order: after 20260805000000_phase4_reminders_and_rules.sql
-- Additive only: drops the restrictive CHECK constraint; does not drop columns or data.

ALTER TABLE public.patients
  ALTER COLUMN country_code DROP NOT NULL;

ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_country_chk;
