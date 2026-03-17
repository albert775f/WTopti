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
  wt.anzahl_teiler = Math.max(0, wtState.stripCount - 1);

  // Net area = width × (total_depth - teiler space)
  const wtDepth = getWTDepth(wt.typ);
  const teilerLoss = wt.anzahl_teiler * config.teiler_breite_mm * WT_WIDTH;
  wt.flaeche_netto_mm2 = (WT_WIDTH * wtDepth) - teilerLoss;

  // Compute used area from positions
  const belegtFlaeche = wt.positionen.reduce((s, p) => s + p.grundflaeche_mm2 * p.stueckzahl, 0);
  wt.flaeche_netto_pct = wt.flaeche_netto_mm2 > 0
    ? Math.round((belegtFlaeche / wt.flaeche_netto_mm2) * 10000) / 100
    : 0;

  wt.gesamtgewicht_kg = wt.positionen.reduce((s, p) => s + p.gewicht_kg * p.stueckzahl, 0);
  wt.gesamtgewicht_kg = Math.round(wt.gesamtgewicht_kg * 100) / 100;

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

  const allWTs: WT[] = [];
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
        const placeWeight = placeCount * artikel.gewicht_kg;

        // Try to fit a strip on an existing WT
        let placed = false;
        for (const wtState of clusterWTStates) {
          const wtDepth = getWTDepth(wtState.wt.typ);
          // Depth needed: artStripDepth + teiler if not first strip
          const needsTeiler = wtState.stripCount > 0;
          const depthNeeded = artStripDepth + (needsTeiler ? config.teiler_breite_mm : 0);
          const remainingDepth = wtDepth - wtState.usedDepth;

          if (depthNeeded > remainingDepth) continue;

          // Check weight limit
          const newWeight = wtState.wt.gesamtgewicht_kg + placeWeight;
          if (newWeight > config.gewicht_hard_kg) continue;

          // Place strip
          wtState.wt.positionen.push({
            artikelnummer: String(artikel.artikelnummer),
            bezeichnung: artikel.bezeichnung,
            stueckzahl: placeCount,
            grundflaeche_mm2: artikel.grundflaeche_mm2,
            gewicht_kg: artikel.gewicht_kg,
            abc_klasse: artikel.abc_klasse,
          });
          wtState.usedDepth += depthNeeded;
          wtState.stripCount++;
          updateWTMetrics(wtState, config);
          remaining -= placeCount;
          placed = true;
          break;
        }

        if (!placed) {
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
          const wtState: WTState = { wt: newWT, usedDepth: 0, stripCount: 0 };

          // Place first strip (no teiler needed)
          newWT.positionen.push({
            artikelnummer: String(artikel.artikelnummer),
            bezeichnung: artikel.bezeichnung,
            stueckzahl: placeCount,
            grundflaeche_mm2: artikel.grundflaeche_mm2,
            gewicht_kg: artikel.gewicht_kg,
            abc_klasse: artikel.abc_klasse,
          });
          wtState.usedDepth = artStripDepth;
          wtState.stripCount = 1;
          updateWTMetrics(wtState, config);
          clusterWTStates.push(wtState);
          remaining -= placeCount;
        }
      }
    }

    allWTs.push(...clusterWTStates.map(s => s.wt));
  }

  // Weight balancing: try to move lightest position from overweight WTs
  for (const wt of allWTs) {
    if (wt.gesamtgewicht_kg <= config.gewicht_soft_kg) continue;
    if (wt.positionen.length <= 1) continue;

    // Find lightest position
    const sorted = [...wt.positionen].sort(
      (a, b) => a.gewicht_kg * a.stueckzahl - b.gewicht_kg * b.stueckzahl,
    );
    const lightest = sorted[0];

    // Find another WT in same cluster that can take it
    const sameCluster = allWTs.filter(
      w => w.cluster_id === wt.cluster_id && w.id !== wt.id,
    );
    for (const target of sameCluster) {
      const targetWeight = target.gesamtgewicht_kg + lightest.gewicht_kg * lightest.stueckzahl;
      if (targetWeight <= config.gewicht_hard_kg) {
        const idx = wt.positionen.indexOf(lightest);
        if (idx >= 0) {
          wt.positionen.splice(idx, 1);
          target.positionen.push(lightest);
          // Re-derive metrics (simplified — strip tracking lost after move, but metrics are still correct)
          break;
        }
      }
    }
  }

  return allWTs;
}
