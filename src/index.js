/**
 * index.js — Dental bot entry point.
 *
 * - Loads environment from .env FIRST
 * - Then dynamically imports config (after env is loaded)
 * - Starts Telegram polling
 * - Exports for testability
 */

import dotenv from 'dotenv';

// Load .env BEFORE any other imports that read process.env
dotenv.config();

// Now dynamically import modules that depend on env vars
let config, startPolling;
await import('./config.js').then(m => { config = m.config; });
await import('./services/telegramService.js').then(m => { startPolling = m.startPolling; });
await import('./bot.js'); // registers bot.on('message') and bot.on('callback_query') listeners

console.log('🦷 Dental Bot — Phase 3');
console.log(`   Environment: ${config.env}`);
console.log(`   Model:       ${config.gemini.model}`);
console.log('   Ready. Waiting for approval to start polling...');

// The user must explicitly call start() after confirming environment is set up.
// This prevents accidental startup before TELEGRAM_BOT_TOKEN is configured.

export async function start() {
    console.log('▶ Starting bot...');
    await startPolling();
    console.log('✅ Bot polling started. Listening for messages.');
}

// If NODE_ENV !== 'test', start automatically on import
// This allows the test runner to control startup.
if (config.env !== 'test') {
    start().catch((err) => {
        console.error('❌ Failed to start bot:', err.message);
        process.exit(1);
    });
}