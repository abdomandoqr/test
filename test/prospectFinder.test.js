import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';

/**
 * Tests for src/services/prospectFinder.js.
 *
 * We mock @google/genai with mock.module so no real network calls happen.
 * Each test installs its own return value via mockResponses.push(...).
 */

describe('prospectFinder.findProspects', () => {
    let findProspects;
    let mockResponses;
    let warned;
    let lastGenerateCall;

    before(async () => {
        mockResponses = [];
        warned = [];
        lastGenerateCall = null;

        // The mock matches the SDK shape used by prospectFinder:
        // new GoogleGenAI({ apiKey }) -> { models: { generateContent(...) } }
        mock.module('@google/genai', {
            namedExports: {
                GoogleGenAI: class MockGoogleGenAI {
                    constructor(opts) {
                        this.apiKey = opts?.apiKey;
                    }
                    models = {
                        generateContent: async (params) => {
                            lastGenerateCall = params;
                            const next = mockResponses.shift();
                            if (!next) {
                                throw new Error('MockGoogleGenAI: no mock response queued');
                            }
                            return typeof next === 'function' ? next(params) : next;
                        },
                    };
                },
            },
        });

        const mod = await import('../src/services/prospectFinder.js');
        findProspects = mod.findProspects;
    });

    after(() => {
        mock.reset();
    });

    const baseOpts = () => ({
        country: 'Saudi Arabia',
        category: 'dental clinic',
        city: 'Riyadh',
        maxPerCity: 5,
        apiKey: 'test-key',
        model: 'gemini-test',
    });

    it('parses a clean JSON response and returns normalized prospects', async () => {
        mockResponses.push({
            text: JSON.stringify({
                results: [
                    { name: 'Smile Co', phone: '+966111111111', email: 'a@b.c', website: 'https://x', address: '123 Rd' },
                    { name: 'Pearl Dental', phone: '+966222222222' },
                ],
            }),
        });

        const out = await findProspects(baseOpts());

        assert.strictEqual(out.results.length, 2);
        assert.strictEqual(out.results[0].name, 'Smile Co');
        assert.strictEqual(out.results[0].country, 'Saudi Arabia');
        assert.strictEqual(out.results[0].category, 'dental clinic');
        assert.strictEqual(out.results[0].city, 'Riyadh');
        assert.strictEqual(out.results[0].phone, '+966111111111');
        assert.strictEqual(out.results[1].name, 'Pearl Dental');
        assert.ok(typeof out.query === 'string' && out.query.includes('Riyadh'));
    });

    it('parses responses wrapped in markdown fences', async () => {
        mockResponses.push({
            text:
                '```json\n' +
                JSON.stringify({
                    results: [{ name: 'Fenced Clinic', phone: '+966555555555' }],
                }) +
                '\n```',
        });

        const out = await findProspects(baseOpts());

        assert.strictEqual(out.results.length, 1);
        assert.strictEqual(out.results[0].name, 'Fenced Clinic');
    });

    it('parses via the "results"-object balanced-brace fallback when fences and direct parse fail', async () => {
        // Surrounding prose forces the scanner-based extraction path. The
        // payload is shaped like a realistic model response: a `results` array
        // containing inner objects. A naive non-greedy regex would stop at the
        // first `}` (the closing brace of the first inner object) and produce
        // invalid JSON; the balanced-brace scanner must walk past the inner
        // object to the matching outer `}`.
        const inner = JSON.stringify({ results: [{ name: 'Regex Clinic', phone: '+966111111111' }] });
        mockResponses.push({
            text: `Here you go: ${inner} -- end of response`,
        });

        const out = await findProspects({
            ...baseOpts(),
            warn: (msg) => warned.push(msg),
        });

        // Extraction succeeded (length matches the array), and no fallback
        // warning was emitted. The nested object's `name` is preserved.
        assert.strictEqual(out.results.length, 1);
        assert.strictEqual(out.results[0].name, 'Regex Clinic');
        assert.strictEqual(out.results[0].phone, '+966111111111');
        assert.deepStrictEqual(warned, []);
    });

    it('falls back to [] with a warning when JSON cannot be extracted', async () => {
        mockResponses.push({ text: 'Sorry, I could not find any matching businesses.' });

        const out = await findProspects({
            ...baseOpts(),
            warn: (msg) => warned.push(msg),
        });

        assert.deepStrictEqual(out.results, []);
        assert.strictEqual(warned.length, 1);
        assert.match(warned[0], /prospectFinder/);
    });

    it('throws a clear error when apiKey is missing', async () => {
        const opts = baseOpts();
        delete opts.apiKey;
        await assert.rejects(
            () => findProspects(opts),
            (err) => {
                assert.ok(err instanceof Error);
                assert.match(err.message, /apiKey/);
                return true;
            },
        );
    });

    it('throws a clear error when apiKey is an empty string', async () => {
        const opts = { ...baseOpts(), apiKey: '' };
        await assert.rejects(
            () => findProspects(opts),
            (err) => {
                assert.ok(err instanceof Error);
                assert.match(err.message, /apiKey/);
                return true;
            },
        );
    });

    it('truncates results to maxPerCity', async () => {
        const big = {
            results: Array.from({ length: 10 }, (_, i) => ({
                name: `Clinic ${i + 1}`,
                phone: `+9660000000${i}`,
            })),
        };
        mockResponses.push({ text: JSON.stringify(big) });

        const out = await findProspects({ ...baseOpts(), maxPerCity: 3 });

        assert.strictEqual(out.results.length, 3);
        assert.strictEqual(out.results[0].name, 'Clinic 1');
        assert.strictEqual(out.results[2].name, 'Clinic 3');
    });

    it('defaults missing names to "Unknown" but keeps input geo context', async () => {
        mockResponses.push({
            text: JSON.stringify({
                results: [{ phone: '+966999999999' }],
            }),
        });

        const out = await findProspects(baseOpts());

        assert.strictEqual(out.results.length, 1);
        assert.strictEqual(out.results[0].name, 'Unknown');
        assert.strictEqual(out.results[0].country, 'Saudi Arabia');
        assert.strictEqual(out.results[0].category, 'dental clinic');
        assert.strictEqual(out.results[0].city, 'Riyadh');
        assert.strictEqual(out.results[0].phone, '+966999999999');
    });

    it('calls Gemini with googleSearch tool grounding', async () => {
        mockResponses.push({ text: JSON.stringify({ results: [] }) });

        await findProspects(baseOpts());

        assert.ok(lastGenerateCall, 'generateContent should have been called');
        assert.strictEqual(lastGenerateCall.model, 'gemini-test');
        assert.ok(typeof lastGenerateCall.contents === 'string');
        assert.deepStrictEqual(lastGenerateCall.config, { tools: [{ googleSearch: {} }] });
    });
});
