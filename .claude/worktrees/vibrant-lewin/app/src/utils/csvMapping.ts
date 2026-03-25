/**
 * Excel-Spalten-Mapping: Mappt tatsächliche Excel-Spaltennamen auf TypeScript-Feldnamen.
 *
 * Only Bestandsliste is still parsed client-side.
 * Artikelliste + Bestellungen are parsed server-side and served via API.
 *
 * Bestandsliste 13.03.2026.xls (Sheet "2026-03-13"):
 *   nummer, gesamt_x
 */

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
  bestandsliste: /^\d{4}-\d{2}-\d{2}$/,  // dynamischer Datumsname
} as const;

// ============================================================
// Generic mapping helpers
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
