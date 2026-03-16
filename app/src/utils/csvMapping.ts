/**
 * Excel-Spalten-Mapping: Mappt tatsächliche Excel-Spaltennamen auf interne Feld-Namen.
 * Basierend auf Analyse der 4 Excel-Dateien vom 16.03.2026.
 */

export interface ColumnMapping {
  /** Name der Spalte in der Excel-Datei */
  excelColumn: string;
  /** Internes Feld im TypeScript-Interface */
  field: string;
  /** Datentyp für Parsing */
  type: 'string' | 'number' | 'boolean';
  /** Ist das Feld erforderlich? */
  required: boolean;
}

// ============================================================
// Artikelliste.xlsx – Sheet "Verpackungsvolumen Atrikel"
// ============================================================
export const ARTIKEL_MAPPING: ColumnMapping[] = [
  { excelColumn: 'Nummer',                   field: 'artikelnummer',           type: 'number',  required: true },
  { excelColumn: 'Bezeichnung',              field: 'bezeichnung',            type: 'string',  required: true },
  { excelColumn: 'Höhe',                     field: 'hoehe',                  type: 'number',  required: true },
  { excelColumn: 'Breite',                   field: 'breite',                 type: 'number',  required: true },
  { excelColumn: 'Länge',                    field: 'laenge',                 type: 'number',  required: true },
  { excelColumn: 'Gewicht in kg',            field: 'gewicht_kg',             type: 'number',  required: true },
  { excelColumn: 'Volumen in Liter',         field: 'volumen_l',              type: 'number',  required: false },
  { excelColumn: 'Sperrgut',                 field: 'sperrgut',               type: 'boolean', required: false },
  { excelColumn: 'Max Packmenge Sperrgut',   field: 'max_packmenge_sperrgut', type: 'number',  required: false },
];

// ============================================================
// Bestellungen Sauber.xlsx – Sheet "Bestellungen"
// ============================================================
export const BESTELLUNG_MAPPING: ColumnMapping[] = [
  { excelColumn: 'Beleg-Nr.',   field: 'belegnummer',    type: 'string',  required: true },
  { excelColumn: 'Nummer',      field: 'artikelnummer',  type: 'number',  required: true },
  { excelColumn: 'Menge',       field: 'menge',          type: 'number',  required: true },
  { excelColumn: 'Bezeichnung', field: 'bezeichnung',    type: 'string',  required: false },
  { excelColumn: 'Datum',       field: 'datum',          type: 'string',  required: false },
  { excelColumn: 'Kunden-Nr.',  field: 'kundennummer',   type: 'string',  required: false },
];

// ============================================================
// Artikelumsatz.xlsx – Sheet "Artikelumsatz"
// ============================================================
export const UMSATZ_MAPPING: ColumnMapping[] = [
  { excelColumn: 'Nummer',        field: 'artikelnummer', type: 'number', required: true },
  { excelColumn: 'Artikel',       field: 'bezeichnung',   type: 'string', required: false },
  { excelColumn: 'Artikelmenge',  field: 'artikelmenge',   type: 'number', required: true },
];

// ============================================================
// Bestandsliste 13.03.2026.xls – Sheet "2026-03-13"
// ============================================================
export const BESTAND_MAPPING: ColumnMapping[] = [
  { excelColumn: 'nummer',    field: 'artikelnummer', type: 'number', required: true },
  { excelColumn: 'gesamt_x',  field: 'bestand',      type: 'number', required: true },
];

// ============================================================
// Helper: Generische Excel-zu-Objekt Konvertierung
// ============================================================

/**
 * Konvertiert eine Excel-Zeile (key-value Objekt) in ein typisiertes Objekt
 * basierend auf dem Column-Mapping.
 */
export function mapRow<T>(row: Record<string, unknown>, mapping: ColumnMapping[]): T | null {
  const result: Record<string, unknown> = {};

  for (const col of mapping) {
    const raw = row[col.excelColumn];

    if (raw === undefined || raw === null || raw === '') {
      if (col.required) return null; // Skip rows with missing required fields
      result[col.field] = col.type === 'number' ? 0 : col.type === 'boolean' ? false : '';
      continue;
    }

    switch (col.type) {
      case 'number': {
        const parsed = typeof raw === 'number' ? raw : parseFloat(String(raw).trim());
        if (isNaN(parsed)) {
          if (col.required) return null;
          result[col.field] = 0;
        } else {
          result[col.field] = parsed;
        }
        break;
      }
      case 'boolean':
        result[col.field] = raw === true || raw === 1 || String(raw).toLowerCase() === 'ja' || String(raw) === '1';
        break;
      case 'string':
      default:
        result[col.field] = String(raw).trim();
        break;
    }
  }

  return result as T;
}

/**
 * Konvertiert ein Array von Excel-Zeilen in typisierte Objekte.
 * Filtert ungültige Zeilen (mit fehlenden Pflichtfeldern) heraus.
 */
export function mapRows<T>(rows: Record<string, unknown>[], mapping: ColumnMapping[]): T[] {
  const results: T[] = [];
  for (const row of rows) {
    const mapped = mapRow<T>(row, mapping);
    if (mapped !== null) {
      results.push(mapped);
    }
  }
  return results;
}

// ============================================================
// Expected Sheet Names
// ============================================================

export const EXPECTED_SHEETS = {
  artikelliste: 'Verpackungsvolumen Atrikel',
  bestellungen: 'Bestellungen',
  artikelumsatz: 'Artikelumsatz',
  bestandsliste: /^\d{4}-\d{2}-\d{2}$/, // Dynamic date-based sheet name
} as const;
