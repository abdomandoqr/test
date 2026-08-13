/**
 * Integration test for scripts/find-dental-prospects.mjs.
 *
 * Runs the CLI as a child process with:
 *   - GEMINI_API_KEY set to a fake value
 *   - @google/genai mocked via a Node.js loader hook
 *
 * No real network calls happen. The loader hook
 * (test/_fixtures/genai-loader.mjs) substitutes @google/genai with an
 * in-memory stub whose models.generateContent returns a deterministic
 * prospect payload (optionally wrapped in markdown fences to exercise the
 * extractor's fence-stripping path).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'find-dental-prospects.mjs');
const LOADER = path.join(HERE, '_fixtures', 'genai-loader.mjs');

function runCli(args, { env = {}, cwd = ROOT } = {}) {
  return spawnSync(
    process.execPath,
    ['--experimental-loader', LOADER, SCRIPT, ...args],
    {
      cwd,
      env: {
        ...process.env,
        GEMINI_API_KEY: 'test-api-key-not-real',
        // Suppress dotenv from picking up a stray .env file with no key.
        ...env,
      },
      encoding: 'utf8',
      timeout: 30000,
    }
  );
}

describe('find-dental-prospects CLI (integration)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospects-cli-test-'));
  });

  after(() => {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  it('prints usage and exits 1 on --help', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--help'],
      { encoding: 'utf8', timeout: 10000 }
    );

    assert.strictEqual(result.status, 1);
    const combined = (result.stdout || '') + (result.stderr || '');
    assert.match(combined, /Usage:/);
    assert.match(combined, /--max-per-city/);
    assert.match(combined, /--format/);
  });

  it('prints usage and exits 1 on -h', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '-h'],
      { encoding: 'utf8', timeout: 10000 }
    );

    assert.strictEqual(result.status, 1);
    const combined = (result.stdout || '') + (result.stderr || '');
    assert.match(combined, /Usage:/);
  });

  it('exits 1 with a clear error when GEMINI_API_KEY is missing', () => {
    // Set GEMINI_API_KEY to an empty string so dotenv/config does not load
    // a real key from .env, and the CLI correctly reports it as missing.
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'Saudi Arabia', 'dental clinic', 'Riyadh'],
      {
        encoding: 'utf8',
        env: { ...process.env, GEMINI_API_KEY: '' },
        timeout: 10000,
      }
    );

    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /GEMINI_API_KEY/);
  });

  it('writes JSON to stdout and a summary to stderr, with mocked GenAI', () => {
    const result = runCli(
      ['Saudi Arabia', 'dental clinic', 'Riyadh', '--max-per-city', '3']
    );

    assert.strictEqual(
      result.status,
      0,
      `expected exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );

    // Stdout must be valid JSON (an array of prospect objects).
    const prospects = JSON.parse(result.stdout);
    assert.ok(Array.isArray(prospects));
    assert.strictEqual(prospects.length, 2);
    assert.strictEqual(prospects[0].name, 'Riyadh Smile Center');
    assert.strictEqual(prospects[0].country, 'Saudi Arabia');
    assert.strictEqual(prospects[0].category, 'dental clinic');
    assert.strictEqual(prospects[0].city, 'Riyadh');
    assert.strictEqual(prospects[0].phone, '+966111111111');
    assert.strictEqual(prospects[1].name, 'Pearl Dental Clinic');

    // Summary on stderr.
    assert.match(
      result.stderr,
      /Found 2 prospects for dental clinic in Riyadh, Saudi Arabia/
    );
  });

  it('writes CSV to stdout when --format csv is used, and saves --out file', () => {
    const outFile = path.join(tmpDir, 'riyadh-clinics.csv');

    const result = runCli(
      [
        'Saudi Arabia',
        'dental clinic',
        'Riyadh',
        '--max-per-city',
        '3',
        '--format',
        'csv',
        '--out',
        outFile,
      ]
    );

    assert.strictEqual(
      result.status,
      0,
      `expected exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );

    // CSV header must be present in stdout.
    assert.match(result.stdout, /name,city,category,country/);

    // Rows for both prospects must appear in stdout.
    assert.match(result.stdout, /Riyadh Smile Center/);
    assert.match(result.stdout, /Pearl Dental Clinic/);

    // --out file must contain identical contents.
    const fileContents = fs.readFileSync(outFile, 'utf8');
    assert.strictEqual(fileContents, result.stdout);

    // Summary on stderr.
    assert.match(
      result.stderr,
      /Found 2 prospects for dental clinic in Riyadh, Saudi Arabia/
    );
  });

  it('respects --max-per-city to truncate results', () => {
    const result = runCli(
      ['Saudi Arabia', 'dental clinic', 'Riyadh', '--max-per-city', '1']
    );

    assert.strictEqual(result.status, 0);

    const prospects = JSON.parse(result.stdout);
    assert.strictEqual(prospects.length, 1);
    assert.strictEqual(prospects[0].name, 'Riyadh Smile Center');

    assert.match(
      result.stderr,
      /Found 1 prospects for dental clinic in Riyadh, Saudi Arabia/
    );
  });
});
