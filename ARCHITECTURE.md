# Architecture

This document describes the high-level structure of the booking system and the
principles that keep it ready for additional messaging channels (in particular,
WhatsApp) without rewriting booking logic.

## Layering at a glance

- **Domain** — clinic logic: patients, appointments, services, doctors, slot
  lookup, booking state machine. Pure business rules. Knows nothing about
  Telegram, WhatsApp, or any specific transport.
- **Channel adapters** — thin per-transport modules that translate between the
  transport's native message format and a small, normalized shape the domain
  understands. Today only a Telegram adapter exists. A future WhatsApp adapter
  will sit beside it, not behind it.
- **Persistence** — Postgres via Supabase. The schema already permits multiple
  channels at the row level (see below).

The rule: **a booking must be creatable end-to-end without the domain code
ever importing a transport-specific module.**

## WhatsApp-ready architecture — later phase

This section documents the minimum structural choices that make a future Meta
WhatsApp Cloud API integration possible without reworking the booking flow. It
is descriptive only — no WhatsApp send/receive code exists yet.

### What "channel-agnostic" means here

- Clinic logic in `src/handlers/`, `src/services/booking*`, and any domain
  helper takes data that has already been normalized into a transport-neutral
  shape. It does not read Telegram-only fields or assume a particular sender
  identity format.
- Each transport owns its own adapter module (`src/services/telegramService.js`
  for now). A future `src/services/whatsappService.js` will implement the same
  outbound interface (send text, edit message, typing indicator) and produce
  the same normalized inbound shape.
- The `patients.channel` column records which transport a given patient
  arrived on. Routing decisions (admin notifications, future per-channel
  preferences) can branch on this value without changing booking logic.

### What already supports WhatsApp in the schema

The `patients` table already accepts WhatsApp at the database level — no
migration is required for that:

- Column: `patients.channel` — `text NOT NULL DEFAULT 'telegram'`
- Constraint: `CONSTRAINT patients_channel_chk CHECK (channel IN ('telegram', 'whatsapp'))`
- Location: `supabase/migrations/20260729114532_create_tables.sql`

This means a row can already be inserted with `channel = 'whatsapp'`. What is
not yet present is the upstream mechanism (a WhatsApp adapter) that produces
such rows.

### What will be added in a later phase

The following items are intentionally **out of scope** for the current phase
and are listed here as the contract a future implementer must satisfy:

1. **WhatsApp Cloud API client** — server-to-server calls to Meta's Graph API
   for sending messages. Auth via a system-user access token.
2. **Webhook receiver** — an HTTP endpoint (Express route or equivalent) that
   verifies Meta's webhook signature, validates the `VERIFY_TOKEN` challenge,
   and hands verified payloads to the same normalized inbound pipeline used by
   Telegram today.
3. **Message templates** — pre-approved WhatsApp Business templates for
   outbound flows where session-window messaging is not available (e.g. the
   first message to a patient, appointment reminders outside the 24h window).
   Template names and variables will live in a small mapping, not in domain
   code.
4. **WhatsApp channel adapter** — a module mirroring the Telegram adapter's
   outbound interface and producing the same normalized inbound shape
   (`{ channel, senderId, text, raw }`). It will be the *only* module allowed
   to import the Meta SDK or call the Cloud API directly.
5. **Inbound sender identity resolution** — mapping a WhatsApp phone number
   (E.164) to a `patients` row via `channel = 'whatsapp'` plus a phone-keyed
   lookup, mirroring how Telegram resolves via `chat_id`.
6. **Operational concerns** — per-tenant rate limiting, delivery receipts,
   template status callbacks, and message-failure handling. These belong in
   the adapter layer, not in domain code.

### Explicit non-goals

The following are deliberately **not** part of any future WhatsApp work in this
repository:

- **No unofficial WhatsApp clients.** This includes, but is not limited to,
  `whatsapp-web.js`, Baileys, and any other library that automates the
  consumer WhatsApp Web/desktop client. These violate Meta's terms, can be
  banned without notice, and are not appropriate for a clinical booking
  system.
- **No scraping, reverse-engineering, or unofficial APIs.** The only supported
  integration path is the official Meta WhatsApp Cloud API (or an
  on-premises-equivalent Meta-approved BSP).
- **No refactor of the Telegram adapter or the booking flow** in service of
  WhatsApp. WhatsApp is added as a peer adapter; the existing Telegram code
  path is not rewritten.
- **No WhatsApp environment variables required at runtime today.** They are
  documented as future placeholders only.

### Future phase checklist (out of scope for this phase)

The items below are the minimum a future "WhatsApp enablement" phase must
deliver. None of them are implemented now.

- [ ] WhatsApp Cloud API credentials available and stored outside the repo
      (e.g. deployment secret store).
- [ ] `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
      `WHATSAPP_BUSINESS_ACCOUNT_ID` wired into a config module *gated* behind
      a feature flag so existing deployments are unaffected.
- [ ] `src/services/whatsappService.js` implementing the same outbound
      interface as `telegramService.js`.
- [ ] Webhook route with signature verification and `VERIFY_TOKEN` challenge
      handling.
- [ ] Normalized inbound shape produced for WhatsApp payloads and routed into
      the same `messageHandler` entry point.
- [ ] Approved message templates registered and mapped to outbound flows that
      need them (reminders, first contact, re-engagement).
- [ ] Phone-number-based patient lookup keyed on `channel = 'whatsapp'`.
- [ ] End-to-end test that books an appointment entirely over the WhatsApp
      adapter path, mirroring the existing Telegram booking test.
- [ ] Documentation updates: `.env.example`, `README.md` / deploy notes, and
      a note in this file marking the architecture as "active" rather than
      "future phase".
- [ ] Monitoring and alerting for webhook delivery failures and Cloud API
      error rates.

### What stays unchanged

Telegram remains the only live transport today. No existing features were
intentionally removed or rewritten as part of preparing the architecture for
WhatsApp.
