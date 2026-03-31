import type { ArtikelProcessed, WTConfig, WT, WTTyp, WTPosition } from '../types';
import type { AffinityResult } from '../types';

// WT physical dimensions (mm)
const WT_WIDTH = 500;
const WT_DEPTH_KLEIN = 500;
const WT_DEPTH_GROSS = 800;
const MAX_HEIGHT_MM = 320;

// 2D grid model constants
const DEPTH_SEGMENTS = [100, 150, 200, 350]; // mm, ascending — standard divider sizes
const WIDTH_SPLIT_MM = 250;                   // Mode B longitudinal divider

// Area constants for floor-cost calculations (used by phase5.ts)
export const KLEIN_AREA = WT_WIDTH * WT_DEPTH_KLEIN;   // 250,000 mm²
export const GROSS_AREA = WT_WIDTH * WT_DEPTH_GROSS;   // 400,000 mm²
export const KLEIN_FLOOR_M2 = 0.25;
export const GROSS_FLOOR_M2 = 0.40;

// ============================================================
// 3D Orientation Optimization
// ============================================================

export interface ArticleOrientation {
  vert_mm: number;
  h1_mm: number;
  h2_mm: number;
  max_stapelhoehe: number;
  grundflaeche_mm2: number;
  items: number;
}

export function bestArticleOrientation(
  h_mm: number, b_mm: number, l_mm: number,
  w_kg: number, wtWidth: number, wtDepth: number,
  maxWeightKg: number, _minSegMm = 0,
): ArticleOrientation | null {
  const dims: [number, number, number] = [h_mm, b_mm, l_mm];
  let best: ArticleOrientation | null = null;
  let bestItems = -1;

  for (let i = 0; i < 3; i++) {
    const vert = dims[i];
    if (vert <= 0 || vert > MAX_HEIGHT_MM) continue;
    const stapel = Math.floor(MAX_HEIGHT_MM / vert);
    if (stapel <= 0) continue;

    const fp = dims.filter((_, j) => j !== i) as [number, number];
    for (const [fp1, fp2] of [[fp[0], fp[1]], [fp[1], fp[0]]] as [number, number][]) {
      if (fp1 <= 0 || fp2 <= 0) continue;
      if (fp1 > wtWidth || fp2 > wtDepth) continue;

      const cols = Math.floor(wtWidth / fp1);
      const rows = Math.floor(wtDepth / fp2);
      const grid = cols * rows;
      if (grid <= 0) continue;

      const itemsGeom = grid * stapel;
      const itemsWeight = w_kg > 0 ? Math.floor(maxWeightKg / w_kg) : 999_999;
      const items = Math.min(itemsGeom, itemsWeight);

      if (items > bestItems) {
        bestItems = items;
        best = {
          vert_mm: vert, h1_mm: fp1, h2_mm: fp2,
          max_stapelhoehe: stapel, grundflaeche_mm2: fp1 * fp2, items,
        };
      }
    }
  }
  return best;
}

// ============================================================
// Exported helpers (used by phase5.ts)
// ============================================================

export function itemsPerWT(
  artikel: ArtikelProcessed, wtWidth: number, wtDepth: number,
  maxWeightKg: number, minSegMm = 0,
): number {
  return bestArticleOrientation(
    artikel.hoehe_mm, artikel.breite_mm, artikel.laenge_mm,
    artikel.gewicht_kg, wtWidth, wtDepth, maxWeightKg, minSegMm,
  )?.items ?? 0;
}

export function itemsPerWT2D(
  artikel: ArtikelProcessed, wtArea: number, maxWeightKg: number, minSegMm = 0,
): number {
  const depth = wtArea === KLEIN_AREA ? WT_DEPTH_KLEIN : WT_DEPTH_GROSS;
  return itemsPerWT(artikel, WT_WIDTH, depth, maxWeightKg, minSegMm);
}

// ============================================================
// WT Type Planning
// ============================================================

export interface WTTypePreference {
  artikelnummer: string;
  n_klein: number;
  n_gross: number;
  area_cost_klein: number;
  area_cost_gross: number;
  best_type: WTTyp;
  must_gross: boolean;
  area_saving: number;
}

export function planWTTypes(
  processed: ArtikelProcessed[],
  config: WTConfig,
): { plan: Map<string, WTTyp>; preferences: WTTypePreference[] } {
  const preferences: WTTypePreference[] = [];

  for (const art of processed) {
    if (art.bestand <= 0) continue;
    if (art.grundflaeche_mm2 <= 0) continue;

    const orientKlein = bestArticleOrientation(
      art.hoehe_mm, art.breite_mm, art.laenge_mm,
      art.gewicht_kg, WT_WIDTH, WT_DEPTH_KLEIN, config.gewicht_soft_kg, config.min_segment_mm,
    );
    const orientGross = bestArticleOrientation(
      art.hoehe_mm, art.breite_mm, art.laenge_mm,
      art.gewicht_kg, WT_WIDTH, WT_DEPTH_GROSS, config.gewicht_soft_kg, config.min_segment_mm,
    );

    if (!orientGross) continue;

    const itemsKlein = orientKlein?.items ?? 0;
    const itemsGross = orientGross.items;
    const fitsKlein = itemsKlein > 0;
    const mustGross = !fitsKlein;

    const nKlein = fitsKlein ? Math.ceil(art.bestand / Math.max(1, itemsKlein)) : 999_999;
    const nGross = Math.ceil(art.bestand / Math.max(1, itemsGross));
    const areaCostKlein = fitsKlein ? nKlein * KLEIN_FLOOR_M2 : 999_999;
    const areaCostGross = nGross * GROSS_FLOOR_M2;
    const bestType: WTTyp = (!fitsKlein || areaCostGross < areaCostKlein) ? 'GROSS' : 'KLEIN';

    preferences.push({
      artikelnummer: String(art.artikelnummer),
      n_klein: nKlein === 999_999 ? 0 : nKlein,
      n_gross: nGross,
      area_cost_klein: fitsKlein ? areaCostKlein : 0,
      area_cost_gross: areaCostGross,
      best_type: bestType,
      must_gross: mustGross,
      area_saving: areaCostKlein - areaCostGross,
    });
  }

  const plan = new Map<string, WTTyp>();
  for (const p of preferences) plan.set(p.artikelnummer, p.best_type);
  return { plan, preferences };
}

// ============================================================
// 2D Grid helpers
// ============================================================

function getWTDepth(typ: WTTyp): number {
  return typ === 'KLEIN' ? WT_DEPTH_KLEIN : WT_DEPTH_GROSS;
}

function getWTArea(typ: WTTyp): number {
  return typ === 'KLEIN' ? KLEIN_AREA : GROSS_AREA;
}

function getMaxRows(typ: WTTyp, mode: 'A' | 'B'): number {
  return mode === 'B' ? 3 : (typ === 'KLEIN' ? 5 : 6);
}

function getZoneWidth(mode: 'A' | 'B'): number {
  return mode === 'B' ? WIDTH_SPLIT_MM : WT_WIDTH;
}

/** Max items of an article in a zone of given dimensions (pure geometry). */
function zoneCapacity(
  art: Pick<ArtikelProcessed, 'hoehe_mm' | 'breite_mm' | 'laenge_mm' | 'gewicht_kg'>,
  zoneWidth: number,
  zoneDepth: number,
  griffPufferMm = 0,
): number {
  let best = 0;
  const dims: [number, number, number] = [art.hoehe_mm, art.breite_mm, art.laenge_mm];
  for (let i = 0; i < 3; i++) {
    const vert = dims[i];
    if (vert <= 0 || vert > MAX_HEIGHT_MM) continue;
    const stack = Math.floor(MAX_HEIGHT_MM / vert);
    const fp = dims.filter((_, j) => j !== i) as [number, number];
    for (const [fp1, fp2] of [[fp[0], fp[1]], [fp[1], fp[0]]] as [number, number][]) {
      if (fp1 <= 0 || fp2 <= 0 || fp1 > zoneWidth || fp2 > zoneDepth) continue;
      const cols = Math.floor(zoneWidth / fp1);
      const rows = Math.floor(zoneDepth / fp2);
      if (griffPufferMm > 0) {
        const freiW = zoneWidth - cols * fp1;
        const freiD = zoneDepth - rows * fp2;
        if (freiW < griffPufferMm && freiD < griffPufferMm) continue;
      }
      best = Math.max(best, cols * rows * stack);
    }
  }
  return best;
}

/**
 * Minimum standard depth segment to hold `stock` items in a zone of `zoneWidth`.
 * Uses raw dimensions so it can be called with WTPosition data (no ArtikelProcessed needed).
 * Returns null if needs > 350mm (article requires full zone).
 */
function requiredDepthForStock(
  h_mm: number, b_mm: number, l_mm: number, w_kg: number,
  stock: number, zoneWidth: number, maxWeightKg: number,
): number | null {
  // Find best orientation for this zone width (ignore depth limit)
  const orient = bestArticleOrientation(h_mm, b_mm, l_mm, w_kg, zoneWidth, 9999, maxWeightKg);
  if (!orient) return null;

  const itemsPerRow = Math.floor(zoneWidth / orient.h1_mm) * orient.max_stapelhoehe;
  if (itemsPerRow <= 0) return null;

  const rowsNeeded = Math.ceil(stock / itemsPerRow);
  const depthNeeded = orient.h2_mm * rowsNeeded;

  for (const seg of DEPTH_SEGMENTS) {
    if (seg >= depthNeeded) return seg;
  }
  return null; // needs > max(DEPTH_SEGMENTS) = 350mm → full zone
}

function requiredDepthSegment(
  art: Pick<ArtikelProcessed, 'hoehe_mm' | 'breite_mm' | 'laenge_mm' | 'gewicht_kg' | 'bestand'>,
  zoneWidth: number, maxWeightKg: number,
): number | null {
  return requiredDepthForStock(
    art.hoehe_mm, art.breite_mm, art.laenge_mm, art.gewicht_kg,
    art.bestand, zoneWidth, maxWeightKg,
  );
}

/**
 * Returns 'BOTH' if article can fit in a 250mm-wide Mode B zone,
 * 'A' if requires full 500mm width.
 */
function articleFitsMode(
  art: Pick<ArtikelProcessed, 'hoehe_mm' | 'breite_mm' | 'laenge_mm'>,
): 'A' | 'BOTH' {
  const dims = [art.hoehe_mm, art.breite_mm, art.laenge_mm];
  for (let i = 0; i < 3; i++) {
    if (dims[i] <= 0 || dims[i] > MAX_HEIGHT_MM) continue;
    const fp = dims.filter((_, j) => j !== i);
    // fp is [fp[0], fp[1]]; if either footprint dim <= WIDTH_SPLIT_MM it fits Mode B
    if (Math.min(fp[0], fp[1]) <= WIDTH_SPLIT_MM) return 'BOTH';
  }
  return 'A';
}

// ============================================================
// WT lifecycle helpers
// ============================================================

function makePosition(
  artNr: string, art: ArtikelProcessed,
  stueckzahl: number, zoneIndex: number, rowIndex: number, colIndex: number,
): WTPosition {
  return {
    artikelnummer: artNr,
    bezeichnung: art.bezeichnung,
    stueckzahl,
    grundflaeche_mm2: art.grundflaeche_mm2,
    gewicht_kg: art.gewicht_kg,
    abc_klasse: art.abc_klasse,
    hoehe_mm: art.hoehe_mm,
    breite_mm: art.breite_mm,
    laenge_mm: art.laenge_mm,
    max_stapelhoehe: art.max_stapelhoehe,
    zone_index: zoneIndex,
    row_index: rowIndex,
    col_index: colIndex,
  };
}

function createWT(id: string, typ: WTTyp, mode: 'A' | 'B', clusterId: number): WT {
  return {
    id, typ, mode, positionen: [], cluster_id: clusterId,
    gesamtgewicht_kg: 0,
    flaeche_brutto_mm2: getWTArea(typ),
    flaeche_netto_pct: 0,
    anzahl_teiler: 0,
    gewicht_status: 'ok',
    grid_cols: mode === 'B' ? 2 : 1,
    grid_rows: 0,
    zone_count: 0,
    zone_w_mm: getZoneWidth(mode),
    zone_d_mm: 0,
    zone_depths_mm: [],
  };
}

function updateWTMetrics(wt: WT, config: WTConfig): void {
  wt.gesamtgewicht_kg = Math.round(
    wt.positionen.reduce((s, p) => s + p.gewicht_kg * p.stueckzahl, 0) * 100,
  ) / 100;

  const rows = wt.zone_depths_mm.length;
  const cols = wt.mode === 'B' ? 2 : 1;
  wt.grid_cols = cols;
  wt.grid_rows = rows;
  wt.zone_count = rows * cols;
  // zone_d_mm: avg row depth — backward compat for C7 check
  // Proof: zone_count * zone_w_mm * zone_d_mm = (rows*cols) * zoneWidth * (sum/rows)
  //        = cols * zoneWidth * sum = 500 * sum ≤ 500 * WT_DEPTH ✓
  wt.zone_d_mm = rows > 0
    ? Math.round(wt.zone_depths_mm.reduce((s, d) => s + d, 0) / rows)
    : 0;
  wt.anzahl_teiler = Math.max(0, rows - 1) + (wt.mode === 'B' ? 1 : 0);
  wt.flaeche_netto_pct = wt.zone_count > 0
    ? Math.round((wt.positionen.length / wt.zone_count) * 10000) / 100
    : 0;
  wt.gewicht_status = wt.gesamtgewicht_kg > config.gewicht_hard_kg ? 'hard_fail'
    : wt.gesamtgewicht_kg > config.gewicht_soft_kg ? 'soft_warn'
    : 'ok';
}

// ============================================================
// Core placement: addArticleToWT
// ============================================================

/**
 * Try to place `remainingStk` items of `art` on `wt`.
 * Strategies (in order):
 *   1. Zone shrinking: if WT has 1 full-depth zone, shrink it and add new row
 *   2. New depth row (if depth and row-count allow)
 *   3. Mode B: free column in an existing row
 * Returns items placed (0 = could not fit).
 */
function addArticleToWT(
  wt: WT, artNr: string, art: ArtikelProcessed, remainingStk: number,
  config: WTConfig, artDataMap?: Map<string, ArtikelProcessed>,
): number {
  if (wt.positionen.some(p => p.artikelnummer === artNr)) return 0;
  if (remainingStk <= 0) return 0;

  const zoneWidth = getZoneWidth(wt.mode);
  const wtDepth = getWTDepth(wt.typ);
  const maxR = getMaxRows(wt.typ, wt.mode);

  // Required depth based on per-zone stock (not total art.bestand)
  const maxCapInFullZone = Math.max(1, zoneCapacity(art, zoneWidth, wtDepth, config.griff_puffer_mm));
  const stockForThisZone = Math.min(remainingStk, maxCapInFullZone);
  let seg = requiredDepthForStock(
    art.hoehe_mm, art.breite_mm, art.laenge_mm, art.gewicht_kg,
    stockForThisZone, zoneWidth, config.gewicht_hard_kg,
  );
  if (seg === null) {
    // Article needs full zone — take all remaining depth
    const usedNow = wt.zone_depths_mm.reduce((s, d) => s + d, 0);
    const rem = wtDepth - usedNow;
    if (rem <= 0) return 0;
    seg = rem;
  }

  // === Strategy 1: Zone shrinking ===
  // If WT has exactly 1 full-depth row with 1 article, shrink that zone to free space.
  let didShrink = false;
  let originalFirstDepth = 0;

  if (
    wt.zone_depths_mm.length === 1 &&
    wt.zone_depths_mm[0] === wtDepth &&
    wt.positionen.length === 1 &&
    artDataMap
  ) {
    const ep = wt.positionen[0];
    const existingArt = artDataMap.get(ep.artikelnummer);
    if (existingArt) {
      const neededForExisting = requiredDepthForStock(
        ep.hoehe_mm, ep.breite_mm, ep.laenge_mm, ep.gewicht_kg,
        ep.stueckzahl, zoneWidth, config.gewicht_hard_kg,
      );
      if (neededForExisting !== null && neededForExisting < wtDepth) {
        const capCheck = zoneCapacity(existingArt, zoneWidth, neededForExisting, config.griff_puffer_mm);
        if (capCheck >= ep.stueckzahl && neededForExisting + seg <= wtDepth) {
          originalFirstDepth = wt.zone_depths_mm[0];
          wt.zone_depths_mm[0] = neededForExisting;
          didShrink = true;
        }
      }
    }
  }

  // === Strategy 2: New depth row ===
  const usedDepth = wt.zone_depths_mm.reduce((s, d) => s + d, 0);
  const rows = wt.zone_depths_mm.length;

  if (usedDepth + seg <= wtDepth && rows < maxR) {
    const cap = zoneCapacity(art, zoneWidth, seg, config.griff_puffer_mm);
    if (cap > 0) {
      let toPlace = Math.min(remainingStk, cap);
      if (art.gewicht_kg > 0) {
        const maxByWeight = Math.floor(
          (config.gewicht_hard_kg - wt.gesamtgewicht_kg) / art.gewicht_kg,
        );
        toPlace = Math.min(toPlace, maxByWeight);
      }
      if (toPlace > 0) {
        const rowIdx = rows;
        const colIdx = 0;
        const zoneIdx = rowIdx * (wt.mode === 'B' ? 2 : 1) + colIdx;
        wt.zone_depths_mm.push(seg);
        wt.positionen.push(makePosition(artNr, art, toPlace, zoneIdx, rowIdx, colIdx));
        updateWTMetrics(wt, config);
        return toPlace;
      }
    }
  }

  // Undo shrink if strategy 2 failed
  if (didShrink) wt.zone_depths_mm[0] = originalFirstDepth;

  // === Strategy 3: Mode B — free column in existing row ===
  if (wt.mode === 'B') {
    for (let rowIdx = 0; rowIdx < wt.zone_depths_mm.length; rowIdx++) {
      const rowDepth = wt.zone_depths_mm[rowIdx];
      const colsUsed = wt.positionen.filter(p => p.row_index === rowIdx).length;
      if (colsUsed >= 2) continue;

      const cap = zoneCapacity(art, zoneWidth, rowDepth, config.griff_puffer_mm);
      if (cap <= 0) continue;

      let toPlace = Math.min(remainingStk, cap);
      if (art.gewicht_kg > 0) {
        const maxByWeight = Math.floor(
          (config.gewicht_hard_kg - wt.gesamtgewicht_kg) / art.gewicht_kg,
        );
        toPlace = Math.min(toPlace, maxByWeight);
      }
      if (toPlace <= 0) continue;

      const colIdx = colsUsed; // 0 or 1
      const zoneIdx = rowIdx * 2 + colIdx;
      wt.positionen.push(makePosition(artNr, art, toPlace, zoneIdx, rowIdx, colIdx));
      updateWTMetrics(wt, config);
      return toPlace;
    }
  }

  return 0;
}

// ============================================================
// Move position (used by weight balancing + consolidation)
// ============================================================

function tryMovePositionToWT(
  srcWT: WT, pos: WTPosition, tgtWT: WT,
  config: WTConfig, artDataMap: Map<string, ArtikelProcessed>,
): boolean {
  const artNr = pos.artikelnummer;
  if (tgtWT.positionen.some(p => p.artikelnummer === artNr)) return false;
  const art = artDataMap.get(artNr);
  if (!art) return false;

  // Save target state for rollback
  const savedPositionen = [...tgtWT.positionen];
  const savedDepths = [...tgtWT.zone_depths_mm];

  const placed = addArticleToWT(tgtWT, artNr, art, pos.stueckzahl, config, artDataMap);

  if (placed < pos.stueckzahl) {
    // Rollback
    tgtWT.positionen = savedPositionen;
    tgtWT.zone_depths_mm = savedDepths;
    updateWTMetrics(tgtWT, config);
    return false;
  }

  // Remove from source
  const rowIdx = pos.row_index;
  srcWT.positionen.splice(srcWT.positionen.indexOf(pos), 1);

  // Clean up ghost zone_depths_mm entry if the row is now empty
  const rowStillOccupied = srcWT.positionen.some(p => p.row_index === rowIdx);
  if (!rowStillOccupied) {
    srcWT.zone_depths_mm.splice(rowIdx, 1);
    for (const p of srcWT.positionen) {
      if (p.row_index > rowIdx) {
        p.row_index--;
        p.zone_index = p.row_index * (srcWT.mode === 'B' ? 2 : 1) + p.col_index;
      }
    }
  }

  updateWTMetrics(srcWT, config);
  return true;
}

// ============================================================
// Step 1: Cluster Formation
// ============================================================

interface Cluster {
  id: number;
  members: string[]; // artNr, seed first
}

const HUB_THRESHOLD = 10; // articles with >10 partners → hub-scatter

function buildClusters(
  processed: ArtikelProcessed[],
  partnerIndex: Map<string, Array<{ partner: string; affinity: number }>>,
  wtTypePlan: Map<string, WTTyp>,
  config: WTConfig,
  artDataMap: Map<string, ArtikelProcessed>,
): Cluster[] {
  const clusters: Cluster[] = [];
  const assigned = new Set<string>(); // artNr → seeded into a cluster
  const hubSet = new Set<string>();   // artNr → used as hub seed (must not join partner clusters)

  // Sort by partner count desc, then umsatz desc
  const sortedByPartners = [...processed]
    .filter(a => a.bestand > 0)
    .sort((a, b) => {
      const aNr = String(a.artikelnummer);
      const bNr = String(b.artikelnummer);
      const aP = partnerIndex.get(aNr)?.length ?? 0;
      const bP = partnerIndex.get(bNr)?.length ?? 0;
      if (bP !== aP) return bP - aP;
      return b.umsatz_gesamt - a.umsatz_gesamt;
    });

  // Step 1a: Hub-Scatter
  for (const art of sortedByPartners) {
    const artNr = String(art.artikelnummer);
    const partners = partnerIndex.get(artNr) ?? [];
    if (partners.length <= HUB_THRESHOLD) continue;
    if (assigned.has(artNr)) continue;

    const fitsMode = articleFitsMode(art);
    const zw = getZoneWidth(fitsMode === 'BOTH' ? 'B' : 'A');
    const typ = wtTypePlan.get(artNr) ?? 'KLEIN';
    const depth = getWTDepth(typ);
    const cap = Math.max(1, zoneCapacity(art, zw, depth, config.griff_puffer_mm));
    const K = Math.max(1, Math.ceil(art.bestand / cap));

    const sortedPartners = [...partners].sort((x, y) => y.affinity - x.affinity);

    for (let i = 0; i < K; i++) {
      const members: string[] = [artNr];
      for (const { partner } of sortedPartners.slice(i * 5, (i + 1) * 5)) {
        const pArt = artDataMap.get(partner);
        if (pArt && pArt.bestand > 0) members.push(partner);
      }
      clusters.push({ id: clusters.length, members });
    }
    assigned.add(artNr);
    hubSet.add(artNr);
  }

  // Step 1b: Affinity Groups (non-hubs)
  for (const art of sortedByPartners) {
    const artNr = String(art.artikelnummer);
    if (assigned.has(artNr)) continue;

    const partners = partnerIndex.get(artNr) ?? [];
    const members: string[] = [artNr];
    assigned.add(artNr);

    for (const { partner } of [...partners].sort((x, y) => y.affinity - x.affinity)) {
      if (members.length >= 6) break;
      if (assigned.has(partner)) continue;
      if (hubSet.has(partner)) continue;
      const pArt = artDataMap.get(partner);
      if (pArt && pArt.bestand > 0) {
        members.push(partner);
        assigned.add(partner);
      }
    }
    clusters.push({ id: clusters.length, members });
  }

  // Step 1c: Singletons
  for (const art of processed) {
    const artNr = String(art.artikelnummer);
    if (art.bestand <= 0 || assigned.has(artNr)) continue;
    clusters.push({ id: clusters.length, members: [artNr] });
    assigned.add(artNr);
  }

  return clusters;
}

// ============================================================
// Step 2: FFD Packing per Cluster
// ============================================================

function packCluster(
  cluster: Cluster,
  artDataMap: Map<string, ArtikelProcessed>,
  remainingStock: Map<string, number>,
  wtTypePlan: Map<string, WTTyp>,
  config: WTConfig,
  nextId: (typ: WTTyp) => string,
): WT[] {
  const clusterWTs: WT[] = [];

  // Sort by required depth segment DESC (FFD: largest first)
  const articles = cluster.members
    .map(artNr => ({ artNr, art: artDataMap.get(artNr) }))
    .filter((x): x is { artNr: string; art: ArtikelProcessed } =>
      x.art !== undefined && (remainingStock.get(x.artNr) ?? 0) > 0,
    )
    .sort((a, b) => {
      const zwA = getZoneWidth(articleFitsMode(a.art) === 'BOTH' ? 'B' : 'A');
      const zwB = getZoneWidth(articleFitsMode(b.art) === 'BOTH' ? 'B' : 'A');
      const depA = getWTDepth(wtTypePlan.get(a.artNr) ?? 'KLEIN');
      const depB = getWTDepth(wtTypePlan.get(b.artNr) ?? 'KLEIN');
      const stkA = remainingStock.get(a.artNr) ?? 0;
      const stkB = remainingStock.get(b.artNr) ?? 0;
      const capA = Math.max(1, zoneCapacity(a.art, zwA, depA, config.griff_puffer_mm));
      const capB = Math.max(1, zoneCapacity(b.art, zwB, depB, config.griff_puffer_mm));
      const segA = requiredDepthForStock(
        a.art.hoehe_mm, a.art.breite_mm, a.art.laenge_mm, a.art.gewicht_kg,
        Math.min(stkA, capA), zwA, config.gewicht_hard_kg,
      ) ?? 800;
      const segB = requiredDepthForStock(
        b.art.hoehe_mm, b.art.breite_mm, b.art.laenge_mm, b.art.gewicht_kg,
        Math.min(stkB, capB), zwB, config.gewicht_hard_kg,
      ) ?? 800;
      return segB - segA; // DESC
    });

  for (const { artNr, art } of articles) {
    let stk = remainingStock.get(artNr) ?? 0;
    if (stk <= 0) continue;

    while (stk > 0) {
      // Phase A: try existing cluster WTs
      let placed = 0;
      for (const wt of clusterWTs) {
        const toPlace = addArticleToWT(wt, artNr, art, stk, config, artDataMap);
        if (toPlace > 0) {
          stk -= toPlace;
          remainingStock.set(artNr, (remainingStock.get(artNr) ?? 0) - toPlace);
          placed = toPlace;
          break;
        }
      }
      if (placed > 0) continue;

      // Phase B: create new WT
      const mode: 'A' | 'B' = articleFitsMode(art) === 'BOTH' ? 'B' : 'A';
      const typ = wtTypePlan.get(artNr) ?? 'KLEIN';
      const wt = createWT(nextId(typ), typ, mode, cluster.id);
      const toPlace = addArticleToWT(wt, artNr, art, stk, config, artDataMap);

      if (toPlace > 0) {
        stk -= toPlace;
        remainingStock.set(artNr, (remainingStock.get(artNr) ?? 0) - toPlace);
        clusterWTs.push(wt);
      } else if (mode === 'B') {
        // Fallback to Mode A if Mode B failed (wide article mismatch)
        const wtA = createWT(nextId(typ), typ, 'A', cluster.id);
        const toPlaceA = addArticleToWT(wtA, artNr, art, stk, config, artDataMap);
        if (toPlaceA > 0) {
          stk -= toPlaceA;
          remainingStock.set(artNr, (remainingStock.get(artNr) ?? 0) - toPlaceA);
          clusterWTs.push(wtA);
        } else {
          break; // C1 safety net handles any remaining deficit
        }
      } else {
        break;
      }
    }
  }

  return clusterWTs;
}

// ============================================================
// Step 3: Consolidation
// ============================================================

function consolidate(
  allWTs: WT[],
  artDataMap: Map<string, ArtikelProcessed>,
  partnerIndex: Map<string, Array<{ partner: string; affinity: number }>>,
  config: WTConfig,
): void {
  const removedIds = new Set<string>();

  // Fewest positions first = consolidation candidates
  const sorted = [...allWTs].sort((a, b) => a.positionen.length - b.positionen.length);

  for (const srcWT of sorted) {
    if (removedIds.has(srcWT.id) || srcWT.positionen.length === 0 || srcWT.positionen.length > 2) {
      continue;
    }

    for (const pos of [...srcWT.positionen]) {
      if (removedIds.has(srcWT.id)) break;
      const art = artDataMap.get(pos.artikelnummer);
      if (!art) continue;

      const partnerSet = new Set((partnerIndex.get(pos.artikelnummer) ?? []).map(p => p.partner));

      for (const tgtWT of allWTs) {
        if (tgtWT === srcWT || removedIds.has(tgtWT.id)) continue;
        if (tgtWT.positionen.some(p => p.artikelnummer === pos.artikelnummer)) continue;
        if (
          tgtWT.cluster_id !== srcWT.cluster_id &&
          !tgtWT.positionen.some(p => partnerSet.has(p.artikelnummer))
        ) continue;

        if (tryMovePositionToWT(srcWT, pos, tgtWT, config, artDataMap)) {
          if (srcWT.positionen.length === 0) removedIds.add(srcWT.id);
          break;
        }
      }
    }
  }

  // Remove emptied WTs in-place
  for (let i = allWTs.length - 1; i >= 0; i--) {
    if (removedIds.has(allWTs[i].id) || allWTs[i].positionen.length === 0) {
      allWTs.splice(i, 1);
    }
  }
}

// ============================================================
// Main Phase 3 Entry Point
// ============================================================

export function processPhase3(
  processed: ArtikelProcessed[],
  affinityResult: AffinityResult,
  config: WTConfig,
): WT[] {
  const { plan: wtTypePlan } = planWTTypes(processed, config);

  const artDataMap = new Map<string, ArtikelProcessed>();
  for (const art of processed) artDataMap.set(String(art.artikelnummer), art);

  let kleinCounter = 0;
  let grossCounter = 0;
  function nextId(typ: WTTyp): string {
    return typ === 'KLEIN'
      ? `K-${String(++kleinCounter).padStart(4, '0')}`
      : `G-${String(++grossCounter).padStart(4, '0')}`;
  }

  // Global remaining stock tracker
  const remainingStock = new Map<string, number>();
  for (const art of processed) {
    if (art.bestand > 0) remainingStock.set(String(art.artikelnummer), art.bestand);
  }

  // Step 1: Build clusters
  const clusters = buildClusters(
    processed, affinityResult.partnerIndex, wtTypePlan, config, artDataMap,
  );

  // Step 2: FFD packing per cluster
  const allWTs: WT[] = [];
  for (const cluster of clusters) {
    allWTs.push(...packCluster(cluster, artDataMap, remainingStock, wtTypePlan, config, nextId));
  }

  // Step 3: Consolidation
  consolidate(allWTs, artDataMap, affinityResult.partnerIndex, config);

  // Step 4: Weight Balancing
  const activeWTs = allWTs.filter(wt => wt.positionen.length > 0);
  for (const srcWT of activeWTs) {
    if (srcWT.gesamtgewicht_kg <= config.gewicht_soft_kg || srcWT.positionen.length <= 1) continue;
    const lightest = [...srcWT.positionen]
      .sort((a, b) => a.gewicht_kg * a.stueckzahl - b.gewicht_kg * b.stueckzahl)[0];
    for (const tgtWT of activeWTs) {
      if (tgtWT === srcWT || tgtWT.typ !== srcWT.typ) continue;
      if (tryMovePositionToWT(srcWT, lightest, tgtWT, config, artDataMap)) break;
    }
  }

  // Step 5: WT Type Downsize — GROSS single-position WTs that fit on KLEIN
  for (const wt of activeWTs) {
    if (wt.typ !== 'GROSS' || wt.positionen.length !== 1) continue;
    const pos = wt.positionen[0];
    const art = artDataMap.get(pos.artikelnummer);
    if (!art) continue;
    const zw = getZoneWidth(wt.mode);
    const capKlein = zoneCapacity(art, zw, WT_DEPTH_KLEIN, config.griff_puffer_mm);
    const maxByWeight = art.gewicht_kg > 0
      ? Math.floor(config.gewicht_hard_kg / art.gewicht_kg)
      : pos.stueckzahl;
    if (Math.min(capKlein, maxByWeight) >= pos.stueckzahl) {
      wt.typ = 'KLEIN';
      wt.flaeche_brutto_mm2 = KLEIN_AREA;
      if (wt.zone_depths_mm[0] > WT_DEPTH_KLEIN) {
        const seg = requiredDepthForStock(
          pos.hoehe_mm, pos.breite_mm, pos.laenge_mm, pos.gewicht_kg,
          pos.stueckzahl, zw, config.gewicht_hard_kg,
        );
        wt.zone_depths_mm[0] = seg ?? WT_DEPTH_KLEIN;
      }
      updateWTMetrics(wt, config);
    }
  }

  // Step 6: C1 Safety Net — guarantee all stock is placed
  const finalWTs = activeWTs.filter(wt => wt.positionen.length > 0);

  const finalPlaced = new Map<string, number>();
  for (const wt of finalWTs) {
    for (const pos of wt.positionen) {
      finalPlaced.set(pos.artikelnummer, (finalPlaced.get(pos.artikelnummer) ?? 0) + pos.stueckzahl);
    }
  }

  for (const art of processed) {
    if (art.bestand <= 0) continue;
    const artNr = String(art.artikelnummer);
    let deficit = art.bestand - (finalPlaced.get(artNr) ?? 0);
    if (deficit <= 0) continue;

    const fbTyp = wtTypePlan.get(artNr) ?? 'KLEIN';
    const fbDepth = getWTDepth(fbTyp);
    const fbCap = zoneCapacity(art, WT_WIDTH, fbDepth, config.griff_puffer_mm);
    if (fbCap <= 0) continue;

    while (deficit > 0) {
      let toPlace = Math.min(deficit, fbCap);
      if (art.gewicht_kg > 0) {
        toPlace = Math.min(toPlace, Math.floor(config.gewicht_hard_kg / art.gewicht_kg));
      }
      if (toPlace <= 0) break;

      const fbWT = createWT(nextId(fbTyp), fbTyp, 'A', art.cluster_id ?? 0);
      fbWT.zone_depths_mm = [fbDepth];
      fbWT.positionen.push(makePosition(artNr, art, toPlace, 0, 0, 0));
      updateWTMetrics(fbWT, config);
      finalWTs.push(fbWT);
      deficit -= toPlace;
    }
  }

  return finalWTs;
}
