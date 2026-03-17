import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { BestandData } from '../types';
import {
  BESTAND_MAPPING,
  EXPECTED_SHEETS,
  mapAndParseRows,
} from './csvMapping';

/**
 * Parse any CSV or Excel file into raw rows.
 * Used only for Bestandsliste uploads (Artikelliste + Bestellungen come from API).
 */
export async function parseFile(file: File): Promise<Record<string, unknown>[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    return parseCsv(file);
  }
  return parseExcel(file);
}

function parseCsv(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => resolve(result.data as Record<string, unknown>[]),
      error: (err: Error) => reject(err),
    });
  });
}

async function parseExcel(file: File): Promise<Record<string, unknown>[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });

  // Try to find a matching sheet name (date-pattern for Bestandsliste)
  let sheetName = wb.SheetNames[0];
  for (const sn of wb.SheetNames) {
    if (EXPECTED_SHEETS.bestandsliste.test(sn)) {
      sheetName = sn;
      break;
    }
  }

  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
}

/**
 * Map raw Bestandsliste rows to BestandData[].
 * Handles gesamt_x as string with spaces (e.g. "1 234" → 1234).
 * Filters out rows with bestand ≤ 0.
 */
export function mapBestand(rows: Record<string, unknown>[]): BestandData[] {
  const raw = mapAndParseRows<Record<string, unknown>>(
    rows,
    BESTAND_MAPPING,
    [],
  );
  return raw
    .map((row) => {
      const val = row.bestand;
      const bestand = typeof val === 'string'
        ? parseInt(val.replace(/\s/g, ''), 10) || 0
        : Number(val) || 0;
      return {
        artikelnummer: String(row.artikelnummer),
        bestand,
      };
    })
    .filter((b) => b.bestand > 0);
}

const REQUIRED_FIELDS: Record<string, string[]> = {
  bestand: ['nummer', 'gesamt_x'],
};

export function validateHeaders(rows: Record<string, unknown>[], fileType: string): { valid: boolean; missing: string[] } {
  if (rows.length === 0) return { valid: false, missing: ['Keine Daten'] };
  const headers = Object.keys(rows[0]);
  const required = REQUIRED_FIELDS[fileType] ?? [];
  const missing = required.filter((r) => !headers.includes(r));
  return { valid: missing.length === 0, missing };
}
