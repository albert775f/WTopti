import type { BestellungData, WT, OrderSimulationResult } from '../types';

function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 | 0;
    return (s >>> 0) / 4294967296;
  };
}

export function runOrderSimulation(
  bestellungen: BestellungData[],
  wts: WT[],
  baselineWTs: WT[],
  seed = 42,
  sampleSize = 500,
): OrderSimulationResult {
  const artikelToWTs = new Map<string, string[]>();
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      if (!artikelToWTs.has(pos.artikelnummer)) artikelToWTs.set(pos.artikelnummer, []);
      artikelToWTs.get(pos.artikelnummer)!.push(wt.id);
    }
  }

  const artikelToBaselineWTs = new Map<string, string[]>();
  for (const wt of baselineWTs) {
    for (const pos of wt.positionen) {
      if (!artikelToBaselineWTs.has(pos.artikelnummer)) artikelToBaselineWTs.set(pos.artikelnummer, []);
      artikelToBaselineWTs.get(pos.artikelnummer)!.push(wt.id);
    }
  }

  const bestellungMap = new Map<string, Set<string>>();
  for (const b of bestellungen) {
    if (!bestellungMap.has(b.belegnummer)) bestellungMap.set(b.belegnummer, new Set());
    bestellungMap.get(b.belegnummer)!.add(b.artikelnummer);
  }

  const belegnummern = Array.from(bestellungMap.keys());
  const rng = seededRandom(seed);
  const shuffled = [...belegnummern].sort(() => rng() - 0.5);
  const sample = shuffled.slice(0, Math.min(sampleSize, shuffled.length));

  const pickCounts: number[] = [];
  const baselinePickCounts: number[] = [];

  for (const belegnr of sample) {
    const artikel = bestellungMap.get(belegnr) ?? new Set();
    const wtSet = new Set<string>();
    const baselineSet = new Set<string>();
    for (const artNr of artikel) {
      const ids = artikelToWTs.get(artNr);
      if (ids?.[0]) wtSet.add(ids[0]);
      const bIds = artikelToBaselineWTs.get(artNr);
      if (bIds?.[0]) baselineSet.add(bIds[0]);
    }
    pickCounts.push(wtSet.size);
    baselinePickCounts.push(baselineSet.size);
  }

  function buildHistogram(counts: number[]): Array<{bin: number; count: number}> {
    const hist = [1,2,3,4,5,6].map(bin => ({ bin, count: 0 }));
    for (const c of counts) {
      const idx = Math.min(c, 6) - 1;
      if (idx >= 0) hist[idx].count++;
    }
    return hist;
  }

  const mean = (arr: number[]) => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;
  const median = (arr: number[]) => {
    const s = [...arr].sort((a,b) => a-b);
    return s.length ? s[Math.floor(s.length/2)] : 0;
  };

  return {
    seed, sampleSize: sample.length,
    pickCounts,
    histogram: buildHistogram(pickCounts),
    meanPicks: Math.round(mean(pickCounts) * 100) / 100,
    medianPicks: median(pickCounts),
    baselineHistogram: buildHistogram(baselinePickCounts),
    baselineMeanPicks: Math.round(mean(baselinePickCounts) * 100) / 100,
  };
}
