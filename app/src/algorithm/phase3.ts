import type { ArtikelProcessed, WTConfig, WT, WTTyp } from '../types';
import type { ClusterResult } from './phase2';

// WT dimensions in mm
const WT_WIDTH = 500;  // both KLEIN and GROSS are 500mm wide
const WT_DEPTH_KLEIN = 500;
const WT_DEPTH_GROSS = 800;

function getWTDepth(typ: WTTyp): number {
  return typ === 'KLEIN' ? WT_DEPTH_KLEIN : WT_DEPTH_GROSS;
}

function chooseWTTypForArticle(artikel: ArtikelProcessed): WTTyp {
  // Article must fit within WT dimensions (try both orientations)
  const fitsKlein =
    (artikel.breite_mm <= WT_DEPTH_KLEIN && artikel.laenge_mm <= WT_WIDTH) ||
    (artikel.laenge_mm <= WT_DEPTH_KLEIN && artikel.breite_mm <= WT_WIDTH);
  return fitsKlein ? 'KLEIN' : 'GROSS';
}

function createWT(id: string, typ: WTTyp, clusterId: number): WT {
  const brutto = typ === 'KLEIN' ? 250_000 : 400_000;
  return {
    id,
    typ,
    positionen: [],
    cluster_id: clusterId,
    gesamtgewicht_kg: 0,
    flaeche_brutto_mm2: brutto,
    flaeche_netto_mm2: brutto,
    flaeche_netto_pct: 0,
    anzahl_teiler: 0,
    gewicht_status: 'ok',
  };
}

/** Track strip-based depth usage per WT */
interface WTState {
  wt: WT;
  usedDepth: number;  // mm of depth consumed by strips
  stripCount: number; // number of strips placed (for teiler counting)
}

function updateWTMetrics(wtState: WTState, config: WTConfig): void {
  const wt = wtState.wt;
  const wtDepth = getWTDepth(wt.typ);
  const teilerCount = Math.max(0, wtState.stripCount - 1);
  const teilerLoss = teilerCount * config.teiler_breite_mm;
  const usableDepth = Math.max(0, wtDepth - teilerLoss);

  wt.anzahl_teiler = teilerCount;
  wt.flaeche_brutto_mm2 = WT_WIDTH * wtDepth;
  wt.flaeche_netto_mm2 = WT_WIDTH * usableDepth;
  // usedDepth includes teiler mm; subtract them so numerator and denominator
  // are both in "pure strip" space — prevents >100% on physically fitting WTs
  const pureStripDepth = wtState.usedDepth - teilerLoss;
  wt.flaeche_netto_pct = usableDepth > 0
    ? Math.round((pureStripDepth / usableDepth) * 10000) / 100
    : 0;

  wt.gesamtgewicht_kg = Math.round(
    wt.positionen.reduce((s, p) => s + p.gewicht_kg * p.stueckzahl, 0) * 100
  ) / 100;

  if (wt.gesamtgewicht_kg > config.gewicht_hard_kg) {
    wt.gewicht_status = 'hard_fail';
  } else if (wt.gesamtgewicht_kg > config.gewicht_soft_kg) {
    wt.gewicht_status = 'soft_warn';
  } else {
    wt.gewicht_status = 'ok';
  }
}

/**
 * Compute how many items of this article fit in one strip on the WT.
 * Strip depth = article.breite_mm (+ teiler_breite_mm between strips)
 * Items across = floor(WT_WIDTH / article.laenge_mm)
 * Items high = article.max_stapelhoehe
 */
function stripCapacity(artikel: ArtikelProcessed): number {
  const slotsAcross = Math.floor(WT_WIDTH / artikel.laenge_mm);
  const slotsHigh = artikel.max_stapelhoehe > 0 ? artikel.max_stapelhoehe : 1;
  return slotsAcross * slotsHigh;
}

/**
 * Depth needed for one strip of this article type.
 * The teiler is added BETWEEN strips, not after the last one.
 */
function stripDepth(artikel: ArtikelProcessed): number {
  return artikel.breite_mm;
}

/**
 * A-Artikel Scattering: split high-stock A-articles into multiple virtual entries
 * so they get placed on separate WTs, preventing hotspots.
 */
function scatterAArtikel(
  processed: ArtikelProcessed[],
  config: WTConfig,
): ArtikelProcessed[] {
  const n = config.a_artikel_scatter_n;
  if (n <= 1) return processed;

  const result: ArtikelProcessed[] = [];

  for (const art of processed) {
    if (art.abc_klasse === 'A' && art.bestand > n) {
      // Split into n virtual entries
      const chunkSize = Math.ceil(art.bestand / n);
      let remaining = art.bestand;
      for (let i = 0; i < n && remaining > 0; i++) {
        const chunk = Math.min(chunkSize, remaining);
        result.push({
          ...art,
          bestand: chunk,
          platzbedarf_mm2: chunk * art.grundflaeche_mm2,
        });
        remaining -= chunk;
      }
    } else {
      result.push(art);
    }
  }

  return result;
}

export function processPhase3(
  processed: ArtikelProcessed[],
  _clusters: ClusterResult,
  config: WTConfig,
): WT[] {
  // Apply A-Artikel scattering before packing
  const scattered = scatterAArtikel(processed, config);

  const allWTStates: WTState[] = [];
  let kleinCounter = 0;
  let grossCounter = 0;

  // Group articles by cluster
  const clusterGroups = new Map<number, ArtikelProcessed[]>();
  for (const art of scattered) {
    const cid = art.cluster_id ?? 0;
    if (!clusterGroups.has(cid)) clusterGroups.set(cid, []);
    clusterGroups.get(cid)!.push(art);
  }

  for (const [clusterId, articles] of clusterGroups) {
    // Sort by grundflaeche descending (First Fit Decreasing)
    const sorted = [...articles].sort((a, b) => b.grundflaeche_mm2 - a.grundflaeche_mm2);

    const clusterWTStates: WTState[] = [];

    for (const artikel of sorted) {
      // Skip non-storable articles
      if (artikel.hoehe_mm > config.hoehe_limit_mm) continue;
      if (artikel.grundflaeche_mm2 <= 0) continue;

      let remaining = artikel.bestand;
      const capPerStrip = stripCapacity(artikel);
      const artStripDepth = stripDepth(artikel);

      // Skip articles that can't fit on any WT type
      if (capPerStrip <= 0) continue;              // laenge_mm > WT_WIDTH (500mm)
      if (artStripDepth > WT_DEPTH_GROSS) continue; // breite_mm > largest WT depth

      while (remaining > 0) {
        const placeCount = Math.min(remaining, capPerStrip);

        // Try to fit a strip on an existing WT
        // Two-pass: prefer WTs within soft weight limit, then allow up to hard limit
        let placed = false;
        for (const weightLimit of [config.gewicht_soft_kg, config.gewicht_hard_kg]) {
          if (placed) break;
          for (const wtState of clusterWTStates) {
            const wtDepth = getWTDepth(wtState.wt.typ);

            // Check if this article already has a position on this WT
            const existingPos = wtState.wt.positionen.find(
              p => p.artikelnummer === String(artikel.artikelnummer),
            );
            const isNewArticleType = !existingPos;

            // Teiler only needed between DIFFERENT article types, not between
            // continuation strips of the same article
            const needsTeiler = isNewArticleType && wtState.stripCount > 0;
            const depthNeeded = artStripDepth + (needsTeiler ? config.teiler_breite_mm : 0);
            const remainingDepth = wtDepth - wtState.usedDepth;

            if (depthNeeded > remainingDepth) continue;

            // Clamp by weight budget
            const weightBudget = weightLimit - wtState.wt.gesamtgewicht_kg;
            if (weightBudget <= 0) continue;
            const maxByWeight = Math.floor(weightBudget / artikel.gewicht_kg);
            if (maxByWeight <= 0) continue;
            const actualPlace = Math.min(placeCount, maxByWeight);

            if (existingPos) {
              // Continuation strip: merge into existing position, no new teiler
              existingPos.stueckzahl += actualPlace;
            } else {
              // New article type on this WT: push position, count new strip
              wtState.wt.positionen.push({
                artikelnummer: String(artikel.artikelnummer),
                bezeichnung: artikel.bezeichnung,
                stueckzahl: actualPlace,
                grundflaeche_mm2: artikel.grundflaeche_mm2,
                gewicht_kg: artikel.gewicht_kg,
                abc_klasse: artikel.abc_klasse,
                breite_mm: artikel.breite_mm,
                laenge_mm: artikel.laenge_mm,
                max_stapelhoehe: artikel.max_stapelhoehe,
              });
              wtState.stripCount++;
            }
            wtState.usedDepth += depthNeeded; // physical depth always consumed
            updateWTMetrics(wtState, config);
            remaining -= actualPlace;
            placed = true;
            break;
          }
        }

        if (!placed) {
          // Clamp by weight on fresh WT
          const maxByWeight = Math.floor(config.gewicht_hard_kg / artikel.gewicht_kg);
          if (maxByWeight <= 0) break; // Single item exceeds hard limit

          const actualPlace = Math.min(placeCount, maxByWeight);

          // Determine WT type for this article, respect inventory limits
          let typ = chooseWTTypForArticle(artikel);
          if (typ === 'KLEIN' && kleinCounter >= config.anzahl_klein) typ = 'GROSS';
          if (typ === 'GROSS' && grossCounter >= config.anzahl_gross) typ = 'KLEIN';

          let id: string;
          if (typ === 'KLEIN') {
            kleinCounter++;
            id = `K-${String(kleinCounter).padStart(4, '0')}`;
          } else {
            grossCounter++;
            id = `G-${String(grossCounter).padStart(4, '0')}`;
          }
          const newWT = createWT(id, typ, clusterId);
          const newState: WTState = { wt: newWT, usedDepth: 0, stripCount: 0 };

          // Place first strip (no teiler needed)
          newWT.positionen.push({
            artikelnummer: String(artikel.artikelnummer),
            bezeichnung: artikel.bezeichnung,
            stueckzahl: actualPlace,
            grundflaeche_mm2: artikel.grundflaeche_mm2,
            gewicht_kg: artikel.gewicht_kg,
            abc_klasse: artikel.abc_klasse,
            breite_mm: artikel.breite_mm,
            laenge_mm: artikel.laenge_mm,
            max_stapelhoehe: artikel.max_stapelhoehe,
          });
          newState.usedDepth = artStripDepth;
          newState.stripCount = 1;
          updateWTMetrics(newState, config);
          clusterWTStates.push(newState);
          remaining -= actualPlace;
        }
      }
    }

    allWTStates.push(...clusterWTStates);
  }

  // Build lookup for fast WTState access by WT id
  const stateMap = new Map<string, WTState>();
  for (const s of allWTStates) stateMap.set(s.wt.id, s);

  // Weight balancing: try to move lightest position from overweight WTs
  for (const srcState of allWTStates) {
    const wt = srcState.wt;
    if (wt.gesamtgewicht_kg <= config.gewicht_soft_kg) continue;
    if (wt.positionen.length <= 1) continue;

    // Find lightest position
    const sorted = [...wt.positionen].sort(
      (a, b) => a.gewicht_kg * a.stueckzahl - b.gewicht_kg * b.stueckzahl,
    );
    const lightest = sorted[0];
    const artBreite = lightest.breite_mm ?? 0;

    // Find another WT in same cluster that can take it
    const sameCluster = allWTStates.filter(
      s => s.wt.cluster_id === wt.cluster_id && s.wt.id !== wt.id,
    );
    for (const tgtState of sameCluster) {
      const targetWeight = tgtState.wt.gesamtgewicht_kg + lightest.gewicht_kg * lightest.stueckzahl;
      if (targetWeight <= config.gewicht_hard_kg) {
        // Check depth capacity on target
        const tgtDepth = getWTDepth(tgtState.wt.typ);
        const needsTeiler = tgtState.stripCount > 0;
        const depthNeeded = artBreite + (needsTeiler ? config.teiler_breite_mm : 0);
        if (depthNeeded > tgtDepth - tgtState.usedDepth) continue;

        const idx = wt.positionen.indexOf(lightest);
        if (idx >= 0) {
          wt.positionen.splice(idx, 1);
          tgtState.wt.positionen.push(lightest);

          // Update source WTState
          const srcTeiler = srcState.stripCount > 1 ? config.teiler_breite_mm : 0;
          srcState.usedDepth = Math.max(0, srcState.usedDepth - artBreite - srcTeiler);
          srcState.stripCount = Math.max(0, srcState.stripCount - 1);
          updateWTMetrics(srcState, config);

          // Update target WTState
          tgtState.usedDepth += depthNeeded;
          tgtState.stripCount++;
          updateWTMetrics(tgtState, config);
          break;
        }
      }
    }
  }

  return allWTStates.map(s => s.wt);
}
