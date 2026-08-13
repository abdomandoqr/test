#!/usr/bin/env node
/**
 * migrate.js — Apply SQL migrations and seed to Supabase.
 *
 * Requires ONE of:
 *   - SUPABASE_SERVICE_ROLE_KEY in .env (preferred for DDL)
 *   - DATABASE_URL in .env (postgres connection string)
 *
 * Falls back to SUPABASE_ANON_KEY but DDL will fail without elevated perms.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

const MIGRATIONS_DIR = path.resolve('supabase/migrations');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL) {
    console.error('❌ SUPABASE_URL not set in .env');
    process.exit(1);
}

// Parse URL to ensure it's the base URL (not /rest/v1/)
const baseUrl = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '');

function getMigrationFiles() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
}

async function runViaPostgres(sql) {
    if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
    const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    try {
        await pool.query(sql);
    } finally {
        await pool.end();
    }
}

async function runViaSupabaseRpc(sql) {
    // Supabase exposes `pgmq` or custom RPC for SQL exec; but simplest is REST with service role
    // Use the SQL endpoint if available, or create a temporary function.
    // For reliability, we use the Management API or just pg directly.
    throw new Error('RPC execution not implemented — use DATABASE_URL or service_role with psql');
}

async function applyMigration(file, sql) {
    console.log(`\n📄 Applying ${file}...`);

    if (DATABASE_URL) {
        console.log('   → Using DATABASE_URL (postgres direct)');
        await runViaPostgres(sql);
        console.log('   ✓ Done');
        return;
    }

    if (SERVICE_ROLE_KEY) {
        console.log('   → Using SERVICE_ROLE_KEY via Supabase REST');
        // Use the Supabase REST API with service role for DDL
        const resp = await fetch(`${baseUrl}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: {
                'apikey': SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ sql })
        });
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`REST exec failed: ${resp.status} ${err}`);
        }
        console.log('   ✓ Done');
        return;
    }

    // Last resort: anon key (will fail for DDL)
    console.log('   ⚠ Using ANON_KEY — DDL will likely fail (insufficient privileges)');
    const resp = await fetch(`${baseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
            'apikey': ANON_KEY,
            'Authorization': `Bearer ${ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ sql })
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`REST exec failed with anon: ${resp.status} ${err}`);
    }
    console.log('   ✓ Done (unexpected success)');
}

async function main() {
    console.log('═══════════════════════════════════════');
    console.log('  Dental Bot — Supabase Migration');
    console.log('═══════════════════════════════════════');
    console.log(`Project: ${baseUrl}`);

    if (!SERVICE_ROLE_KEY && !DATABASE_URL) {
        console.warn('\n⚠️  WARNING: No SERVICE_ROLE_KEY or DATABASE_URL found.');
        console.warn('   DDL (CREATE TABLE, etc.) requires elevated privileges.');
        console.warn('   ANON_KEY cannot create tables.');
        console.warn('\n   Options:');
        console.warn('   1. Add SUPABASE_SERVICE_ROLE_KEY to .env (from Supabase Dashboard → Settings → API)');
        console.warn('   2. Add DATABASE_URL to .env (from Supabase Dashboard → Settings → Database → Connection string)');
        console.warn('   3. Run migrations manually: psql "$DATABASE_URL" -f supabase/migrations/*.sql\n');
    }

    const files = getMigrationFiles();
    if (files.length === 0) {
        console.log('No migration files found in supabase/migrations/');
        return;
    }

    console.log(`\nFound ${files.length} migration file(s):`);
    files.forEach(f => console.log(`  - ${f}`));

    for (const file of files) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
        try {
            await applyMigration(file, sql);
        } catch (e) {
            console.error(`\n❌ Failed to apply ${file}:`);
            console.error(e.message);
            process.exit(1);
        }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('  All migrations applied successfully');
    console.log('═══════════════════════════════════════');
}

main().catch(e => {
    console.error('Fatal error:', e.message);
    process.exit(1);
});