import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ArtikelData, BestellungData, UmsatzData, BestandData } from '../types';
import {
  ARTIKELLISTE_MAPPING,
  BESTELLUNGEN_MAPPING,
  UMSATZ_MAPPING,
  BESTAND_MAPPING,
  EXPECTED_SHEETS,
  mapAndParseRows,
} from './csvMapping';

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

  // Try to find a matching sheet name
  let sheetName = wb.SheetNames[0];
  for (const sn of wb.SheetNames) {
    if (sn === EXPECTED_SHEETS.artikelliste ||
        sn === EXPECTED_SHEETS.bestellungen ||
        sn === EXPECTED_SHEETS.artikelumsatz ||
        EXPECTED_SHEETS.bestandsliste.test(sn)) {
      sheetName = sn;
      break;
    }
  }

  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
}

export function mapArtikel(rows: Record<string, unknown>[]): ArtikelData[] {
  return mapAndParseRows<ArtikelData>(
    rows,
    ARTIKELLISTE_MAPPING,
    ['hoehe', 'breite', 'laenge', 'gewicht_kg', 'volumen_l'],
  );
}

export function mapBestellungen(rows: Record<string, unknown>[]): BestellungData[] {
  return mapAndParseRows<BestellungData>(
    rows,
    BESTELLUNGEN_MAPPING,
    ['menge'],
  );
}

export function mapUmsatz(rows: Record<string, unknown>[]): UmsatzData[] {
  const mapped = mapAndParseRows<Record<string, unknown>>(
    rows,
    UMSATZ_MAPPING,
    ['artikelmenge'],
  );
  return mapped.map((row) => ({
    artikelnummer: String(row.artikelnummer),
    umsatz: [Number(row.artikelmenge) || 0],
  }));
}

export function mapBestand(rows: Record<string, unknown>[]): BestandData[] {
  const raw = mapAndParseRows<Record<string, unknown>>(
    rows,
    BESTAND_MAPPING,
    [],
  );
  return raw.map((row) => {
    const val = row.bestand;
    const bestand = typeof val === 'string'
      ? parseInt(val.replace(/\s/g, ''), 10) || 0
      : Number(val) || 0;
    return {
      artikelnummer: String(row.artikelnummer),
      bestand,
    };
  });
}

const REQUIRED_FIELDS: Record<string, string[]> = {
  artikel: ['Nummer', 'Bezeichnung', 'Höhe', 'Breite', 'Länge', 'Gewicht in kg'],
  bestellungen: ['Nummer', 'Menge', 'Beleg-Nr.'],
  umsatz: ['Nummer', 'Artikelmenge'],
  bestand: ['nummer', 'gesamt_x'],
};

export function validateHeaders(rows: Record<string, unknown>[], fileType: string): { valid: boolean; missing: string[] } {
  if (rows.length === 0) return { valid: false, missing: ['Keine Daten'] };
  const headers = Object.keys(rows[0]);
  const required = REQUIRED_FIELDS[fileType] ?? [];
  const missing = required.filter((r) => !headers.includes(r));
  return { valid: missing.length === 0, missing };
}
