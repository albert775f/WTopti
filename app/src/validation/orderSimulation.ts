import type { BestellungData, WT, OrderSimulationResult } from '../types';
import { buildArtToWTList } from '../utils/wtMaps';

function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 | 0;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Greedy Set Cover: find the minimum set of WTs that covers all needed articles.
 * For each step, pick the WT that covers the most still-needed articles.
 * This is a heuristic (Set Cover is NP-hard) but quasi-optimal for small order sizes.
 */
function greedySetCover(
  neededArticles: Set<string>,
  artToWTIds: Map<string, Set<string>>,
  wtIdToArticles: Map<string, Set<string>>,
): number {
  const needed = new Set(neededArticles);
  let pickCount = 0;

  while (needed.size > 0) {
    let bestWTId: string | null = null;
    let bestCoverage = 0;

    for (const artNr of needed) {
      const wtIds = artToWTIds.get(artNr);
      if (!wtIds) continue;
      for (const wtId of wtIds) {
        const articles = wtIdToArticles.get(wtId);
        if (!articles) continue;
        let coverage = 0;
        for (const a of needed) {
          if (articles.has(a)) coverage++;
        }
        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestWTId = wtId;
        }
      }
    }

    if (!bestWTId) break; // remaining articles not found in any WT

    pickCount++;
    const covered = wtIdToArticles.get(bestWTId)!;
    for (const a of [...needed]) {
      if (covered.has(a)) needed.delete(a);
    }
  }

  return pickCount;
}

export function runOrderSimulation(
  bestellungen: BestellungData[],
  wts: WT[],
  baselineWTs: WT[],
  seed = 42,
  sampleSize = 500,
): OrderSimulationResult {
  // Build indexes for optimized WTs (Greedy Set Cover)
  const artToWTIdsRaw = new Map<string, Set<string>>();
  const wtIdToArticles = new Map<string, Set<string>>();
  for (const wt of wts) {
    wtIdToArticles.set(wt.id, new Set(wt.positionen.map(p => p.artikelnummer)));
    for (const pos of wt.positionen) {
      if (!artToWTIdsRaw.has(pos.artikelnummer)) artToWTIdsRaw.set(pos.artikelnummer, new Set());
      artToWTIdsRaw.get(pos.artikelnummer)!.add(wt.id);
    }
  }

  // Build indexes for baseline WTs (first-WT heuristic, same as before)
  const artikelToBaselineWTsRaw = buildArtToWTList(baselineWTs);
  const artikelToBaselineWTs = new Map<string, string[]>(
    Array.from(artikelToBaselineWTsRaw.entries()).map(([k, v]) => [k, v.map(e => e.id)])
  );

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

    // Optimized: Greedy Set Cover
    const needed = new Set([...artikel].filter(a => artToWTIdsRaw.has(a)));
    pickCounts.push(greedySetCover(needed, artToWTIdsRaw, wtIdToArticles));

    // Baseline: first-WT heuristic
    const baselineSet = new Set<string>();
    for (const artNr of artikel) {
      const bIds = artikelToBaselineWTs.get(artNr);
      if (bIds?.[0]) baselineSet.add(bIds[0]);
    }
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
