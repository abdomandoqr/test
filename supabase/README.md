# Supabase Migrations

> **Note:** All seed data is **fake / test data** for development only.
> No real patient information is included.

---

## Files (run in this exact order in Supabase SQL Editor)

| # | File | Purpose |
|---|---|---|
| 1 | `migrations/20260729114532_create_tables.sql` | Creates 4 tables (dentists, patients, available_slots, appointments) with CHECK constraints and FK references |
| 2 | `migrations/20260729114712_create_indexes.sql` | Creates all required indexes, including the partial unique index for one active appointment per patient |
| 3 | `migrations/20260729114852_create_triggers.sql` | Creates 6 trigger functions (consent dates, compliance, cascade soft-delete, slot revert, updated_at) |
| 4 | `migrations/20260729115032_enable_rls_and_policies.sql` | Enables RLS on all tables; creates anon-role SELECT/INSERT/UPDATE policies |
| 5 | `migrations/20260729115212_seed_data.sql` | Inserts fake test data (3 dentists, 5 patients, 20 slots over 14 days, 5 appointments) |

## How to apply

1. Open **Supabase Dashboard → SQL Editor → New Query**
2. Paste and run each file **in order**, one at a time
3. Start with #1, then #2, ..., finally #5

## Schema overview

All timestamps are stored as `timestamptz` (UTC). The system targets Egypt (+20), Saudi Arabia (+966), and UAE (+971).

## RLS notes

- **patients**: anon can INSERT any record; SELECT/UPDATE only on own `chat_id` (placeholder via `current_setting('app.current_chat_id', true)`)
- **available_slots**: public read, no write
- **appointments**: anon SELECT only on own appointments; no direct INSERT/UPDATE
- **dentists**: public read, no write

> These policies must be hardened with proper JWT claims before production.