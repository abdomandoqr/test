import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
  process.exit(1);
}

try {
  // Node.js 20 has no native WebSocket — pass `ws` package via `realtime.transport`.
  // Node.js 22+ provides WebSocket natively and this option is unnecessary.
  const supabase = createClient(url, key, {
    realtime: {
      transport: ws,
    },
  });

  if (!supabase) {
    throw new Error('createClient returned an invalid object');
  }

  console.log('Supabase client initialized successfully');
} catch (error) {
  console.error('Supabase initialization failed:', error.message);
  process.exit(1);
}