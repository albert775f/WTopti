import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { ArtikelProcessed, BestellungData, WTConfig } from '../types';

export interface CoOccurrenceMatrix {
  [art1: string]: { [art2: string]: number };
}

export interface ClusterResult {
  clusters: Map<string, number>; // artikelnummer → cluster_id
  coMatrix: CoOccurrenceMatrix;
  clusterSizes: Map<number, number>;
}

export function processPhase2(
  processed: ArtikelProcessed[],
  bestellungen: BestellungData[],
  config: WTConfig,
): ClusterResult {
  const activeArticles = new Set(processed.map(p => String(p.artikelnummer)));

  // Group orders by belegnummer
  const belegMap = new Map<string, string[]>();
  for (const b of bestellungen) {
    const artNr = String(b.artikelnummer);
    if (!activeArticles.has(artNr)) continue;
    const beleg = String(b.belegnummer);
    if (!belegMap.has(beleg)) belegMap.set(beleg, []);
    belegMap.get(beleg)!.push(artNr);
  }

  // Build co-occurrence matrix
  const coMatrix: CoOccurrenceMatrix = {};
  for (const [, artikelList] of belegMap) {
    const unique = [...new Set(artikelList)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i];
        const b = unique[j];
        if (!coMatrix[a]) coMatrix[a] = {};
        if (!coMatrix[b]) coMatrix[b] = {};
        coMatrix[a][b] = (coMatrix[a][b] || 0) + 1;
        coMatrix[b][a] = (coMatrix[b][a] || 0) + 1;
      }
    }
  }

  // Build graph with edges above threshold
  const graph = new Graph({ type: 'undirected' });
  for (const artNr of activeArticles) {
    graph.addNode(artNr);
  }

  const schwellwert = config.co_occurrence_schwellwert;
  const addedEdges = new Set<string>();
  for (const [artA, neighbors] of Object.entries(coMatrix)) {
    for (const [artB, weight] of Object.entries(neighbors)) {
      if (weight < schwellwert) continue;
      const edgeKey = artA < artB ? `${artA}|${artB}` : `${artB}|${artA}`;
      if (addedEdges.has(edgeKey)) continue;
      if (!graph.hasNode(artA) || !graph.hasNode(artB)) continue;
      addedEdges.add(edgeKey);
      graph.addEdge(artA, artB, { weight });
    }
  }

  // Louvain community detection
  const communities = louvain(graph, {
    getEdgeWeight: 'weight',
    resolution: 1,
  });

  // Assign cluster IDs: connected nodes get Louvain community, isolates get unique IDs
  const clusters = new Map<string, number>();
  for (const artNr of activeArticles) {
    const degree = graph.degree(artNr);
    if (degree === 0) {
      // Skip isolates for now — assigned unique IDs below
      continue;
    } else {
      clusters.set(artNr, communities[artNr] ?? 0);
    }
  }

  // Find max cluster ID from Louvain assignments
  let maxClusterId = 0;
  for (const cid of clusters.values()) {
    if (cid > maxClusterId) maxClusterId = cid;
  }

  // Each isolated node gets its own unique cluster (prevents mega-cluster)
  for (const artNr of activeArticles) {
    if (!clusters.has(artNr)) {
      maxClusterId++;
      clusters.set(artNr, maxClusterId);
    }
  }

  // Post-processing: max 2 A-articles per cluster
  const abcMap = new Map<string, 'A' | 'B' | 'C'>();
  for (const p of processed) {
    abcMap.set(String(p.artikelnummer), p.abc_klasse);
  }

  // Group A-articles by cluster (check all clusters, including Louvain community 0)
  const clusterAArticles = new Map<number, string[]>();
  for (const [artNr, cid] of clusters) {
    if (abcMap.get(artNr) === 'A') {
      if (!clusterAArticles.has(cid)) clusterAArticles.set(cid, []);
      clusterAArticles.get(cid)!.push(artNr);
    }
  }

  // Split clusters with > 2 A-articles
  for (const [, aArticles] of clusterAArticles) {
    if (aArticles.length <= 2) continue;
    // Keep first 2, move excess to new sub-clusters
    const excess = aArticles.slice(2);
    for (const artNr of excess) {
      maxClusterId++;
      clusters.set(artNr, maxClusterId);
    }
  }

  // F10: Break up mega-clusters (> MAX_CLUSTER_ARTICLES articles) via greedy co-occurrence BFS
  const MAX_CLUSTER_ARTICLES = 50;
  const clusterArticlesMap = new Map<number, string[]>();
  for (const [artNr, cid] of clusters) {
    if (!clusterArticlesMap.has(cid)) clusterArticlesMap.set(cid, []);
    clusterArticlesMap.get(cid)!.push(artNr);
  }

  for (const [origCid, articles] of clusterArticlesMap) {
    if (articles.length <= MAX_CLUSTER_ARTICLES) continue;

    // Sort by degree within cluster descending (most connected first)
    const degreeIn = (artNr: string): number => {
      const nb = coMatrix[artNr];
      if (!nb) return 0;
      let d = 0;
      for (const other of articles) {
        if ((nb[other] ?? 0) >= schwellwert) d++;
      }
      return d;
    };
    const sorted = [...articles].sort((a, b) => degreeIn(b) - degreeIn(a));

    const remaining = new Set(sorted);
    const groups: string[][] = [];

    while (remaining.size > 0) {
      const seed = sorted.find(a => remaining.has(a))!;
      const group: string[] = [seed];
      remaining.delete(seed);

      // BFS: expand via highest-weight edges, up to MAX_CLUSTER_ARTICLES
      const queue = [seed];
      while (queue.length > 0 && group.length < MAX_CLUSTER_ARTICLES) {
        const curr = queue.shift()!;
        const nb = coMatrix[curr];
        if (!nb) continue;
        const candidates = Object.entries(nb)
          .filter(([nbr, w]) => remaining.has(nbr) && w >= schwellwert)
          .sort(([, a], [, b]) => b - a);
        for (const [nbr] of candidates) {
          if (group.length >= MAX_CLUSTER_ARTICLES) break;
          if (!remaining.has(nbr)) continue;
          group.push(nbr);
          remaining.delete(nbr);
          queue.push(nbr);
        }
      }
      groups.push(group);
    }

    // Assign new cluster IDs (first group keeps origCid to minimise churn)
    for (let gi = 0; gi < groups.length; gi++) {
      const globalCid = gi === 0 ? origCid : ++maxClusterId;
      for (const artNr of groups[gi]) {
        clusters.set(artNr, globalCid);
      }
    }
  }

  // Assign cluster_id back to processed articles
  for (const p of processed) {
    p.cluster_id = clusters.get(String(p.artikelnummer)) ?? 0;
  }

  // Compute cluster sizes
  const clusterSizes = new Map<number, number>();
  for (const cid of clusters.values()) {
    clusterSizes.set(cid, (clusterSizes.get(cid) || 0) + 1);
  }

  return { clusters, coMatrix, clusterSizes };
}
