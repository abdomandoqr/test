import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { parseArgs, UsageError, USAGE } from '../src/utils/prospectCli.js';

describe('prospectCli.parseArgs', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('exports', () => {
    it('exports UsageError as a class extending Error', () => {
      assert.strictEqual(typeof UsageError, 'function');
      const err = new UsageError('boom');
      assert.ok(err instanceof Error);
      assert.ok(err instanceof UsageError);
      assert.strictEqual(err.name, 'UsageError');
      assert.strictEqual(err.message, 'boom');
    });

    it('exports a non-empty USAGE string describing the CLI', () => {
      assert.strictEqual(typeof USAGE, 'string');
      assert.ok(USAGE.includes('Usage:'));
      assert.ok(USAGE.includes('--max-per-city'));
      assert.ok(USAGE.includes('--format'));
      assert.ok(USAGE.includes('--model'));
      assert.ok(USAGE.includes('--out'));
    });
  });

  describe('happy path', () => {
    it('parses positional arguments and applies defaults', () => {
      const result = parseArgs(['Saudi Arabia', 'dental clinic', 'Riyadh']);
      assert.deepStrictEqual(result, {
        country: 'Saudi Arabia',
        category: 'dental clinic',
        city: 'Riyadh',
        maxPerCity: 5,
        outFile: undefined,
        model: 'gemini-3.5-flash-lite',
        format: 'json',
      });
    });

    it('parses --max-per-city with a valid value', () => {
      const result = parseArgs([
        'Saudi Arabia', 'dental clinic', 'Riyadh', '--max-per-city', '3',
      ]);
      assert.strictEqual(result.maxPerCity, 3);
    });

    it('parses --out, --model, and --format together', () => {
      const result = parseArgs([
        'Saudi Arabia', 'dental clinic', 'Riyadh',
        '--out', 'riyadh.json',
        '--model', 'gemini-2.5-pro',
        '--format', 'csv',
        '--max-per-city', '10',
      ]);
      assert.strictEqual(result.outFile, 'riyadh.json');
      assert.strictEqual(result.model, 'gemini-2.5-pro');
      assert.strictEqual(result.format, 'csv');
      assert.strictEqual(result.maxPerCity, 10);
    });

    it('accepts flags before positional arguments', () => {
      const result = parseArgs([
        '--format', 'csv', 'Egypt', 'dental clinic', 'Cairo',
      ]);
      assert.strictEqual(result.format, 'csv');
      assert.strictEqual(result.country, 'Egypt');
      assert.strictEqual(result.city, 'Cairo');
    });
  });

  describe('--max-per-city clamping', () => {
    it('clamps values above 20 down to 20', () => {
      const result = parseArgs(['a', 'b', 'c', '--max-per-city', '999']);
      assert.strictEqual(result.maxPerCity, 20);
    });

    it('clamps values below 1 up to 1', () => {
      const result = parseArgs(['a', 'b', 'c', '--max-per-city', '0']);
      assert.strictEqual(result.maxPerCity, 1);
    });

    it('clamps negative values up to 1', () => {
      const result = parseArgs(['a', 'b', 'c', '--max-per-city', '-5']);
      assert.strictEqual(result.maxPerCity, 1);
    });
  });

  describe('--format validation', () => {
    it('accepts "json"', () => {
      const result = parseArgs(['a', 'b', 'c', '--format', 'json']);
      assert.strictEqual(result.format, 'json');
    });

    it('accepts "csv"', () => {
      const result = parseArgs(['a', 'b', 'c', '--format', 'csv']);
      assert.strictEqual(result.format, 'csv');
    });

    it('throws UsageError on unsupported format', () => {
      assert.throws(
        () => parseArgs(['a', 'b', 'c', '--format', 'xml']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /--format/);
          assert.match(err.message, /json|csv/);
          return true;
        }
      );
    });
  });

  describe('--model defaults', () => {
    it('defaults to gemini-3.5-flash-lite when GEMINI_MODEL is unset', () => {
      const result = parseArgs(['a', 'b', 'c']);
      assert.strictEqual(result.model, 'gemini-3.5-flash-lite');
    });

    it('reads GEMINI_MODEL from the environment when no --model flag is given', () => {
      process.env.GEMINI_MODEL = 'gemini-env-model';
      const result = parseArgs(['a', 'b', 'c']);
      assert.strictEqual(result.model, 'gemini-env-model');
    });

    it('--model overrides the GEMINI_MODEL env var', () => {
      process.env.GEMINI_MODEL = 'gemini-env-model';
      const result = parseArgs(['a', 'b', 'c', '--model', 'gemini-flag-model']);
      assert.strictEqual(result.model, 'gemini-flag-model');
    });
  });

  describe('--help', () => {
    it('--help throws UsageError containing USAGE', () => {
      assert.throws(
        () => parseArgs(['--help']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.strictEqual(err.message, USAGE);
          return true;
        }
      );
    });

    it('-h throws UsageError containing USAGE', () => {
      assert.throws(
        () => parseArgs(['-h']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.strictEqual(err.message, USAGE);
          return true;
        }
      );
    });

    it('--help takes precedence even when positionals are missing', () => {
      assert.throws(() => parseArgs([]), (err) => {
        assert.ok(err instanceof UsageError);
        return true;
      });
    });
  });

  describe('positional argument validation', () => {
    it('throws UsageError when more than three positionals are provided', () => {
      assert.throws(
        () => parseArgs(['Saudi', 'Arabia', 'dental', 'clinic', 'Riyadh']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /quote multi-word values/i);
          return true;
        }
      );
    });

    it('throws UsageError when city is missing', () => {
      assert.throws(
        () => parseArgs(['Saudi Arabia', 'dental clinic']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /city/);
          return true;
        }
      );
    });

    it('throws UsageError when category and city are missing', () => {
      assert.throws(
        () => parseArgs(['Saudi Arabia']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /category/);
          assert.match(err.message, /city/);
          return true;
        }
      );
    });

    it('throws UsageError when no arguments are given', () => {
      assert.throws(
        () => parseArgs([]),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /country/);
          return true;
        }
      );
    });
  });

  describe('flag value validation', () => {
    it('throws UsageError when --max-per-city value is not numeric', () => {
      assert.throws(
        () => parseArgs(['a', 'b', 'c', '--max-per-city', 'lots']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /--max-per-city/);
          return true;
        }
      );
    });

    it('throws UsageError when --max-per-city has no value', () => {
      assert.throws(
        () => parseArgs(['a', 'b', 'c', '--max-per-city']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /--max-per-city/);
          return true;
        }
      );
    });

    it('throws UsageError when --out has no value', () => {
      assert.throws(
        () => parseArgs(['a', 'b', 'c', '--out']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /--out/);
          return true;
        }
      );
    });

    it('throws UsageError when --model has no value', () => {
      assert.throws(
        () => parseArgs(['a', 'b', 'c', '--model']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /--model/);
          return true;
        }
      );
    });

    it('throws UsageError when --format has no value', () => {
      assert.throws(
        () => parseArgs(['a', 'b', 'c', '--format']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /--format/);
          return true;
        }
      );
    });
  });

  describe('unknown options', () => {
    it('throws UsageError on an unknown flag', () => {
      assert.throws(
        () => parseArgs(['a', 'b', 'c', '--bogus']),
        (err) => {
          assert.ok(err instanceof UsageError);
          assert.match(err.message, /Unknown option/);
          return true;
        }
      );
    });
  });
});
