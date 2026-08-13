/**
 * services/prospectFinder.js — Discover business prospects via Gemini + Google Search grounding.
 *
 * Calls the @google/genai SDK with google_search grounding and asks the model for
 * structured contact data. Returns normalized prospects enriched with the input
 * country/category/city so downstream consumers can render them without re-joining
 * context.
 *
 * IMPORTANT: This module deliberately does NOT import src/config.js — that module
 * validates Telegram/Supabase env vars on load and would prevent the CLI from
 * starting in environments where only GEMINI_API_KEY is configured.
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Build the prompt that asks Gemini for structured prospect data.
 *
 * @param {{ country: string, category: string, city: string, maxPerCity: number }} opts
 * @returns {string}
 */
function buildPrompt({ country, category, city, maxPerCity }) {
    return (
        `List up to ${maxPerCity} ${category} businesses in ${city}, ${country}. ` +
        `For each business, return the name, phone, email, website, and address. ` +
        `Return ONLY a JSON object with a top-level key "results" containing an array of objects. ` +
        `Do not include markdown formatting, code fences, or any prose before or after the JSON.`
    );
}

/**
 * Extract a balanced JSON object containing a top-level `"results"` key from
 * arbitrary model output.
 *
 * The previous implementation used a non-greedy regex that stopped at the
 * first `}` after `"results"`, which truncated the object whenever the
 * `results` array contained inner objects (the normal prospect shape).
 *
 * This scanner:
 *   1. Locates the `"results"` key (with quotes) so we only target real JSON
 *      object keys, not the word appearing in prose.
 *   2. Walks backward to the opening `{` of the object containing that key.
 *   3. Walks forward counting `{` / `}` pairs to find the matching closing
 *      brace, while skipping over braces that appear inside JSON strings
 *      (including escaped quotes).
 *
 * Returns the substring from the opening `{` to the matching `}`, or `null`
 * if no balanced object containing `"results"` is found.
 *
 * @param {string} text
 * @returns {string | null}
 */
function extractResultsObject(text) {
    const idx = text.indexOf('"results"');
    if (idx === -1) return null;

    const start = text.lastIndexOf('{', idx);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escape) {
                escape = false;
            } else if (ch === '\\') {
                escape = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
}

/**
 * Extract a `results` array from arbitrary model output.
 *
 * Tries, in order:
 *   1. Direct JSON.parse on the raw text.
 *   2. Strip optional markdown fences (```json ... ```) and retry.
 *   3. Balanced-brace scan for the first JSON object containing a "results"
 *      key, then parse. The scanner handles nested objects/arrays inside
 *      `results` and ignores braces that appear inside JSON strings.
 *   4. If every attempt fails, log a warning and return [].
 *
 * @param {string} text
 * @param {(msg: string) => void} warn
 * @returns {Array<object>}
 */
function extractResults(text, warn) {
    const raw = typeof text === 'string' ? text : '';

    // Attempt 1: direct parse.
    try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.results)) {
            return parsed.results;
        }
    } catch {
        // fall through
    }

    // Attempt 2: strip markdown fences and retry.
    const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    if (stripped !== raw.trim()) {
        try {
            const parsed = JSON.parse(stripped);
            if (parsed && Array.isArray(parsed.results)) {
                return parsed.results;
            }
        } catch {
            // fall through
        }
    }

    // Attempt 3: balanced-brace scan for the first JSON object containing
    // "results". Correctly handles nested objects/arrays and braces inside
    // JSON string values.
    const candidate = extractResultsObject(raw);
    if (candidate) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && Array.isArray(parsed.results)) {
                return parsed.results;
            }
        } catch {
            // fall through
        }
    }

    warn('prospectFinder: failed to extract JSON from model output; returning empty results');
    return [];
}

/**
 * Normalize a single prospect record. Guarantees the input country/category/city
 * are present (overriding whatever the model returned) and provides a default
 * `name`. Unknown optional fields are preserved when the model supplies them.
 *
 * @param {object} raw
 * @param {{ country: string, category: string, city: string }} ctx
 * @returns {object}
 */
function normalizeProspect(raw, ctx) {
    const prospect = {
        name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name : 'Unknown',
        city: ctx.city,
        category: ctx.category,
        country: ctx.country,
    };

    if (typeof raw?.phone === 'string' && raw.phone.trim()) {
        prospect.phone = raw.phone.trim();
    }
    if (typeof raw?.email === 'string' && raw.email.trim()) {
        prospect.email = raw.email.trim();
    }
    if (typeof raw?.website === 'string' && raw.website.trim()) {
        prospect.website = raw.website.trim();
    }
    if (typeof raw?.address === 'string' && raw.address.trim()) {
        prospect.address = raw.address.trim();
    }
    if (typeof raw?.source === 'string' && raw.source.trim()) {
        prospect.source = raw.source.trim();
    }

    return prospect;
}

/**
 * Query Gemini with google_search grounding and return normalized prospects.
 *
 * @param {{
 *   country: string,
 *   category: string,
 *   city: string,
 *   maxPerCity: number,
 *   apiKey: string,
 *   model: string,
 *   client?: typeof GoogleGenAI,            // dependency-injection seam (tests)
 *   warn?: (msg: string) => void,           // override console.warn (tests)
 * }} opts
 * @returns {Promise<{ query: string, results: object[] }>}
 */
export async function findProspects({
    country,
    category,
    city,
    maxPerCity,
    apiKey,
    model,
    client,
    warn,
}) {
    if (!apiKey || typeof apiKey !== 'string') {
        throw new Error('findProspects: apiKey is required');
    }

    const effectiveClient = client ?? new GoogleGenAI({ apiKey });
    const warnFn = warn ?? ((msg) => console.warn(msg));

    const query = buildPrompt({ country, category, city, maxPerCity });

    const response = await effectiveClient.models.generateContent({
        model,
        contents: query,
        config: {
            tools: [{ googleSearch: {} }],
        },
    });

    const text = response?.text ?? '';
    const rawResults = extractResults(text, warnFn);
    const limited = rawResults.slice(0, maxPerCity);
    const results = limited.map((r) => normalizeProspect(r, { country, category, city }));

    return { query, results };
}
