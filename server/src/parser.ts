import * as XLSX from 'xlsx';

export interface ArtikelRow {
  artikelnummer: string;
  bezeichnung: string;
  hoehe_mm: number;
  breite_mm: number;
  laenge_mm: number;
  gewicht_kg: number;
  volumen_l?: number;
  grundflaeche_mm2: number;
  max_stapelhoehe: number;
}

export interface BestellungRow {
  belegnummer: string;
  artikelnummer: string;
  menge: number;
  datum?: string;
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

    // Skip Sperrgut articles
    const sperrgut = row['Sperrgut'];
    if (sperrgut !== null && sperrgut !== undefined && String(sperrgut).trim() !== '') continue;

    const gewicht_kg = parseFloat(String(row['Gewicht in kg'] ?? '0'));
    // Skip articles with no weight or weight > 24kg
    if (!gewicht_kg || gewicht_kg <= 0 || gewicht_kg > 24) continue;

    // Dimensions in cm → convert to mm (multiply by 10)
    const hoehe_mm = parseFloat(String(row['Höhe_cm'] ?? '0')) * 10;
    const breite_mm = parseFloat(String(row['Breite_cm'] ?? '0')) * 10;
    const laenge_mm = parseFloat(String(row['Länge_cm'] ?? '0')) * 10;

    if (!hoehe_mm || !breite_mm || !laenge_mm) continue;

    const volumen_l = row['Volumen in Liter'] ? parseFloat(String(row['Volumen in Liter'])) : undefined;
    const grundflaeche_mm2 = breite_mm * laenge_mm;
    const max_stapelhoehe = Math.floor(320 / hoehe_mm);

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
    });
  }

  return result;
}

export function parseBestellungen(buffer: Buffer): BestellungRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = 'Bestellungen';
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);

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

    result.push({ belegnummer, artikelnummer, menge, datum });
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
