import '../src/index.js';
import { bot } from '../src/services/telegramService.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('OK');
    }
    try {
        await bot.processUpdate(req.body);
    } catch (err) {
        console.error('❌ webhook error:', err.message);
    }
    res.status(200).send('OK');
}
