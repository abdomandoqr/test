import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('Error: GEMINI_API_KEY is not set in .env');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const model = 'gemini-3.6-flash';
const prompt = 'مرحبا، كيف حالك؟ أجب بجملة قصيرة بالعربية أو الإنجليزية.';

try {
  const result = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  const text = result.text?.trim();

  if (!text) {
    console.error('Error: Gemini returned an empty response.');
    process.exit(1);
  }

  console.log('Gemini response:');
  console.log(text);
} catch (error) {
  console.error('Gemini request failed:', error.message);
  process.exit(1);
}
