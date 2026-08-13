/**
 * index.js — Dental bot entry point.
 *
 * - Loads environment from .env FIRST
 * - Then dynamically imports config (after env is loaded)
 * - Local dev: polling (when WEBHOOK_URL is unset)
 * - Production (Vercel): webhook mode — api/telegram.js calls bot.processUpdate()
 */

import dotenv from 'dotenv';
dotenv.config();

let config;
await import('./config.js').then(m => { config = m.config; });
await import('./bot.js'); // registers bot.on('message') / bot.on('callback_query')

const { bot } = await import('./services/telegramService.js');

console.log('🦷 Dental Bot — Phase 5 (webhook-ready)');
console.log(`   Environment: ${config.env}`);

if (!process.env.WEBHOOK_URL && config.env !== 'test') {
    bot.startPolling()
        .then(() => console.log('✅ Bot polling started (local dev mode)'))
        .catch((err) => {
            console.error('❌ Failed to start polling:', err.message);
            process.exit(1);
        });
} else if (process.env.WEBHOOK_URL) {
    console.log(`   Webhook mode active: ${process.env.WEBHOOK_URL}`);
}

export { bot };
