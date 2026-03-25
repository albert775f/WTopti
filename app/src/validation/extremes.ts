import type { WT, ArtikelProcessed, ExtremesResult, ExtremeEntry } from '../types';
import type { CoOccurrenceMatrix } from '../algorithm/phase2';
import { buildArtToFirstWT, getSortedPairs } from '../utils/wtMaps';

function top5<T>(arr: T[], keyFn: (item: T) => number, mapFn: (item: T, rank: number) => ExtremeEntry, descending = true): ExtremeEntry[] {
  const sorted = [...arr].sort((a, b) => descending ? keyFn(b) - keyFn(a) : keyFn(a) - keyFn(b));
  return sorted.slice(0, 5).map((item, i) => mapFn(item, i + 1));
}

export function calculateExtremes(
  wts: WT[],
  processed: ArtikelProcessed[],
  coMatrix: CoOccurrenceMatrix,
): ExtremesResult {
  const artMap = new Map(processed.map(a => [String(a.artikelnummer), a]));
  const artToWT = buildArtToFirstWT(wts);

  const largestArticle = top5(processed, a => a.grundflaeche_mm2, (a, rank) => ({
    rank, key: String(a.artikelnummer), label: a.bezeichnung,
    value: a.grundflaeche_mm2, unit: 'mm²',
    targetWTId: artToWT.get(String(a.artikelnummer)),
  }));

  const heaviestArticle = top5(processed, a => a.gewicht_kg, (a, rank) => ({
    rank, key: String(a.artikelnummer), label: a.bezeichnung,
    value: a.gewicht_kg, unit: 'kg',
    targetWTId: artToWT.get(String(a.artikelnummer)),
  }));

  const highestStock = top5(processed, a => a.bestand, (a, rank) => ({
    rank, key: String(a.artikelnummer), label: a.bezeichnung,
    value: a.bestand, unit: 'Stk',
    targetWTId: artToWT.get(String(a.artikelnummer)),
  }));

  const mostOrdered = top5(processed, a => a.umsatz_gesamt, (a, rank) => ({
    rank, key: String(a.artikelnummer), label: a.bezeichnung,
    value: a.umsatz_gesamt, unit: 'Stk',
    targetWTId: artToWT.get(String(a.artikelnummer)),
  }));

  const topCoOccPair = getSortedPairs(coMatrix, 5).map((p, i) => {
    const labelA = artMap.get(p.a)?.bezeichnung ?? p.a;
    const labelB = artMap.get(p.b)?.bezeichnung ?? p.b;
    return {
      rank: i + 1, key: `${p.a} / ${p.b}`,
      label: `${labelA.slice(0,25)} / ${labelB.slice(0,25)}`,
      value: p.score, unit: 'Co-Occ',
      targetWTId: artToWT.get(p.a),
    };
  });

  const fullestWTs = top5(wts, wt => wt.gesamtgewicht_kg, (wt, rank) => ({
    rank, key: wt.id, label: `${wt.typ} Cluster ${wt.cluster_id}`,
    value: Math.round(wt.gesamtgewicht_kg * 100) / 100, unit: 'kg',
    targetWTId: wt.id,
  }));

  const nonEmpty = wts.filter(wt => wt.positionen.length > 0);
  const emptiestWTs = top5(nonEmpty, wt => wt.flaeche_netto_pct, (wt, rank) => ({
    rank, key: wt.id, label: `${wt.typ} ${Math.round(wt.flaeche_netto_pct)}%`,
    value: Math.round(wt.flaeche_netto_pct * 10) / 10, unit: '%',
    targetWTId: wt.id,
  }), false);

  const mostArticleTypes = top5(wts, wt => wt.positionen.length, (wt, rank) => ({
    rank, key: wt.id, label: `${wt.typ} ${wt.positionen.length} Typen`,
    value: wt.positionen.length, unit: 'Typen',
    targetWTId: wt.id,
  }));

  return { largestArticle, heaviestArticle, highestStock, mostOrdered, topCoOccPair, fullestWTs, emptiestWTs, mostArticleTypes };
}
