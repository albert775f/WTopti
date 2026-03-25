import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DB || 'wtopti',
  user: process.env.PG_USER || 'wtopti',
  password: process.env.PG_PASSWORD || 'wtopti',
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artikel (
      artikelnummer TEXT PRIMARY KEY,
      bezeichnung TEXT,
      hoehe_mm NUMERIC NOT NULL,
      breite_mm NUMERIC NOT NULL,
      laenge_mm NUMERIC NOT NULL,
      gewicht_kg NUMERIC NOT NULL,
      volumen_l NUMERIC,
      grundflaeche_mm2 NUMERIC NOT NULL,
      max_stapelhoehe INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bestellungen (
      id SERIAL PRIMARY KEY,
      belegnummer TEXT NOT NULL,
      artikelnummer TEXT NOT NULL,
      menge INTEGER NOT NULL,
      datum TEXT
    );

    CREATE TABLE IF NOT EXISTS bestand (
      artikelnummer TEXT PRIMARY KEY,
      bestand INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Migrations: add new columns to existing tables if not present
    ALTER TABLE artikel ADD COLUMN IF NOT EXISTS sperrgut TEXT;
    ALTER TABLE bestellungen ADD COLUMN IF NOT EXISTS bezeichnung TEXT;
  `);
}

export default pool;
