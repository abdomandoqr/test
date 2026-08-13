/**
 * services/telegramService.js — Send messages and inline keyboards.
 *
 * Wraps node-telegram-bot-api for consistency and future webhook migration.
 *
 * All outbound text is run through substitutePlaceholders() as a final
 * safety net — no raw {{...}} or ${...} placeholders should ever reach
 * Telegram. Use the `lang` option to override auto-detection when the
 * caller knows the language (e.g. when editing a message in a known lang).
 *
 * Channel adapter boundary: this file is the Telegram outbound adapter.
 * A future WhatsApp adapter would implement the same outbound interface
 * (sendMessage, sendInlineKeyboard, editMessageText, sendTyping) so that
 * callers above this layer stay channel-agnostic.
 */
import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { substitutePlaceholders } from '../utils/clinic.js';
import { detectLanguage } from '../utils/language.js';

export const bot = new TelegramBot(config.telegram.botToken, { polling: false });

export async function startPolling() {
    await bot.startPolling();
    console.log('✅ Telegram bot polling started');
}

export async function sendMessage(chatId, text, options = {}) {
    const { lang: optLang, ...rest } = options;
    const lang = optLang || detectLanguage(text);
    const safeText = substitutePlaceholders(text, lang);
    return bot.sendMessage(chatId, safeText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...rest,
    });
}

export async function sendInlineKeyboard(chatId, text, buttons, options = {}) {
    const { lang: optLang, ...rest } = options;
    const lang = optLang || detectLanguage(text);
    const safeText = substitutePlaceholders(text, lang);
    for (const row of buttons || []) {
        for (const btn of row) {
            if (btn.callback_data && btn.callback_data.length > 64) {
                console.error(`[TELEGRAM] callback_data too long (${btn.callback_data.length} bytes): ${btn.callback_data.slice(0, 20)}...`);
            }
        }
    }
    return bot.sendMessage(chatId, safeText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: buttons,
        },
        ...rest,
    });
}

export async function editMessageText(chatId, messageId, text, buttons, options = {}) {
    const { lang: optLang, ...rest } = options;
    // Default to English when editing — caller can override with `lang`.
    const lang = optLang || 'en';
    const safeText = substitutePlaceholders(text, lang);
    for (const row of buttons || []) {
        for (const btn of row) {
            if (btn.callback_data && btn.callback_data.length > 64) {
                console.error(`[TELEGRAM] callback_data too long (${btn.callback_data.length} bytes): ${btn.callback_data.slice(0, 20)}...`);
            }
        }
    }
    return bot.editMessageText(safeText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
        ...rest,
    });
}

export async function sendTyping(chatId) {
    return bot.sendChatAction(chatId, 'typing');
}
