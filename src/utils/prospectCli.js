/**
 * Argument parser for the `find-dental-prospects` CLI.
 *
 * Kept isolated from `src/config.js` because that module validates Telegram /
 * Supabase credentials on import and would exit the process. The prospect CLI
 * only needs Gemini credentials.
 */

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

export const USAGE = `Usage: find-dental-prospects <country> <category> <city> [options]

Arguments:
  <country>   Country name (quote if it contains spaces)
  <category>  Business category (quote if it contains spaces)
  <city>      City name (quote if it contains spaces)

Options:
  --max-per-city <N>  Maximum prospects per city (default 5, clamped to 1..20)
  --out <file>        Optional output file path; omit to print only to stdout
  --model <model>     Gemini model name (default: \$GEMINI_MODEL or gemini-3.5-flash-lite)
  --format <fmt>      Output format: json or csv (default: json)
  --help, -h          Show this help and exit

Quote multi-word values so the shell keeps them as single arguments:
  node scripts/find-dental-prospects.mjs "Saudi Arabia" "dental clinic" Riyadh --max-per-city 3
`;

const VALID_FORMATS = new Set(['json', 'csv']);
const DEFAULT_MAX_PER_CITY = 5;
const MIN_MAX_PER_CITY = 1;
const MAX_MAX_PER_CITY = 20;
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_FORMAT = 'json';

/**
 * Parse CLI arguments for the prospect finder.
 *
 * @param {string[]} argv - Typically `process.argv.slice(2)`.
 * @returns {{
 *   country: string,
 *   category: string,
 *   city: string,
 *   maxPerCity: number,
 *   outFile: string | undefined,
 *   model: string,
 *   format: 'json' | 'csv'
 * }}
 * @throws {UsageError} on invalid or missing input.
 */
export function parseArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new UsageError('parseArgs expects an array of arguments');
  }

  const positional = [];
  const options = {
    maxPerCity: DEFAULT_MAX_PER_CITY,
    outFile: undefined,
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    format: DEFAULT_FORMAT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      throw new UsageError(USAGE);
    } else if (arg === '--max-per-city') {
      const value = argv[++i];
      if (value === undefined) {
        throw new UsageError('--max-per-city requires a numeric value');
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new UsageError(
          `--max-per-city must be an integer between ${MIN_MAX_PER_CITY} and ${MAX_MAX_PER_CITY} (got ${JSON.stringify(value)})`
        );
      }
      options.maxPerCity = Math.min(MAX_MAX_PER_CITY, Math.max(MIN_MAX_PER_CITY, parsed));
    } else if (arg === '--out') {
      const value = argv[++i];
      if (value === undefined) {
        throw new UsageError('--out requires a file path');
      }
      options.outFile = value;
    } else if (arg === '--model') {
      const value = argv[++i];
      if (value === undefined) {
        throw new UsageError('--model requires a model name');
      }
      options.model = value;
    } else if (arg === '--format') {
      const value = argv[++i];
      if (value === undefined) {
        throw new UsageError('--format requires a value (json or csv)');
      }
      if (!VALID_FORMATS.has(value)) {
        throw new UsageError(
          `--format must be one of: ${[...VALID_FORMATS].join(', ')} (got ${JSON.stringify(value)})`
        );
      }
      options.format = value;
    } else if (typeof arg === 'string' && (arg.startsWith('--') || (arg.startsWith('-') && arg.length > 1))) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 3) {
    throw new UsageError(
      `Too many positional arguments (got ${positional.length}: ${positional.map((p) => JSON.stringify(p)).join(', ')}). ` +
        `Expected exactly 3 (country, category, city). Quote multi-word values so the shell keeps them as a single argument, e.g. ` +
        `"Saudi Arabia" "dental clinic" Riyadh.`
    );
  }

  if (positional.length < 3) {
    const missing = ['country', 'category', 'city'].slice(positional.length);
    throw new UsageError(`Missing required argument(s): ${missing.join(', ')}\n\n${USAGE}`);
  }

  const [country, category, city] = positional;
  if (!country || !category || !city) {
    throw new UsageError('country, category, and city must all be non-empty strings');
  }

  return {
    country,
    category,
    city,
    maxPerCity: options.maxPerCity,
    outFile: options.outFile,
    model: options.model,
    format: options.format,
  };
}
