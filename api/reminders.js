import { run } from '../scripts/send_reminders.mjs';

export default async function handler(req, res) {
    const auth = req.headers.authorization;
    const secretMatch = auth === `Bearer ${process.env.CRON_SECRET}`
        || req.query.secret === process.env.CRON_SECRET;

    if (!secretMatch) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    try {
        await run();
        res.status(200).json({ ok: true });
    } catch (err) {
        console.error('❌ reminders cron error:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
}
