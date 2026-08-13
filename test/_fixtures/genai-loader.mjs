/**
 * Node.js loader hook used by test/find-dental-prospects.integration.test.js
 * to stub out the @google/genai package so the CLI can be exercised end-to-end
 * without making any real API calls.
 *
 * The mocked module exposes a GoogleGenAI class whose models.generateContent
 * returns a JSON response from the MOCK_GENAI_RESPONSE environment variable
 * (defaulting to a single-prospect response), wrapping it in markdown fences
 * to also exercise the fence-stripping extraction path.
 */

const DEFAULT_RESPONSE = JSON.stringify({
  results: [
    {
      name: 'Riyadh Smile Center',
      phone: '+966111111111',
      email: 'hello@riyadhsmile.example',
      website: 'https://riyadhsmile.example',
      address: 'King Fahd Rd, Riyadh',
    },
    {
      name: 'Pearl Dental Clinic',
      phone: '+966122222222',
    },
  ],
});

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@google/genai') {
    return {
      url: 'node:genai-mock',
      shortCircuit: true,
      format: 'module',
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'node:genai-mock') {
    const responseText =
      process.env.MOCK_GENAI_RESPONSE && process.env.MOCK_GENAI_RESPONSE.length > 0
        ? process.env.MOCK_GENAI_RESPONSE
        : DEFAULT_RESPONSE;

    // Wrap in markdown fences to exercise the fence-stripping extraction path.
    const fenced = '```json\n' + responseText + '\n```';

    const source = `
const MOCK_TEXT = ${JSON.stringify(fenced)};

export class GoogleGenAI {
  constructor(opts) {
    this.apiKey = opts && opts.apiKey;
    this.calls = [];
  }
  models = {
    generateContent: async (params) => {
      this.calls.push(params);
      return { text: MOCK_TEXT };
    },
  };
}
`;

    return {
      format: 'module',
      shortCircuit: true,
      source,
    };
  }
  return nextLoad(url, context);
}

// Mark this file as a module so Node treats it as ESM.
export const _isModule = true;
