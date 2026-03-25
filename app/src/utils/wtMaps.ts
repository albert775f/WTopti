import type { WT } from '../types';

/** Build a Map<artikelnummer, Set<WT-ID>> from a WT array. */
export function buildArtToWTMap(wts: WT[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      if (!map.has(pos.artikelnummer)) map.set(pos.artikelnummer, new Set());
      map.get(pos.artikelnummer)!.add(wt.id);
    }
  }
  return map;
}

/** Build a Map<artikelnummer, WT-ID> (first occurrence only). */
export function buildArtToFirstWT(wts: WT[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      if (!map.has(pos.artikelnummer)) map.set(pos.artikelnummer, wt.id);
    }
  }
  return map;
}

/** Build a Map<artikelnummer, { id, typ }[]> for simulation. */
export function buildArtToWTList(wts: WT[]): Map<string, { id: string; typ: string }[]> {
  const map = new Map<string, { id: string; typ: string }[]>();
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      if (!map.has(pos.artikelnummer)) map.set(pos.artikelnummer, []);
      map.get(pos.artikelnummer)!.push({ id: wt.id, typ: wt.typ });
    }
  }
  return map;
}

/**
 * Extract and sort co-occurrence pairs from a coMatrix.
 * Returns deduplicated pairs (artA < artB) sorted by score descending.
 */
export function getSortedPairs(
  coMatrix: Record<string, Record<string, number>>,
  limit?: number,
): Array<{ a: string; b: string; score: number }> {
  const pairs: Array<{ a: string; b: string; score: number }> = [];
  for (const [artA, row] of Object.entries(coMatrix)) {
    for (const [artB, score] of Object.entries(row)) {
      if (artA < artB) pairs.push({ a: artA, b: artB, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return limit !== undefined ? pairs.slice(0, limit) : pairs;
}

/** Canonical red-flag definition. Used by WTInspector and worker warnings. */
export function isRedFlagWT(wt: WT, softLimitKg: number): boolean {
  return (
    wt.gesamtgewicht_kg > softLimitKg ||
    (wt.positionen.length > 0 && wt.flaeche_netto_pct < 30)
  );
}
