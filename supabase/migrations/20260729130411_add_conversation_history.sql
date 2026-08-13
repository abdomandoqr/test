-- =============================================================================
-- 20260729130411_add_conversation_history.sql
-- Phase 3 — Add conversation_history table for persistent chat memory.
-- Run this after 20260729115212_seed_data.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.conversation_history (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id     text        NOT NULL,
    role        text        NOT NULL,
    content     text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_history_chat_id
    ON public.conversation_history (chat_id);

CREATE INDEX IF NOT EXISTS idx_conversation_history_created_at
    ON public.conversation_history (created_at);

-- Enable RLS
ALTER TABLE public.conversation_history ENABLE ROW LEVEL SECURITY;

-- Policies: only service role can write/read; anon has no access
CREATE POLICY "conversation_history_service_role_all"
    ON public.conversation_history
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);