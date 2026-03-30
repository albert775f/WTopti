import type { ArtikelProcessed, BestellungData, WTConfig, AffinityPair, AffinityGroup, AffinityResult } from '../types';

// Backward-compat alias for downstream consumers that import CoOccurrenceMatrix from here
export type CoOccurrenceMatrix = Record<string, Record<string, number>>;

// Backward-compat stub — phase3 imports this type but no longer uses it at runtime
export interface ClusterResult {
  clusters: Map<string, number>;
  coMatrix: CoOccurrenceMatrix;
  clusterSizes: Map<number, number>;
}

export function processPhase2(
  processed: ArtikelProcessed[],
  bestellungen: BestellungData[],
  config: WTConfig,
): AffinityResult {
  const activeArticles = new Set(processed.map(p => String(p.artikelnummer)));

  // --- Step 1: Co-occurrence matrix ---

  // Group orders by belegnummer, keeping only active articles
  const belegMap = new Map<string, string[]>();
  for (const b of bestellungen) {
    const artNr = String(b.artikelnummer);
    if (!activeArticles.has(artNr)) continue;
    const beleg = String(b.belegnummer);
    if (!belegMap.has(beleg)) belegMap.set(beleg, []);
    belegMap.get(beleg)!.push(artNr);
  }

  const coMatrix: CoOccurrenceMatrix = {};
  const orderCount: Record<string, number> = {};

  for (const [, artikelList] of belegMap) {
    const unique = [...new Set(artikelList)];
    for (const artNr of unique) {
      orderCount[artNr] = (orderCount[artNr] ?? 0) + 1;
    }
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i];
        const b = unique[j];
        if (!coMatrix[a]) coMatrix[a] = {};
        if (!coMatrix[b]) coMatrix[b] = {};
        coMatrix[a][b] = (coMatrix[a][b] ?? 0) + 1;
        coMatrix[b][a] = (coMatrix[b][a] ?? 0) + 1;
      }
    }
  }

  // --- Step 2: Significant pairs ---

  const threshold = config.affinity_threshold;
  const minCount = config.affinity_min_count;
  const minOrdersA = config.affinity_min_orders_a;

  // Lookup for bestand (needed for tie-breaking)
  const bestandMap = new Map<string, number>();
  for (const p of processed) {
    bestandMap.set(String(p.artikelnummer), p.bestand);
  }

  // Map from article -> list of significant AffinityPair where that article is the seed
  const pairsBySeed = new Map<string, AffinityPair[]>();
  // Also store a deduplicated list of all significant pairs
  const allPairs: AffinityPair[] = [];
  const seenPairKeys = new Set<string>();

  for (const artA of activeArticles) {
    const neighborsA = coMatrix[artA];
    if (!neighborsA) continue;
    const ocA = orderCount[artA] ?? 0;
    if (ocA < minOrdersA) continue;

    for (const [artB, count] of Object.entries(neighborsA)) {
      if (!activeArticles.has(artB)) continue;
      if (count < minCount) continue;

      const pBA = count / ocA; // P(B|A)
      if (pBA < threshold) continue;

      const ocB = orderCount[artB] ?? 0;
      const pAB = ocB > 0 ? count / ocB : 0; // P(A|B)

      // Determine seed: higher orderCount wins; tie -> higher bestand
      let seed: string;
      let partner: string;
      let pGivenSeed: number;
      let pGivenPartner: number;

      if (ocA > ocB) {
        seed = artA; partner = artB;
        pGivenSeed = pBA; pGivenPartner = pAB;
      } else if (ocB > ocA) {
        seed = artB; partner = artA;
        pGivenSeed = pAB; pGivenPartner = pBA;
      } else {
        // tie on orderCount — use bestand
        const bA = bestandMap.get(artA) ?? 0;
        const bB = bestandMap.get(artB) ?? 0;
        if (bA >= bB) {
          seed = artA; partner = artB;
          pGivenSeed = pBA; pGivenPartner = pAB;
        } else {
          seed = artB; partner = artA;
          pGivenSeed = pAB; pGivenPartner = pBA;
        }
      }

      const pairKey = seed < partner ? `${seed}|${partner}` : `${partner}|${seed}`;
      if (!seenPairKeys.has(pairKey)) {
        seenPairKeys.add(pairKey);
        const pair: AffinityPair = { seed, partner, pGivenSeed, pGivenPartner, coOccCount: count };
        allPairs.push(pair);
        if (!pairsBySeed.has(seed)) pairsBySeed.set(seed, []);
        pairsBySeed.get(seed)!.push(pair);
      }
    }
  }

  // --- Step 3: Greedy group formation ---

  const remaining = new Set<string>(activeArticles);
  const groups: AffinityGroup[] = [];
  let groupIdCounter = 0;
  const maxGroupSize = 6; // physical maximum — not configurable

  while (remaining.size > 0) {
    // Count significant pairs pointing to other remaining articles for each remaining article
    let bestSeed: string | null = null;
    let bestPairCount = 0;

    for (const artNr of remaining) {
      const pairs = pairsBySeed.get(artNr) ?? [];
      const count = pairs.filter(p => remaining.has(p.partner)).length;
      if (count > bestPairCount) {
        bestPairCount = count;
        bestSeed = artNr;
      } else if (count === bestPairCount && count > 0 && bestSeed !== null) {
        // Tie-break: orderCount desc, then bestand desc
        const ocBest = orderCount[bestSeed] ?? 0;
        const ocCurr = orderCount[artNr] ?? 0;
        if (ocCurr > ocBest) {
          bestSeed = artNr;
        } else if (ocCurr === ocBest) {
          const bBest = bestandMap.get(bestSeed) ?? 0;
          const bCurr = bestandMap.get(artNr) ?? 0;
          if (bCurr > bBest) bestSeed = artNr;
        }
      }
    }

    if (bestPairCount === 0 || bestSeed === null) {
      // No more significant pairs — all remaining become singletons
      for (const artNr of remaining) {
        groups.push({ id: groupIdCounter++, members: [artNr], pairs: [], isSingleton: true });
      }
      break;
    }

    const seed = bestSeed;
    remaining.delete(seed);

    const group: string[] = [seed];

    // Candidates: partners of seed with P(partner|seed) >= threshold, still in remaining
    const seedPairs = pairsBySeed.get(seed) ?? [];
    const candidates = seedPairs
      .filter(p => remaining.has(p.partner))
      .sort((a, b) => b.pGivenSeed - a.pGivenSeed);

    for (const candidatePair of candidates) {
      if (group.length >= maxGroupSize) break;
      if (!remaining.has(candidatePair.partner)) continue;
      group.push(candidatePair.partner);
      remaining.delete(candidatePair.partner);
    }

    // Collect all significant pairs where both articles are in this group
    const groupSet = new Set(group);
    const groupPairs = allPairs.filter(p => groupSet.has(p.seed) && groupSet.has(p.partner));

    groups.push({ id: groupIdCounter++, members: group, pairs: groupPairs, isSingleton: false });
  }

  // --- Step 4: Build partnerIndex ---
  // For each article: all partners sorted by max(P(B|A), P(A|B)) descending.

  const partnerIndex = new Map<string, Array<{ partner: string; affinity: number }>>();

  for (const pair of allPairs) {
    const affinity = Math.max(pair.pGivenSeed, pair.pGivenPartner);

    if (!partnerIndex.has(pair.seed)) partnerIndex.set(pair.seed, []);
    partnerIndex.get(pair.seed)!.push({ partner: pair.partner, affinity });

    if (!partnerIndex.has(pair.partner)) partnerIndex.set(pair.partner, []);
    partnerIndex.get(pair.partner)!.push({ partner: pair.seed, affinity });
  }

  for (const list of partnerIndex.values()) {
    list.sort((a, b) => b.affinity - a.affinity);
  }

  // --- Step 5: Assign cluster_id to processed articles ---

  const articleToGroup = new Map<string, number>();
  for (const group of groups) {
    for (const artNr of group.members) {
      articleToGroup.set(artNr, group.id);
    }
  }

  for (const p of processed) {
    const artNr = String(p.artikelnummer);
    p.cluster_id = articleToGroup.get(artNr) ?? 0;
  }

  return {
    groups,
    pairs: allPairs,
    partnerIndex,
    coMatrix,
    singletonCount: groups.filter(g => g.isSingleton).length,
    groupCount: groups.filter(g => !g.isSingleton).length,
  };
}
