import '../src/index.js';
import { handleTelegramMessage, handleTelegramCallback } from '../src/bot.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('OK');
    }

    const update = req.body;
    try {
        if (update.message) {
            await handleTelegramMessage(update.message);
        } else if (update.callback_query) {
            await handleTelegramCallback(update.callback_query);
        }
    } catch (err) {
        console.error('❌ webhook error:', err.message);
        console.error(err.stack);
    }

    res.status(200).send('OK');
}
