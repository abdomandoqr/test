-- Phase 4 - Reminders and Rules
-- Run order: after 20260729130411_add_conversation_history.sql
-- Additive changes only: introduces reminder timestamp columns on appointments.
-- No columns or tables are dropped, and no existing triggers are modified
-- (revert_slot_on_cancel already exists in 20260729114852_create_triggers.sql).

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamptz NULL;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_1h_sent_at timestamptz NULL;
