import * as XLSX from 'xlsx';

function safeParseFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val)
    .replace(/,{2,}/g, ',')    // "14,,5" → "14,5"
    .replace(',', '.')          // German decimal comma → dot
    .trim();
  if (s === '' || s.toLowerCase().includes('nicht gefunden')) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export interface ArtikelRow {
  artikelnummer: string;
  bezeichnung: string;
  hoehe_mm: number;        // 0 if missing/null in source
  breite_mm: number;       // 0 if missing/null in source
  laenge_mm: number;       // 0 if missing/null in source
  gewicht_kg: number;      // 0 if missing/null in source
  volumen_l?: number;
  grundflaeche_mm2: number;
  max_stapelhoehe: number;
  sperrgut?: string;       // raw Excel value, e.g. 'Lager B'; undefined if empty
}

export interface BestellungRow {
  belegnummer: string;
  artikelnummer: string;
  menge: number;
  datum?: string;
  bezeichnung?: string;    // for SON article detection in phase1
}

export interface BestandRow {
  artikelnummer: string;
  bestand: number;
}

export function parseArtikel(buffer: Buffer): ArtikelRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = 'Verpackungsvolumen Atrikel';
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  const result: ArtikelRow[] = [];

  for (const row of rows) {
    const artikelnummer = String(row['Nummer'] ?? '').trim();
    if (!artikelnummer) continue;

    // Pass sperrgut through — filtering happens in frontend phase1
    const sperrgutRaw = row['Sperrgut'];
    const sperrgut = (sperrgutRaw !== null && sperrgutRaw !== undefined && String(sperrgutRaw).trim() !== '')
      ? String(sperrgutRaw).trim()
      : undefined;

    // Weight: null → 0 (frontend detects WEIGHT_MISSING / WEIGHT_EXCEEDED)
    const gewicht_kg = safeParseFloat(row['Gewicht in kg']) ?? 0;

    // Dimensions: prefer *_cm columns (×10 → mm), fall back to bare names (already mm)
    const hoehe_mm = row['Höhe_cm'] != null
      ? (safeParseFloat(row['Höhe_cm']) ?? 0) * 10
      : (safeParseFloat(row['Höhe']) ?? 0);
    const breite_mm = row['Breite_cm'] != null
      ? (safeParseFloat(row['Breite_cm']) ?? 0) * 10
      : (safeParseFloat(row['Breite']) ?? 0);
    const laenge_mm = row['Länge_cm'] != null
      ? (safeParseFloat(row['Länge_cm']) ?? 0) * 10
      : (safeParseFloat(row['Länge']) ?? 0);

    const grundflaeche_mm2 = breite_mm * laenge_mm;
    const max_stapelhoehe = hoehe_mm > 0 ? Math.floor(320 / hoehe_mm) : 0;

    const volumen_l = row['Volumen in Liter'] ? parseFloat(String(row['Volumen in Liter'])) : undefined;

    result.push({
      artikelnummer,
      bezeichnung: String(row['Bezeichnung'] ?? '').trim(),
      hoehe_mm,
      breite_mm,
      laenge_mm,
      gewicht_kg,
      volumen_l,
      grundflaeche_mm2,
      max_stapelhoehe,
      sperrgut,
    });
  }

  return result;
}

export function parseBestellungen(buffer: Buffer): BestellungRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets['Bestellungen'] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('No sheet found in Bestellungen file');

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  const result: BestellungRow[] = [];

  for (const row of rows) {
    const artikelnummer = String(row['Nummer'] ?? '').trim();
    if (!artikelnummer) continue;

    const belegnummer = String(row['Beleg-Nr.'] ?? '').trim();
    if (!belegnummer) continue;

    const menge = parseInt(String(row['Menge'] ?? '0'), 10);
    if (!menge || menge <= 0) continue;

    // Datum: Excel stores dates as serial numbers
    let datum: string | undefined;
    if (row['Datum']) {
      try {
        const d = XLSX.SSF.parse_date_code(row['Datum'] as number);
        datum = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      } catch {
        datum = String(row['Datum']);
      }
    }

    const bezeichnungRaw = String(row['Bezeichnung'] ?? '').trim();
    const bezeichnung = bezeichnungRaw || undefined;

    result.push({ belegnummer, artikelnummer, menge, datum, bezeichnung });
  }

  return result;
}

export function parseBestand(buffer: Buffer): BestandRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]]; // dynamic sheet name like "2026-03-13"
  if (!ws) throw new Error('No sheet found in Bestandsliste');

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  const result: BestandRow[] = [];

  for (const row of rows) {
    const artikelnummer = String(row['nummer'] ?? '').trim();
    if (!artikelnummer) continue;

    const rawBestand = String(row['gesamt_x'] ?? '0');
    const bestand = parseInt(rawBestand.replace(/\s/g, ''), 10);
    if (!bestand || bestand <= 0) continue;

    result.push({ artikelnummer, bestand });
  }

  return result;
}
