import { describe, it } from 'node:test';
import assert from 'node:assert';
import { toJson, toCsv, PROSPECT_FIELDS } from '../src/utils/prospectFormatter.js';

describe('prospectFormatter', () => {
    const sampleProspect = {
        name: 'Riyadh Dental Clinic',
        city: 'Riyadh',
        category: 'dental clinic',
        country: 'Saudi Arabia',
        phone: '+966 11 123 4567',
        email: 'info@riyadh-dental.example',
        website: 'https://riyadh-dental.example',
        address: 'King Fahd Rd, Riyadh',
        source: 'gemini-google-search',
    };

    describe('toJson', () => {
        it('returns a valid JSON string for an array of prospects', () => {
            const out = toJson([sampleProspect]);
            assert.strictEqual(typeof out, 'string');
            const parsed = JSON.parse(out);
            assert.ok(Array.isArray(parsed));
            assert.strictEqual(parsed.length, 1);
            assert.deepStrictEqual(parsed[0], sampleProspect);
        });

        it('emits pretty-printed JSON by default', () => {
            const out = toJson([sampleProspect]);
            assert.ok(out.includes('\n'), 'expected pretty output to contain newlines');
            assert.ok(out.includes('  '), 'expected pretty output to contain 2-space indent');
        });

        it('emits compact JSON when pretty=false', () => {
            const out = toJson([sampleProspect], false);
            assert.ok(!out.includes('\n'), 'compact output should not contain newlines');
            const parsed = JSON.parse(out);
            assert.deepStrictEqual(parsed[0], sampleProspect);
        });

        it('handles an empty array', () => {
            const out = toJson([]);
            assert.strictEqual(JSON.parse(out).length, 0);
        });

        it('treats null/undefined input as an empty array', () => {
            assert.strictEqual(JSON.parse(toJson(null)).length, 0);
            assert.strictEqual(JSON.parse(toJson(undefined)).length, 0);
        });

        it('preserves prospects that have missing optional fields', () => {
            const minimal = { name: 'A', city: 'B', category: 'C', country: 'D' };
            const parsed = JSON.parse(toJson([minimal]));
            assert.strictEqual(parsed[0].name, 'A');
            assert.strictEqual(parsed[0].phone, undefined);
        });

        it('returns valid JSON for multiple prospects', () => {
            const list = [sampleProspect, { ...sampleProspect, name: 'Second Clinic' }];
            const parsed = JSON.parse(toJson(list));
            assert.strictEqual(parsed.length, 2);
            assert.strictEqual(parsed[1].name, 'Second Clinic');
        });
    });

    describe('toCsv', () => {
        it('starts with the expected header row', () => {
            const out = toCsv([]);
            const header = out.split('\r\n')[0];
            assert.strictEqual(header, PROSPECT_FIELDS.join(','));
        });

        it('always quotes every field', () => {
            const out = toCsv([sampleProspect]);
            const dataLine = out.split('\r\n')[1];
            for (const field of PROSPECT_FIELDS) {
                const quoted = `"${sampleProspect[field] ?? ''}"`;
                assert.ok(dataLine.includes(quoted), `expected data line to contain ${quoted}`);
            }
        });

        it('produces a row for each prospect', () => {
            const out = toCsv([sampleProspect, { ...sampleProspect, name: 'Second' }]);
            const lines = out.split('\r\n').filter((line) => line.length > 0);
            // header + 2 data rows
            assert.strictEqual(lines.length, 3);
        });

        it('escapes embedded double quotes by doubling them', () => {
            const tricky = {
                ...sampleProspect,
                name: 'Clinic "Smile" Co.',
            };
            const out = toCsv([tricky]);
            assert.ok(out.includes('"Clinic ""Smile"" Co."'));
        });

        it('preserves embedded commas inside quoted fields', () => {
            const tricky = { ...sampleProspect, address: 'King Fahd Rd, Riyadh, KSA' };
            const out = toCsv([tricky]);
            const parsed = parseCsv(out);
            assert.strictEqual(parsed[1][PROSPECT_FIELDS.indexOf('address')], 'King Fahd Rd, Riyadh, KSA');
        });

        it('preserves embedded newlines inside quoted fields', () => {
            const tricky = { ...sampleProspect, address: 'Line 1\nLine 2' };
            const out = toCsv([tricky]);
            const parsed = parseCsv(out);
            assert.strictEqual(parsed[1][PROSPECT_FIELDS.indexOf('address')], 'Line 1\nLine 2');
        });

        it('renders missing optional fields as empty strings', () => {
            const minimal = { name: 'A', city: 'B', category: 'C', country: 'D' };
            const out = toCsv([minimal]);
            const parsed = parseCsv(out);
            assert.strictEqual(parsed.length, 2, 'expected header + 1 row');
            const row = parsed[1];
            assert.strictEqual(row[PROSPECT_FIELDS.indexOf('name')], 'A');
            assert.strictEqual(row[PROSPECT_FIELDS.indexOf('phone')], '');
            assert.strictEqual(row[PROSPECT_FIELDS.indexOf('email')], '');
            assert.strictEqual(row[PROSPECT_FIELDS.indexOf('website')], '');
            assert.strictEqual(row[PROSPECT_FIELDS.indexOf('address')], '');
            assert.strictEqual(row[PROSPECT_FIELDS.indexOf('source')], '');
        });

        it('handles an empty array (header only)', () => {
            const out = toCsv([]);
            assert.strictEqual(out, `${PROSPECT_FIELDS.join(',')}\r\n`);
        });

        it('treats null/undefined input as empty', () => {
            assert.strictEqual(toCsv(null), `${PROSPECT_FIELDS.join(',')}\r\n`);
            assert.strictEqual(toCsv(undefined), `${PROSPECT_FIELDS.join(',')}\r\n`);
        });

        it('handles a prospect that is missing all fields without crashing', () => {
            assert.doesNotThrow(() => toCsv([{}]));
            const parsed = parseCsv(toCsv([{}]));
            assert.strictEqual(parsed[1][PROSPECT_FIELDS.indexOf('name')], '');
        });

        it('coerces non-string field values to strings', () => {
            const numeric = { ...sampleProspect, phone: 1234567 };
            const parsed = parseCsv(toCsv([numeric]));
            assert.strictEqual(parsed[1][PROSPECT_FIELDS.indexOf('phone')], '1234567');
        });

        it('ends with a trailing CRLF', () => {
            const out = toCsv([sampleProspect]);
            assert.ok(out.endsWith('\r\n'));
        });
    });
});

// Minimal RFC 4180 CSV parser sufficient for these tests. Handles quoted
// fields with embedded doubled-quotes, commas, and newlines.
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i += 1;
                continue;
            }
            field += ch;
            i += 1;
        } else {
            if (ch === '"') {
                inQuotes = true;
                i += 1;
            } else if (ch === ',') {
                row.push(field);
                field = '';
                i += 1;
            } else if (ch === '\r' && text[i + 1] === '\n') {
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
                i += 2;
            } else if (ch === '\n') {
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
                i += 1;
            } else {
                field += ch;
                i += 1;
            }
        }
    }
    // Final field/row (if input does not end with CRLF).
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}
