import type { WT, ArtikelProcessed, BestellungData, MetricResult, ThresholdConfig } from '../types';
import type { CoOccurrenceMatrix } from '../algorithm/phase2';
import { DEFAULT_THRESHOLDS, getAmpel } from './thresholds';

function makeMetric(
  id: string, name: string, value: number, baseline: number,
  unit: string, thresholds: ThresholdConfig,
): MetricResult {
  const delta = value - baseline;
  const deltaPercent = baseline !== 0 ? (delta / Math.abs(baseline)) * 100 : 0;
  const ampel = getAmpel(id, value, thresholds);
  return { id, name, value, baseline, delta, deltaPercent, ampel, unit };
}

export function calculateMetrics(
  wts: WT[],
  baselineWTs: WT[],
  _processed: ArtikelProcessed[],
  _bestellungen: BestellungData[],
  coMatrix: CoOccurrenceMatrix,
  thresholds: ThresholdConfig = DEFAULT_THRESHOLDS,
  m9MeanPicks = 0,
  m9BaselineMeanPicks = 0,
): MetricResult[] {
  // M1: WT count
  const m1 = makeMetric('M1', 'Anzahl WTs', wts.length, baselineWTs.length, '', thresholds);

  // M2: Avg area utilization
  const avgArea = wts.length > 0 ? wts.reduce((s, w) => s + w.flaeche_netto_pct / 100, 0) / wts.length : 0;
  const baselineAvgArea = baselineWTs.length > 0 ? baselineWTs.reduce((s, w) => s + w.flaeche_netto_pct / 100, 0) / baselineWTs.length : 0;
  const m2 = makeMetric('M2', 'Ø Flächenauslastung', avgArea, baselineAvgArea, '%', thresholds);

  // M3: Avg weight utilization (capped at 1)
  const avgWeight = wts.length > 0 ? wts.reduce((s, w) => s + Math.min(1, w.gesamtgewicht_kg / 20), 0) / wts.length : 0;
  const baselineAvgWeight = baselineWTs.length > 0 ? baselineWTs.reduce((s, w) => s + Math.min(1, w.gesamtgewicht_kg / 20), 0) / baselineWTs.length : 0;
  const m3 = makeMetric('M3', 'Ø Gewichtsauslastung', avgWeight, baselineAvgWeight, '%', thresholds);

  // M4: Fraction in soft-warn zone (20-24 kg)
  const softWarn = wts.filter(w => w.gesamtgewicht_kg > 20 && w.gesamtgewicht_kg <= 24).length;
  const m4Val = wts.length > 0 ? softWarn / wts.length : 0;
  const baselineSoftWarn = baselineWTs.filter(w => w.gesamtgewicht_kg > 20 && w.gesamtgewicht_kg <= 24).length;
  const m4BaseVal = baselineWTs.length > 0 ? baselineSoftWarn / baselineWTs.length : 0;
  const m4 = makeMetric('M4', 'WTs Gewicht 20-24 kg', m4Val, m4BaseVal, '%', thresholds);

  // M5: Fraction of unused WTs
  const unusedWTs = wts.filter(w => w.positionen.length === 0 || w.positionen.every(p => p.stueckzahl === 0)).length;
  const m5Val = wts.length > 0 ? unusedWTs / wts.length : 0;
  const unusedBaseline = baselineWTs.filter(w => w.positionen.length === 0).length;
  const m5BaseVal = baselineWTs.length > 0 ? unusedBaseline / baselineWTs.length : 0;
  const m5 = makeMetric('M5', 'Anteil ungenutzte WTs', m5Val, m5BaseVal, '%', thresholds);

  // M6: Fraction of WTs with area < 30%
  const lowArea = wts.filter(w => w.positionen.length > 0 && w.flaeche_netto_pct < 30).length;
  const m6Val = wts.length > 0 ? lowArea / wts.length : 0;
  const lowAreaBaseline = baselineWTs.filter(w => w.positionen.length > 0 && w.flaeche_netto_pct < 30).length;
  const m6BaseVal = baselineWTs.length > 0 ? lowAreaBaseline / baselineWTs.length : 0;
  const m6 = makeMetric('M6', 'WTs Fläche < 30%', m6Val, m6BaseVal, '%', thresholds);

  // M7: Co-occurrence score (fraction of top-100 pairs sharing at least one WT)
  const artToWTs = new Map<string, Set<string>>();
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      if (!artToWTs.has(pos.artikelnummer)) artToWTs.set(pos.artikelnummer, new Set());
      artToWTs.get(pos.artikelnummer)!.add(wt.id);
    }
  }
  const artToBaseWTs = new Map<string, Set<string>>();
  for (const wt of baselineWTs) {
    for (const pos of wt.positionen) {
      if (!artToBaseWTs.has(pos.artikelnummer)) artToBaseWTs.set(pos.artikelnummer, new Set());
      artToBaseWTs.get(pos.artikelnummer)!.add(wt.id);
    }
  }

  const pairs: Array<{a: string; b: string; score: number}> = [];
  for (const [artA, row] of Object.entries(coMatrix)) {
    for (const [artB, score] of Object.entries(row)) {
      if (artA < artB) pairs.push({ a: artA, b: artB, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const top100 = pairs.slice(0, 100);

  const sharesWT = (map: Map<string, Set<string>>, a: string, b: string): boolean => {
    const wa = map.get(a);
    const wb = map.get(b);
    if (!wa || !wb) return false;
    for (const id of wa) if (wb.has(id)) return true;
    return false;
  };
  const sameWT = top100.filter(p => sharesWT(artToWTs, p.a, p.b)).length;
  const m7Val = top100.length > 0 ? sameWT / top100.length : 0;
  const sameBaseWT = top100.filter(p => sharesWT(artToBaseWTs, p.a, p.b)).length;
  const m7BaseVal = top100.length > 0 ? sameBaseWT / top100.length : 0;
  const m7 = makeMetric('M7', 'Co-Occ Top-100 auf gleichem WT', m7Val, m7BaseVal, '%', thresholds);

  // M8: Gini coefficient of A-articles per WT
  const aPerWT = wts.map(wt => wt.positionen.filter(p => p.abc_klasse === 'A').length);
  const totalA = aPerWT.reduce((s, c) => s + c, 0);
  let m8Val = 0;
  if (totalA > 0 && aPerWT.length > 1) {
    const n = aPerWT.length;
    let giniSum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        giniSum += Math.abs(aPerWT[i] - aPerWT[j]);
      }
    }
    const mean = totalA / n;
    m8Val = mean > 0 ? giniSum / (2 * n * n * mean) : 0;
  }
  const aBasePerWT = baselineWTs.map(wt => wt.positionen.filter(p => p.abc_klasse === 'A').length);
  const totalABase = aBasePerWT.reduce((s, c) => s + c, 0);
  let m8BaseVal = 0;
  if (totalABase > 0 && aBasePerWT.length > 1) {
    const n = aBasePerWT.length;
    let giniSum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        giniSum += Math.abs(aBasePerWT[i] - aBasePerWT[j]);
      }
    }
    const mean = totalABase / n;
    m8BaseVal = mean > 0 ? giniSum / (2 * n * n * mean) : 0;
  }
  const m8 = makeMetric('M8', 'A-Artikel Gini-Koeffizient', m8Val, m8BaseVal, '', thresholds);

  // M9: Mean picks per order (from simulation)
  const m9 = makeMetric('M9', 'Ø Picks/Bestellung', m9MeanPicks, m9BaselineMeanPicks, '', thresholds);

  // M10: Max article types per WT
  const maxTypes = wts.length > 0 ? Math.max(...wts.map(w => w.positionen.length)) : 0;
  const maxTypesBaseline = baselineWTs.length > 0 ? Math.max(...baselineWTs.map(w => w.positionen.length)) : 0;
  const m10 = makeMetric('M10', 'Max Artikel-Typen/WT', maxTypes, maxTypesBaseline, 'Typen', thresholds);

  return [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10];
}
