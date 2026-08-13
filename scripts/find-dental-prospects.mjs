#!/usr/bin/env node
/**
 * find-dental-prospects — CLI to discover dental-clinic sales prospects via
 * Gemini + Google Search grounding.
 *
 * Loads .env via dotenv before any other imports so GEMINI_API_KEY is
 * available to the prospect finder.
 *
 * Intentionally does NOT import src/config.js: that module validates Telegram
 * and Supabase env vars on import and would terminate this CLI when run in
 * an environment that only has Gemini credentials configured.
 */

import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';

import { parseArgs, UsageError, USAGE } from '../src/utils/prospectCli.js';
import { findProspects } from '../src/services/prospectFinder.js';
import { toJson, toCsv } from '../src/utils/prospectFormatter.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

function formatOutput(results, format) {
  if (format === 'csv') return toCsv(results);
  return toJson(results, true);
}

function writeOutFile(outFile, contents) {
  const absolute = path.resolve(outFile);
  fs.writeFileSync(absolute, contents, { encoding: 'utf8' });
}

async function main() {
  // Parse CLI args first so --help / unknown flags are caught even when the
  // API key is missing.
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(err.message);
      if (!err.message.endsWith('\n')) process.stderr.write('\n');
      process.exit(1);
    }
    throw err;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    process.stderr.write(
      'Error: GEMINI_API_KEY is required. Set it in the environment or in a .env file.\n'
    );
    process.exit(1);
  }

  const model = args.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const { results } = await findProspects({
    country: args.country,
    category: args.category,
    city: args.city,
    maxPerCity: args.maxPerCity,
    apiKey,
    model,
  });

  const output = formatOutput(results, args.format);

  process.stdout.write(output);
  if (!output.endsWith('\n')) process.stdout.write('\n');

  if (args.outFile) {
    try {
      writeOutFile(args.outFile, output);
    } catch (err) {
      process.stderr.write(`Error: failed to write output file ${args.outFile}: ${err.message}\n`);
      process.exit(1);
    }
  }

  process.stderr.write(
    `Found ${results.length} prospects for ${args.category} in ${args.city}, ${args.country}\n`
  );
}

main().catch((err) => {
  // Surface unexpected errors with a clear, single-line message and exit 1.
  const message = err && err.message ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});

// Keep USAGE exported indirectly via parseArgs for symmetry with parser tests.
// (Referenced here only to ensure the import is preserved when tree-shaking.)
void USAGE;
