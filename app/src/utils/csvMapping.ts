/**
 * Excel-Spalten-Mapping: Mappt tatsächliche Excel-Spaltennamen auf TypeScript-Feldnamen.
 *
 * Basierend auf Analyse der 4 Excel-Dateien (16.03.2026):
 *
 * Artikelliste.xlsx (Sheet "Verpackungsvolumen Atrikel"):
 *   Nummer, Bezeichnung, Höhe, Breite, Länge, Gewicht in kg,
 *   Anmerkungen, Column8, Volumen in Liter, Sperrgut, Max Packmenge Sperrgut
 *
 * Bestellungen Sauber.xlsx (Sheet "Bestellungen"):
 *   VK-Stufe, Datum, Kunden-Nr., Beleg-Nr., Lfd.Nr. Pos, Menge,
 *   Nummer, Bezeichnung, Gewicht Umsatz, Gewicht Artikel,
 *   Anzahl Pakete, Gewicht Pro Paket, Versandnr., Versandart
 *
 * Artikelumsatz.xlsx (Sheet "Artikelumsatz"):
 *   Nummer, Artikel, Artikelmenge
 *
 * Bestandsliste 13.03.2026.xls (Sheet "2026-03-13"):
 *   nummer, gesamt_x
 */

// ============================================================
// Artikelliste.xlsx → ArtikelData
// ============================================================
export const ARTIKELLISTE_MAPPING: Record<string, string> = {
  'Nummer':               'artikelnummer',
  'Bezeichnung':          'bezeichnung',
  'Höhe':                 'hoehe',
  'Breite':               'breite',
  'Länge':                'laenge',
  'Gewicht in kg':        'gewicht_kg',
  'Volumen in Liter':     'volumen_l',
};

// ============================================================
// Bestellungen Sauber.xlsx → BestellungData
// ============================================================
export const BESTELLUNGEN_MAPPING: Record<string, string> = {
  'Nummer':      'artikelnummer',
  'Menge':       'menge',
  'Beleg-Nr.':   'belegnummer',
};

// ============================================================
// Artikelumsatz.xlsx → UmsatzData
// ============================================================
export const UMSATZ_MAPPING: Record<string, string> = {
  'Nummer':        'artikelnummer',
  'Artikel':       'bezeichnung',
  'Artikelmenge':  'artikelmenge',
};

// ============================================================
// Bestandsliste → BestandData
// ============================================================
export const BESTAND_MAPPING: Record<string, string> = {
  'nummer':    'artikelnummer',
  'gesamt_x':  'bestand',
};

// ============================================================
// Expected Sheet Names
// ============================================================
export const EXPECTED_SHEETS = {
  artikelliste: 'Verpackungsvolumen Atrikel',
  bestellungen: 'Bestellungen',
  artikelumsatz: 'Artikelumsatz',
  bestandsliste: /^\d{4}-\d{2}-\d{2}$/,  // dynamischer Datumsname
} as const;

// ============================================================
// Erkennt die 14 Monatsspalten in der Umsatz-Datei
// ============================================================

/**
 * Sucht nach Monatsspalten-Pattern in den Headers.
 * Die reale Datei (Artikelumsatz.xlsx) hat aktuell KEINE Monatsspalten,
 * nur "Artikelmenge" (Gesamtwert). Diese Funktion ist für den Fall vorbereitet,
 * dass zukünftig monatliche Umsatzdaten geliefert werden.
 *
 * Erkennbare Patterns: "M01"..."M14", "Jan"..."Dez", "Umsatz_M01"..."Umsatz_M14",
 * oder numerisch "1"..."14"
 */
export function detectUmsatzMonthColumns(headers: string[]): string[] {
  // Pattern 1: "Umsatz_M01" ... "Umsatz_M14"
  const umsatzPattern = headers.filter(h => /^Umsatz_M\d{2}$/i.test(h));
  if (umsatzPattern.length > 0) {
    return umsatzPattern.sort();
  }

  // Pattern 2: "M01" ... "M14"
  const mPattern = headers.filter(h => /^M\d{2}$/i.test(h));
  if (mPattern.length > 0) {
    return mPattern.sort();
  }

  // Pattern 3: German month names
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const monthCols = headers.filter(h => monthNames.some(m => h.startsWith(m)));
  if (monthCols.length > 0) {
    return monthCols;
  }

  // No month columns found — fallback
  return [];
}

// ============================================================
// Generic mapping helper
// ============================================================

/**
 * Mappt eine Excel-Zeile (Record mit Spaltennamen als Keys) auf ein Objekt
 * mit den internen Feldnamen aus dem Mapping.
 */
export function applyMapping(
  row: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [excelCol, field] of Object.entries(mapping)) {
    const raw = row[excelCol];
    if (raw !== undefined && raw !== null) {
      result[field] = typeof raw === 'string' ? raw.trim() : raw;
    }
  }
  return result;
}

/**
 * Mappt ein Array von Excel-Zeilen und konvertiert Nummernfelder.
 */
export function mapAndParseRows<T>(
  rows: Record<string, unknown>[],
  mapping: Record<string, string>,
  numberFields: string[] = [],
): T[] {
  return rows
    .map(row => {
      const mapped = applyMapping(row, mapping);
      for (const field of numberFields) {
        if (mapped[field] !== undefined) {
          const parsed = parseFloat(String(mapped[field]).trim());
          mapped[field] = isNaN(parsed) ? 0 : parsed;
        }
      }
      return mapped as T;
    })
    .filter(row => {
      // Filtere Zeilen ohne Artikelnummer
      const nr = (row as Record<string, unknown>)['artikelnummer'];
      return nr !== undefined && nr !== null && nr !== '' && nr !== 0;
    });
}
