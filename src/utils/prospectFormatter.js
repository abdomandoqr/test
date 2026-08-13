/**
 * Format an array of prospect objects as JSON or CSV.
 *
 * Prospect shape (from src/services/prospectFinder.js):
 *   {
 *     name: string,
 *     city: string,
 *     category: string,
 *     country: string,
 *     phone?: string,
 *     email?: string,
 *     website?: string,
 *     address?: string,
 *     source?: string
 *   }
 *
 * The formatter is defensive: missing optional fields are rendered as empty
 * strings rather than throwing.
 */

export const PROSPECT_FIELDS = [
    'name',
    'city',
    'category',
    'country',
    'phone',
    'email',
    'website',
    'address',
    'source',
];

function asArray(results) {
    if (Array.isArray(results)) return results;
    if (results == null) return [];
    return [];
}

function pickField(prospect, field) {
    if (prospect && Object.prototype.hasOwnProperty.call(prospect, field)) {
        const value = prospect[field];
        if (value === null || value === undefined) return '';
        return String(value);
    }
    return '';
}

/**
 * Serialize results as a JSON string.
 *
 * @param {Array<object>} results
 * @param {boolean} pretty  When true (default) emit indented JSON.
 * @returns {string}
 */
export function toJson(results, pretty = true) {
    const list = asArray(results);
    return JSON.stringify(list, null, pretty ? 2 : 0);
}

/**
 * Quote a single CSV field per RFC 4180: wrap in double quotes and escape
 * any embedded double quote by doubling it. Embedded commas and newlines
 * are preserved inside the quotes.
 */
function csvField(value) {
    const stringValue = value == null ? '' : String(value);
    return `"${stringValue.replace(/"/g, '""')}"`;
}

/**
 * Serialize results as a CSV string with a header row. Every field is
 * double-quoted; embedded quotes are escaped by doubling.
 *
 * @param {Array<object>} results
 * @returns {string}
 */
export function toCsv(results) {
    const list = asArray(results);
    const lines = [PROSPECT_FIELDS.join(',')];
    for (const prospect of list) {
        const row = PROSPECT_FIELDS.map((field) => csvField(pickField(prospect, field)));
        lines.push(row.join(','));
    }
    // Use CRLF per RFC 4180.
    return lines.join('\r\n') + '\r\n';
}
