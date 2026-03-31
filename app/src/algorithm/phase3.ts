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
    // Article needs full zone — try to claim all remaining depth for Strategy 2.
    // Do NOT return early here: Strategy 3 (Mode-B free column) must still be attempted
    // even when no depth remains for a new row.
    const usedNow = wt.zone_depths_mm.reduce((s, d) => s + d, 0);
    const rem = wtDepth - usedNow;
    seg = rem > 0 ? rem : wtDepth; // Strategy 2 will reject this if rem ≤ 0
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

  if (rows < maxR) {
    // Compute the segment based on what actually fits in the free depth.
    // The initial `seg` was computed for maxCapInFullZone (full WT depth), which can
    // exceed the free depth when the WT already has rows. Recompute for free depth.
    const freeD = wtDepth - usedDepth;
    let effectiveSeg = seg;
    let effectiveStk = remainingStk;
    if (freeD > 0 && usedDepth + seg > wtDepth) {
      // Try again with the free depth as the zone capacity limit
      const capInFree = zoneCapacity(art, zoneWidth, freeD, config.griff_puffer_mm);
      if (capInFree > 0) {
        const stkInFree = Math.min(remainingStk, capInFree);
        const segInFree = requiredDepthForStock(
          art.hoehe_mm, art.breite_mm, art.laenge_mm, art.gewicht_kg,
          stkInFree, zoneWidth, config.gewicht_hard_kg,
        );
        if (segInFree !== null && usedDepth + segInFree <= wtDepth) {
          effectiveSeg = segInFree;
          effectiveStk = stkInFree;
        }
      }
    }

    if (usedDepth + effectiveSeg <= wtDepth) {
      const cap = zoneCapacity(art, zoneWidth, effectiveSeg, config.griff_puffer_mm);
      if (cap > 0) {
        let toPlace = Math.min(effectiveStk, cap);
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
          wt.zone_depths_mm.push(effectiveSeg);
          wt.positionen.push(makePosition(artNr, art, toPlace, zoneIdx, rowIdx, colIdx));
          updateWTMetrics(wt, config);
          return toPlace;
        }
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
// Step 0: Pair-pack — guarantee co-location for top affinity pairs
// ============================================================

/**
 * Cluster-pack top affinity articles: for each article (sorted by total affinity
 * connectivity DESC), create one Mode B WT containing that article as anchor plus
 * as many of its affinity partners as geometrically fit.
 *
 * This co-locates many pairs per WT rather than one pair per WT, avoiding the
 * stock-exhaustion problem that a pair-by-pair strategy causes.
 * Updates remainingStock in-place for all placed articles.
 */
function step0ClusterPack(
  artDataMap: Map<string, ArtikelProcessed>,
  partnerIndex: Map<string, Array<{ partner: string; affinity: number }>>,
  wtTypePlan: Map<string, WTTyp>,
  config: WTConfig,
  nextId: (typ: WTTyp) => string,
  remainingStock: Map<string, number>,
): WT[] {
  // Build bidirectional partner lookup
  const reverseIndex = new Map<string, Array<{ seed: string; affinity: number }>>();
  for (const [seed, partners] of partnerIndex.entries()) {
    for (const { partner, affinity } of partners) {
      if (!reverseIndex.has(partner)) reverseIndex.set(partner, []);
      reverseIndex.get(partner)!.push({ seed, affinity });
    }
  }

  const getAllPartners = (artNr: string): Array<{ nr: string; affinity: number }> => {
    const seen = new Set<string>();
    const result: Array<{ nr: string; affinity: number }> = [];
    for (const { partner, affinity } of partnerIndex.get(artNr) ?? []) {
      if (!seen.has(partner)) { seen.add(partner); result.push({ nr: partner, affinity }); }
    }
    for (const { seed, affinity } of reverseIndex.get(artNr) ?? []) {
      if (!seen.has(seed)) { seen.add(seed); result.push({ nr: seed, affinity }); }
    }
    return result.sort((a, b) => b.affinity - a.affinity);
  };

  // Sort candidate anchors by total affinity weight DESC (most connected = most pairs to gain)
  const candidates = [...artDataMap.keys()]
    .filter(nr => {
      const stk = remainingStock.get(nr) ?? 0;
      if (stk <= 0) return false;
      const art = artDataMap.get(nr)!;
      return articleFitsMode(art) === 'BOTH' && getAllPartners(nr).length > 0;
    })
    .map(nr => ({
      nr,
      totalAff: getAllPartners(nr).reduce((s, p) => s + p.affinity, 0),
    }))
    .sort((a, b) => b.totalAff - a.totalAff);

  const clusterWTs: WT[] = [];

  for (const { nr: anchorNr } of candidates) {
    const anchorStk = remainingStock.get(anchorNr) ?? 0;
    if (anchorStk <= 0) continue; // stock depleted by earlier clusters

    const anchorArt = artDataMap.get(anchorNr);
    if (!anchorArt || articleFitsMode(anchorArt) !== 'BOTH') continue;

    const partners = getAllPartners(anchorNr);
    // Skip anchor if no partner has available stock
    if (!partners.some(p => (remainingStock.get(p.nr) ?? 0) > 0)) continue;

    // WT type: GROSS if anchor or any partner prefers GROSS (more depth → fits more)
    const needsGross =
      wtTypePlan.get(anchorNr) === 'GROSS' ||
      partners.some(p => wtTypePlan.get(p.nr) === 'GROSS' && (remainingStock.get(p.nr) ?? 0) > 0);
    const typ: WTTyp = needsGross ? 'GROSS' : 'KLEIN';

    const wt = createWT(nextId(typ), typ, 'B', 0);

    const placedAnchor = addArticleToWT(wt, anchorNr, anchorArt, anchorStk, config, artDataMap);
    if (placedAnchor <= 0) continue;

    remainingStock.set(anchorNr, anchorStk - placedAnchor);

    // Greedily pack partners in affinity DESC order.
    // Limit each partner's contribution to 90% of remaining stock so that popular hub
    // articles retain some stock for step1 co-seeding. Without this cap, hubs consumed
    // as partners across many clusters reach 0 stock before step1 can co-locate them.
    const PARTNER_STOCK_FRACTION = 0.9;
    let partnersPlaced = 0;
    for (const { nr: pNr } of partners) {
      const pStk = remainingStock.get(pNr) ?? 0;
      if (pStk <= 0) continue;
      const pArt = artDataMap.get(pNr);
      if (!pArt) continue;

      const cappedStk = Math.max(1, Math.ceil(pStk * PARTNER_STOCK_FRACTION));
      const placed = addArticleToWT(wt, pNr, pArt, cappedStk, config, artDataMap);
      if (placed > 0) {
        remainingStock.set(pNr, pStk - placed);
        partnersPlaced++;
      }
    }

    if (partnersPlaced > 0) {
      clusterWTs.push(wt);
    } else {
      // No partner fit — rollback anchor and skip this cluster
      remainingStock.set(anchorNr, anchorStk);
    }
  }

  return clusterWTs;
}

// ============================================================
// Step 1: Pack tight — Pure FFD, no cluster pre-grouping
// ============================================================

function step1PackTight(
  processed: ArtikelProcessed[],
  artDataMap: Map<string, ArtikelProcessed>,
  wtTypePlan: Map<string, WTTyp>,
  config: WTConfig,
  nextId: (typ: WTTyp) => string,
  partnerIndex?: Map<string, Array<{ partner: string; affinity: number }>>,
  preStock?: Map<string, number>,
  preWTs?: WT[],
): { allWTs: WT[]; remainingStock: Map<string, number> } {
  const remainingStock: Map<string, number> = preStock ?? new Map<string, number>();
  if (!preStock) {
    for (const art of processed) {
      if (art.bestand > 0) remainingStock.set(String(art.artikelnummer), art.bestand);
    }
  }

  const segOf = (art: ArtikelProcessed): number => {
    const artNr = String(art.artikelnummer);
    const mode = articleFitsMode(art) === 'BOTH' ? 'B' : 'A';
    const zw = getZoneWidth(mode);
    const typ = wtTypePlan.get(artNr) ?? 'KLEIN';
    const stk = remainingStock.get(artNr) ?? 0;
    const cap = Math.max(1, zoneCapacity(art, zw, getWTDepth(typ), config.griff_puffer_mm));
    return requiredDepthForStock(
      art.hoehe_mm, art.breite_mm, art.laenge_mm, art.gewicht_kg,
      Math.min(stk, cap), zw, config.gewicht_hard_kg,
    ) ?? 800;
  };

  // Build reverse index for bidirectional partner lookup
  const reverseIndex = new Map<string, Array<{ seed: string; affinity: number }>>();
  if (partnerIndex) {
    for (const [seed, partners] of partnerIndex.entries()) {
      for (const { partner, affinity } of partners) {
        if (!reverseIndex.has(partner)) reverseIndex.set(partner, []);
        reverseIndex.get(partner)!.push({ seed, affinity });
      }
    }
  }

  // Affinity-interleaved ordering: sort globally by segment DESC, then for each article
  // insert its top affinity partners immediately after it in the queue. This ensures
  // that when partner B is processed, A's fresh WT still has free zones → co-location.
  const sortedBySegment = processed
    .filter(a => a.bestand > 0)
    .sort((a, b) => segOf(b) - segOf(a));

  const articles: ArtikelProcessed[] = [];
  const queued = new Set<string>();

  const getDirectPartners = (artNr: string): Array<{ nr: string; affinity: number }> => {
    const seen = new Set<string>();
    const result: Array<{ nr: string; affinity: number }> = [];
    for (const { partner, affinity } of partnerIndex?.get(artNr) ?? []) {
      if (!seen.has(partner)) { seen.add(partner); result.push({ nr: partner, affinity }); }
    }
    for (const { seed, affinity } of reverseIndex.get(artNr) ?? []) {
      if (!seen.has(seed)) { seen.add(seed); result.push({ nr: seed, affinity }); }
    }
    return result.sort((a, b) => b.affinity - a.affinity);
  };

  for (const art of sortedBySegment) {
    const artNr = String(art.artikelnummer);
    if (queued.has(artNr)) continue;
    queued.add(artNr);
    articles.push(art);

    // Immediately queue direct affinity partners so they share the fresh WT
    for (const { nr } of getDirectPartners(artNr)) {
      if (queued.has(nr)) continue;
      const pArt = artDataMap.get(nr);
      if (pArt && pArt.bestand > 0) {
        queued.add(nr);
        articles.push(pArt);
      }
    }
  }

  // Singletons not yet queued (no affinity partners, sorted by segment)
  for (const art of sortedBySegment) {
    const artNr = String(art.artikelnummer);
    if (!queued.has(artNr)) {
      articles.push(art);
      queued.add(artNr);
    }
  }

  const allWTs: WT[] = preWTs ? [...preWTs] : [];

  // Helper: seed top affinity partners onto a freshly created WT.
  // Called right after the anchor article is placed on the new WT.
  // Each partner can be co-seeded on multiple WTs (once per anchor) so that
  // hub articles with many partners accumulate co-locations across all partners.
  const coSeedPartners = (anchorNr: string, wt: WT): void => {
    for (const { nr: pNr } of getDirectPartners(anchorNr)) {
      const pStk = remainingStock.get(pNr) ?? 0;
      if (pStk <= 0) continue;
      const pArt = artDataMap.get(pNr);
      if (!pArt) continue;
      const pPlaced = addArticleToWT(wt, pNr, pArt, pStk, config, artDataMap);
      if (pPlaced > 0) {
        remainingStock.set(pNr, pStk - pPlaced);
      }
    }
  };

  for (const art of articles) {
    const artNr = String(art.artikelnummer);
    let stk = remainingStock.get(artNr) ?? 0;
    if (stk <= 0) continue;

    // Build the set of this article's affinity partners (for WT priority)
    const affPartners = new Set<string>();
    if (partnerIndex) {
      for (const { partner } of partnerIndex.get(artNr) ?? []) affPartners.add(partner);
      for (const { seed } of reverseIndex.get(artNr) ?? []) affPartners.add(seed);
    }

    while (stk > 0) {
      let placed = 0;

      // Try existing WTs: prefer WTs that already contain an affinity partner
      const partnerWTs: WT[] = [];
      const otherWTs: WT[] = [];
      for (const wt of allWTs) {
        if (affPartners.size > 0 && wt.positionen.some(p => affPartners.has(p.artikelnummer))) {
          partnerWTs.push(wt);
        } else {
          otherWTs.push(wt);
        }
      }
      for (const wt of [...partnerWTs, ...otherWTs]) {
        const toPlace = addArticleToWT(wt, artNr, art, stk, config, artDataMap);
        if (toPlace > 0) {
          stk -= toPlace;
          remainingStock.set(artNr, stk);
          placed = toPlace;
          break;
        }
      }
      if (placed > 0) continue;

      // Create new WT
      const mode: 'A' | 'B' = articleFitsMode(art) === 'BOTH' ? 'B' : 'A';
      const typ = wtTypePlan.get(artNr) ?? 'KLEIN';
      const wt = createWT(nextId(typ), typ, mode, 0);
      const toPlace = addArticleToWT(wt, artNr, art, stk, config, artDataMap);

      if (toPlace > 0) {
        stk -= toPlace;
        remainingStock.set(artNr, stk);
        allWTs.push(wt);
        coSeedPartners(artNr, wt);
      } else if (mode === 'B') {
        const wtA = createWT(nextId(typ), typ, 'A', 0);
        const toPlaceA = addArticleToWT(wtA, artNr, art, stk, config, artDataMap);
        if (toPlaceA > 0) {
          stk -= toPlaceA;
          remainingStock.set(artNr, stk);
          allWTs.push(wtA);
          coSeedPartners(artNr, wtA);
        } else break;
      } else break;
    }
  }

  return { allWTs, remainingStock };
}

// ============================================================
// Step 2: Fill gaps with affinity partners (opportunistic co-location)
// ============================================================

/**
 * Partial move: place as much of srcPos.stueckzahl as fits in tgtWT.
 * On success (placed > 0): reduces srcPos stueckzahl, cleans up empty rows on srcWT.
 */
function tryPartialMoveToWT(
  srcWT: WT, srcPos: WTPosition, tgtWT: WT,
  config: WTConfig, artDataMap: Map<string, ArtikelProcessed>,
): boolean {
  const artNr = srcPos.artikelnummer;
  if (tgtWT.positionen.some(p => p.artikelnummer === artNr)) return false;
  const art = artDataMap.get(artNr);
  if (!art) return false;

  const placed = addArticleToWT(tgtWT, artNr, art, srcPos.stueckzahl, config, artDataMap);
  if (placed <= 0) return false;

  srcPos.stueckzahl -= placed;
  if (srcPos.stueckzahl <= 0) {
    const rowIdx = srcPos.row_index;
    srcWT.positionen.splice(srcWT.positionen.indexOf(srcPos), 1);
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
  }
  updateWTMetrics(srcWT, config);
  return true;
}

function step2FillGaps(
  allWTs: WT[],
  artDataMap: Map<string, ArtikelProcessed>,
  partnerIndex: Map<string, Array<{ partner: string; affinity: number }>>,
  config: WTConfig,
): void {
  // Bidirectional affinity lookup
  const reverseIndex = new Map<string, Array<{ seed: string; affinity: number }>>();
  for (const [seed, partners] of partnerIndex.entries()) {
    for (const { partner, affinity } of partners) {
      if (!reverseIndex.has(partner)) reverseIndex.set(partner, []);
      reverseIndex.get(partner)!.push({ seed, affinity });
    }
  }

  const removedIds = new Set<string>();

  const getCandidates = (artNrsOnWT: Set<string>): Array<[string, number]> => {
    const candMap = new Map<string, number>();
    for (const artNr of artNrsOnWT) {
      for (const { partner, affinity } of partnerIndex.get(artNr) ?? []) {
        if (!artNrsOnWT.has(partner))
          candMap.set(partner, Math.max(candMap.get(partner) ?? 0, affinity));
      }
      for (const { seed, affinity } of reverseIndex.get(artNr) ?? []) {
        if (!artNrsOnWT.has(seed))
          candMap.set(seed, Math.max(candMap.get(seed) ?? 0, affinity));
      }
    }
    return [...candMap.entries()].sort((a, b) => b[1] - a[1]);
  };

  // Find the best source WT for a partner.
  // Priority: mono-WT first (→ source empties, fewer WTs); then smallest WT
  // (fewer articles = less stock per zone = easier partial-move into constrained target).
  const findSourceWT = (partnerNr: string, exclude: WT): WT | undefined => {
    let best: WT | undefined;
    let bestSize = Infinity;
    for (const w of allWTs) {
      if (removedIds.has(w.id) || w === exclude) continue;
      if (!w.positionen.some(p => p.artikelnummer === partnerNr)) continue;
      if (w.positionen.length === 1) return w; // mono-WT: best possible
      if (w.positionen.length < bestSize) { best = w; bestSize = w.positionen.length; }
    }
    return best;
  };

  const hasFreeCapacity = (wt: WT): boolean => {
    const wtDepth = getWTDepth(wt.typ);
    const usedDepth = wt.zone_depths_mm.reduce((s, d) => s + d, 0);
    const maxR = getMaxRows(wt.typ, wt.mode);
    if (usedDepth + 100 <= wtDepth && wt.zone_depths_mm.length < maxR) return true;
    if (wt.mode === 'B') {
      return wt.zone_depths_mm.some(
        (_, rowIdx) => wt.positionen.filter(p => p.row_index === rowIdx).length < 2,
      );
    }
    return false;
  };

  // Sort WTs: primary = free depth DESC (most room = best targets for co-location),
  // secondary = unique arts DESC (more articles = more affinity candidates to pull in).
  const freeDepth = (wt: WT) => getWTDepth(wt.typ) - wt.zone_depths_mm.reduce((s, d) => s + d, 0);
  const uniqueArts = (wt: WT) => new Set(wt.positionen.map(p => p.artikelnummer)).size;
  const sortedWTs = [...allWTs].sort((a, b) => {
    const artDiff = uniqueArts(b) - uniqueArts(a);
    if (artDiff !== 0) return artDiff;
    return freeDepth(b) - freeDepth(a);
  });

  for (const wt of sortedWTs) {
    if (removedIds.has(wt.id) || wt.positionen.length === 0) continue;

    // Keep filling free zones on this WT until nothing more fits
    let anyFilled = true;
    while (anyFilled) {
      anyFilled = false;
      if (!hasFreeCapacity(wt)) break;

      const artNrsOnWT = new Set(wt.positionen.map(p => p.artikelnummer));
      const candidates = getCandidates(artNrsOnWT);

      for (const [partnerNr] of candidates) {
        const srcWT = findSourceWT(partnerNr, wt);
        if (!srcWT) continue;

        const srcPos = srcWT.positionen.find(p => p.artikelnummer === partnerNr);
        if (!srcPos) continue;
        if (tryPartialMoveToWT(srcWT, srcPos, wt, config, artDataMap)) {
          if (srcWT.positionen.length === 0) removedIds.add(srcWT.id);
          anyFilled = true;
          break;
        }
      }
    }
  }

  // Remove emptied WTs
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

  // Step 0: Pair-pack — guarantee co-location for top affinity pairs
  const remainingStock = new Map<string, number>();
  for (const art of processed) {
    if (art.bestand > 0) remainingStock.set(String(art.artikelnummer), art.bestand);
  }
  const pairedWTs = step0ClusterPack(
    artDataMap, affinityResult.partnerIndex, wtTypePlan, config, nextId, remainingStock,
  );

  // Step 1: Pack tight — affinity-interleaved FFD with pre-paired WTs as starting set
  const { allWTs } = step1PackTight(
    processed, artDataMap, wtTypePlan, config, nextId, affinityResult.partnerIndex,
    remainingStock, pairedWTs,
  );

  // Step 2: Fill gaps with affinity partners — run 3 passes so that each round's
  // newly placed partners open fresh opportunities for the next round.
  for (let pass = 0; pass < 3; pass++) {
    step2FillGaps(allWTs, artDataMap, affinityResult.partnerIndex, config);
  }

  // Step 3: Weight balancing
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

  // Step 4: C1 Safety Net — guarantee all stock is placed
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

      const fbWT = createWT(nextId(fbTyp), fbTyp, 'A', 0);
      fbWT.zone_depths_mm = [fbDepth];
      fbWT.positionen.push(makePosition(artNr, art, toPlace, 0, 0, 0));
      updateWTMetrics(fbWT, config);
      finalWTs.push(fbWT);
      deficit -= toPlace;
    }
  }

  return finalWTs;
}
