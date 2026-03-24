import type { ArtikelProcessed, WTConfig, WT, WTTyp, WTPosition } from '../types';
import type { ClusterResult } from './phase2';

// WT physical dimensions (mm)
const WT_WIDTH = 500;
const WT_DEPTH_KLEIN = 500;
const WT_DEPTH_GROSS = 800;
const MAX_HEIGHT_MM = 320;

// Area constants for floor-cost calculations (phase5)
export const KLEIN_AREA = WT_WIDTH * WT_DEPTH_KLEIN;   // 250,000 mm²
export const GROSS_AREA = WT_WIDTH * WT_DEPTH_GROSS;   // 400,000 mm²
export const KLEIN_FLOOR_M2 = 0.25;
export const GROSS_FLOOR_M2 = 0.40;
// Note: AREA_USABLE_FRACTION removed (no longer used)

// ============================================================
// 3D Orientation Optimization
// ============================================================

/**
 * Result of bestArticleOrientation: the optimal axis/footprint combo
 * for placing this article on a WT of given dimensions.
 */
export interface ArticleOrientation {
  vert_mm: number;          // chosen vertical dimension
  h1_mm: number;            // footprint dim along WT width
  h2_mm: number;            // footprint dim along WT depth
  max_stapelhoehe: number;  // floor(MAX_HEIGHT_MM / vert_mm)
  grundflaeche_mm2: number; // h1_mm × h2_mm
  items: number;            // max items per WT (geometry × weight)
}

/**
 * Tries all 6 orientations (3 axis choices × 2 footprint rotations).
 * Returns the orientation that maximises items per WT, or null if none fit.
 */
export function bestArticleOrientation(
  h_mm: number,
  b_mm: number,
  l_mm: number,
  w_kg: number,
  wtWidth: number,
  wtDepth: number,
  maxWeightKg: number,
  minSegMm = 0,
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
          vert_mm: vert,
          h1_mm: fp1,
          h2_mm: fp2,
          max_stapelhoehe: stapel,
          grundflaeche_mm2: fp1 * fp2,
          items,
        };
      }
    }
  }
  return best;
}

// ============================================================
// Exported helpers (used by phase5.ts)
// ============================================================

/**
 * Grid-based capacity using best orientation across all 6 possibilities.
 */
export function itemsPerWT(
  artikel: ArtikelProcessed,
  wtWidth: number,
  wtDepth: number,
  maxWeightKg: number,
  minSegMm = 0,
): number {
  const orient = bestArticleOrientation(
    artikel.hoehe_mm, artikel.breite_mm, artikel.laenge_mm,
    artikel.gewicht_kg, wtWidth, wtDepth, maxWeightKg, minSegMm,
  );
  return orient?.items ?? 0;
}

/** Backward-compatible alias used by phase5.ts */
export function itemsPerWT2D(artikel: ArtikelProcessed, wtArea: number, maxWeightKg: number, minSegMm = 0): number {
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

/**
 * Pre-plan WT types using floor-area cost minimisation.
 * Uses bestArticleOrientation for KLEIN and GROSS separately.
 */
export function planWTTypes(
  processed: ArtikelProcessed[],
  config: WTConfig,
): { plan: Map<string, WTTyp>; preferences: WTTypePreference[]; grossBudgetUsed: number } {
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

    // Skip if article cannot fit on any WT type
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
    const areaSaving = areaCostKlein - areaCostGross;

    preferences.push({
      artikelnummer: String(art.artikelnummer),
      n_klein: nKlein === 999_999 ? 0 : nKlein,
      n_gross: nGross,
      area_cost_klein: fitsKlein ? areaCostKlein : 0,
      area_cost_gross: areaCostGross,
      best_type: bestType,
      must_gross: mustGross,
      area_saving: areaSaving,
    });
  }

  const plan = new Map<string, WTTyp>();
  let grossBudget = config.anzahl_gross;
  let grossBudgetUsed = 0;

  // Must-GROSS first (physically don't fit KLEIN)
  for (const p of preferences.filter(p => p.must_gross)) {
    plan.set(p.artikelnummer, 'GROSS');
    grossBudget -= p.n_gross;
    grossBudgetUsed += p.n_gross;
  }

  // Floor-cost optimal: articles where GROSS saves floor space, sorted by saving desc
  const candidates = preferences
    .filter(p => !p.must_gross && p.best_type === 'GROSS')
    .sort((a, b) => b.area_saving - a.area_saving);

  for (const p of candidates) {
    if (grossBudget >= p.n_gross) {
      plan.set(p.artikelnummer, 'GROSS');
      grossBudget -= p.n_gross;
      grossBudgetUsed += p.n_gross;
    } else {
      plan.set(p.artikelnummer, 'KLEIN');
    }
  }

  for (const p of preferences) {
    if (!plan.has(p.artikelnummer)) {
      plan.set(p.artikelnummer, 'KLEIN');
    }
  }

  return { plan, preferences, grossBudgetUsed };
}

// ============================================================
// A-article scatter
// ============================================================

function scatterAArtikel(processed: ArtikelProcessed[], config: WTConfig): ArtikelProcessed[] {
  const n = config.a_artikel_scatter_n;
  if (n <= 1) return processed;
  const result: ArtikelProcessed[] = [];
  for (const art of processed) {
    if (art.abc_klasse === 'A' && art.bestand > n) {
      const chunkSize = Math.ceil(art.bestand / n);
      let remaining = art.bestand;
      for (let i = 0; i < n && remaining > 0; i++) {
        const chunk = Math.min(chunkSize, remaining);
        result.push({ ...art, bestand: chunk, platzbedarf_mm2: chunk * art.grundflaeche_mm2 });
        remaining -= chunk;
      }
    } else {
      result.push(art);
    }
  }
  return result;
}

// ============================================================
// Uniform grid model helpers
// ============================================================

/**
 * Find the best grid layout for N uniform zones on a WT.
 * Maximises zone area (= minimises wasted grid slots).
 * Returns null if no valid layout exists (all zones would be < minZoneMm).
 */
function bestGrid(
  n: number,
  wtW: number,
  wtD: number,
  dividerMm: number,
  minZoneMm: number,
): { cols: number; rows: number; zoneW: number; zoneD: number } | null {
  let best: { cols: number; rows: number; zoneW: number; zoneD: number } | null = null;
  let bestArea = -1;

  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const zoneW = Math.floor((wtW - (cols - 1) * dividerMm) / cols);
    const zoneD = Math.floor((wtD - (rows - 1) * dividerMm) / rows);
    if (zoneW < minZoneMm || zoneD < minZoneMm) continue;
    const area = zoneW * zoneD;
    if (area > bestArea || (area === bestArea && best &&
        Math.abs(zoneW - zoneD) < Math.abs(best.zoneW - best.zoneD))) {
      bestArea = area;
      best = { cols, rows, zoneW, zoneD };
    }
  }
  return best;
}

/**
 * Pure geometry: how many items of an article fit in one zone.
 * No weight check — that's done at WT level.
 */
function itemsPerZone(
  hoehe_mm: number,
  breite_mm: number,
  laenge_mm: number,
  zoneW: number,
  zoneD: number,
  griffPufferMm = 0,
): number {
  let best = 0;
  const dims: [number, number, number] = [hoehe_mm, breite_mm, laenge_mm];
  for (let i = 0; i < 3; i++) {
    const vert = dims[i];
    if (vert <= 0 || vert > MAX_HEIGHT_MM) continue;
    const stack = Math.floor(MAX_HEIGHT_MM / vert);
    const fp = dims.filter((_, j) => j !== i) as [number, number];
    for (const [fp1, fp2] of [[fp[0], fp[1]], [fp[1], fp[0]]] as [number, number][]) {
      if (fp1 <= 0 || fp2 <= 0 || fp1 > zoneW || fp2 > zoneD) continue;
      const cols = Math.floor(zoneW / fp1);
      const rows = Math.floor(zoneD / fp2);
      // At least one axis must have >= griffPufferMm free space after packing all stacks
      if (griffPufferMm > 0) {
        const freiW = zoneW - cols * fp1;
        const freiD = zoneD - rows * fp2;
        if (freiW < griffPufferMm && freiD < griffPufferMm) continue;
      }
      best = Math.max(best, cols * rows * stack);
    }
  }
  return best;
}

// ============================================================
// WT lifecycle helpers
// ============================================================

function getWTDepth(typ: WTTyp): number {
  return typ === 'KLEIN' ? WT_DEPTH_KLEIN : WT_DEPTH_GROSS;
}

function getWTArea(typ: WTTyp): number {
  return typ === 'KLEIN' ? KLEIN_AREA : GROSS_AREA;
}

function createWT(id: string, typ: WTTyp, clusterId: number): WT {
  return {
    id, typ, positionen: [], cluster_id: clusterId,
    gesamtgewicht_kg: 0,
    flaeche_brutto_mm2: getWTArea(typ),
    flaeche_netto_pct: 0,
    anzahl_teiler: 0,
    gewicht_status: 'ok',
    grid_cols: 0, grid_rows: 0, zone_count: 0, zone_w_mm: 0, zone_d_mm: 0,
  };
}

function setWTGrid(wt: WT, cols: number, rows: number, zoneW: number, zoneD: number): void {
  wt.grid_cols = cols;
  wt.grid_rows = rows;
  wt.zone_count = cols * rows;
  wt.zone_w_mm = zoneW;
  wt.zone_d_mm = zoneD;
  wt.anzahl_teiler = (cols - 1) + (rows - 1);
}

function updateWTMetrics(wt: WT, config: WTConfig): void {
  wt.gesamtgewicht_kg = Math.round(
    wt.positionen.reduce((s, p) => s + p.gewicht_kg * p.stueckzahl, 0) * 100,
  ) / 100;
  wt.flaeche_netto_pct = wt.zone_count > 0
    ? Math.round((wt.positionen.length / wt.zone_count) * 10000) / 100
    : 0;
  wt.gewicht_status = wt.gesamtgewicht_kg > config.gewicht_hard_kg ? 'hard_fail'
    : wt.gesamtgewicht_kg > config.gewicht_soft_kg ? 'soft_warn'
    : 'ok';
}

// ============================================================
// Zone placement helpers
// ============================================================

/**
 * Try to add an article to an existing WT (one zone per article per WT rule).
 * Checks zone feasibility and weight. Modifies WT in place if successful.
 * Returns number of items placed (0 = couldn't add).
 */
function tryAddArticleToWT(
  wt: WT,
  artNr: string,
  art: Pick<ArtikelProcessed, 'hoehe_mm' | 'breite_mm' | 'laenge_mm' | 'grundflaeche_mm2' | 'gewicht_kg' | 'abc_klasse' | 'bezeichnung' | 'max_stapelhoehe'>,
  remaining: number,
  wtD: number,
  config: WTConfig,
): number {
  if (wt.positionen.some(p => p.artikelnummer === artNr)) return 0;

  const newZoneCount = wt.positionen.length + 1;
  const grid = bestGrid(newZoneCount, WT_WIDTH, wtD, config.teiler_breite_mm, config.min_segment_mm);
  if (!grid) return 0;

  // Check all existing positions still fit in the smaller zones
  for (const pos of wt.positionen) {
    if (itemsPerZone(pos.hoehe_mm, pos.breite_mm, pos.laenge_mm, grid.zoneW, grid.zoneD, config.griff_puffer_mm) < pos.stueckzahl) return 0;
  }

  const cap = itemsPerZone(art.hoehe_mm, art.breite_mm, art.laenge_mm, grid.zoneW, grid.zoneD, config.griff_puffer_mm);
  if (cap <= 0) return 0;

  let toPlace = Math.min(remaining, cap);
  while (toPlace > 0 && wt.gesamtgewicht_kg + toPlace * art.gewicht_kg > config.gewicht_hard_kg) {
    toPlace--;
  }
  if (toPlace <= 0) return 0;

  const zoneIdx = wt.positionen.length;
  wt.positionen.push({
    artikelnummer: artNr,
    bezeichnung: art.bezeichnung,
    stueckzahl: toPlace,
    grundflaeche_mm2: art.grundflaeche_mm2,
    gewicht_kg: art.gewicht_kg,
    abc_klasse: art.abc_klasse,
    hoehe_mm: art.hoehe_mm,
    breite_mm: art.breite_mm,
    laenge_mm: art.laenge_mm,
    max_stapelhoehe: art.max_stapelhoehe,
    zone_index: zoneIdx,
  });
  setWTGrid(wt, grid.cols, grid.rows, grid.zoneW, grid.zoneD);
  updateWTMetrics(wt, config);
  return toPlace;
}

/**
 * Try to fully move a WTPosition from srcWT to tgtWT.
 * Checks that ALL items can be moved (no partial moves).
 * Returns true if successful.
 */
function tryMovePositionToWT(srcWT: WT, pos: WTPosition, tgtWT: WT, config: WTConfig): boolean {
  const artNr = pos.artikelnummer;
  if (tgtWT.positionen.some(p => p.artikelnummer === artNr)) return false;

  const tgtWtD = getWTDepth(tgtWT.typ);
  const newZoneCount = tgtWT.positionen.length + 1;
  const grid = bestGrid(newZoneCount, WT_WIDTH, tgtWtD, config.teiler_breite_mm, config.min_segment_mm);
  if (!grid) return false;

  for (const tgtPos of tgtWT.positionen) {
    if (itemsPerZone(tgtPos.hoehe_mm, tgtPos.breite_mm, tgtPos.laenge_mm, grid.zoneW, grid.zoneD, config.griff_puffer_mm) < tgtPos.stueckzahl) return false;
  }
  if (itemsPerZone(pos.hoehe_mm, pos.breite_mm, pos.laenge_mm, grid.zoneW, grid.zoneD, config.griff_puffer_mm) < pos.stueckzahl) return false;
  if (tgtWT.gesamtgewicht_kg + pos.gewicht_kg * pos.stueckzahl > config.gewicht_hard_kg) return false;

  // Commit: add to target
  tgtWT.positionen.push({ ...pos, zone_index: tgtWT.positionen.length });
  setWTGrid(tgtWT, grid.cols, grid.rows, grid.zoneW, grid.zoneD);
  updateWTMetrics(tgtWT, config);

  // Remove from source and reassign zone indices
  const idx = srcWT.positionen.indexOf(pos);
  srcWT.positionen.splice(idx, 1);
  srcWT.positionen.forEach((p, i) => { p.zone_index = i; });

  if (srcWT.positionen.length > 0) {
    const srcWtD = getWTDepth(srcWT.typ);
    const srcGrid = bestGrid(srcWT.positionen.length, WT_WIDTH, srcWtD, config.teiler_breite_mm, config.min_segment_mm);
    if (srcGrid) setWTGrid(srcWT, srcGrid.cols, srcGrid.rows, srcGrid.zoneW, srcGrid.zoneD);
  } else {
    srcWT.grid_cols = 0; srcWT.grid_rows = 0; srcWT.zone_count = 0;
    srcWT.zone_w_mm = 0; srcWT.zone_d_mm = 0; srcWT.anzahl_teiler = 0;
  }
  updateWTMetrics(srcWT, config);
  return true;
}

// ============================================================
// Main Phase 3 entry point
// ============================================================

export function processPhase3(
  processed: ArtikelProcessed[],
  _clusters: ClusterResult,
  config: WTConfig,
): WT[] {
  const { plan: wtTypePlan } = planWTTypes(processed, config);
  const scattered = scatterAArtikel(processed, config);

  const allWTs: WT[] = [];
  let kleinCounter = 0;
  let grossCounter = 0;

  // Group by cluster
  const clusterGroups = new Map<number, ArtikelProcessed[]>();
  for (const art of scattered) {
    const cid = art.cluster_id ?? 0;
    if (!clusterGroups.has(cid)) clusterGroups.set(cid, []);
    clusterGroups.get(cid)!.push(art);
  }

  for (const [clusterId, articles] of clusterGroups) {
    // FFD: pre-compute KLEIN-oriented footprint for sort key
    const orientedFootprint = new Map<string, number>();
    for (const art of articles) {
      const orient = bestArticleOrientation(
        art.hoehe_mm, art.breite_mm, art.laenge_mm,
        art.gewicht_kg, WT_WIDTH, WT_DEPTH_KLEIN,
        config.gewicht_hard_kg, config.min_segment_mm,
      ) ?? bestArticleOrientation(
        art.hoehe_mm, art.breite_mm, art.laenge_mm,
        art.gewicht_kg, WT_WIDTH, WT_DEPTH_GROSS,
        config.gewicht_hard_kg, config.min_segment_mm,
      );
      orientedFootprint.set(String(art.artikelnummer), orient?.grundflaeche_mm2 ?? art.grundflaeche_mm2);
    }
    const sorted = [...articles].sort((a, b) =>
      (orientedFootprint.get(String(b.artikelnummer)) ?? b.grundflaeche_mm2) -
      (orientedFootprint.get(String(a.artikelnummer)) ?? a.grundflaeche_mm2),
    );

    const clusterWTs: WT[] = [];

    for (const art of sorted) {
      if (art.grundflaeche_mm2 <= 0) continue;
      const artNr = String(art.artikelnummer);
      let remaining = art.bestand;

      while (remaining > 0) {
        let placed = 0;

        // Phase A: try existing cluster WTs
        for (const wt of clusterWTs) {
          const wtD = getWTDepth(wt.typ);
          const p = tryAddArticleToWT(wt, artNr, art, remaining, wtD, config);
          if (p > 0) { remaining -= p; placed = p; break; }
        }

        if (placed > 0) continue;

        // Phase B: create new WT
        let newTyp: WTTyp = wtTypePlan.get(artNr) ?? 'KLEIN';
        if (newTyp === 'KLEIN' && kleinCounter >= config.anzahl_klein) newTyp = 'GROSS';
        if (newTyp === 'GROSS' && grossCounter >= config.anzahl_gross) newTyp = 'KLEIN';

        const typesToTry: WTTyp[] = [newTyp, newTyp === 'KLEIN' ? 'GROSS' : 'KLEIN'];
        let created = false;

        for (const tryTyp of typesToTry) {
          const tryWtD = getWTDepth(tryTyp);
          const grid = bestGrid(1, WT_WIDTH, tryWtD, config.teiler_breite_mm, config.min_segment_mm);
          if (!grid) continue;
          const cap = itemsPerZone(art.hoehe_mm, art.breite_mm, art.laenge_mm, grid.zoneW, grid.zoneD, config.griff_puffer_mm);
          if (cap <= 0) continue;
          let toPlace = Math.min(remaining, cap);
          while (toPlace > 0 && toPlace * art.gewicht_kg > config.gewicht_hard_kg) toPlace--;
          if (toPlace <= 0) continue;

          const id = tryTyp === 'KLEIN'
            ? `K-${String(++kleinCounter).padStart(4, '0')}`
            : `G-${String(++grossCounter).padStart(4, '0')}`;

          const newWT = createWT(id, tryTyp, clusterId);
          newWT.positionen.push({
            artikelnummer: artNr,
            bezeichnung: art.bezeichnung,
            stueckzahl: toPlace,
            grundflaeche_mm2: art.grundflaeche_mm2,
            gewicht_kg: art.gewicht_kg,
            abc_klasse: art.abc_klasse,
            hoehe_mm: art.hoehe_mm,
            breite_mm: art.breite_mm,
            laenge_mm: art.laenge_mm,
            max_stapelhoehe: art.max_stapelhoehe,
            zone_index: 0,
          });
          setWTGrid(newWT, grid.cols, grid.rows, grid.zoneW, grid.zoneD);
          updateWTMetrics(newWT, config);
          clusterWTs.push(newWT);
          remaining -= toPlace;
          created = true;
          break;
        }

        if (!created) break; // article physically can't be placed
      }
    }

    allWTs.push(...clusterWTs);
  }

  // Weight balancing: move lightest position from overweight WTs
  for (const srcWT of allWTs) {
    if (srcWT.gesamtgewicht_kg <= config.gewicht_soft_kg) continue;
    if (srcWT.positionen.length <= 1) continue;
    const lightest = [...srcWT.positionen]
      .sort((a, b) => a.gewicht_kg * a.stueckzahl - b.gewicht_kg * b.stueckzahl)[0];
    for (const tgtWT of allWTs) {
      if (tgtWT === srcWT || tgtWT.cluster_id !== srcWT.cluster_id) continue;
      if (tryMovePositionToWT(srcWT, lightest, tgtWT, config)) break;
    }
  }

  // Consolidation: merge underfilled WTs (<30% zone fill, not containing A-articles)
  const candidates = allWTs
    .filter(wt =>
      wt.zone_count > 0 &&
      wt.positionen.length / wt.zone_count < 0.30 &&
      wt.gesamtgewicht_kg < config.gewicht_soft_kg &&
      !wt.positionen.some(p => p.abc_klasse === 'A'),
    )
    .sort((a, b) => (a.positionen.length / a.zone_count) - (b.positionen.length / b.zone_count));

  const candidateIds = new Set(candidates.map(wt => wt.id));

  for (const srcWT of candidates) {
    if (srcWT.positionen.length === 0) continue;
    let allMoved = true;
    for (const pos of [...srcWT.positionen]) {
      let moved = false;
      for (const tgtWT of allWTs) {
        if (tgtWT === srcWT || candidateIds.has(tgtWT.id)) continue;
        if (tgtWT.cluster_id !== srcWT.cluster_id) continue;
        if (tryMovePositionToWT(srcWT, pos, tgtWT, config)) { moved = true; break; }
      }
      if (!moved) allMoved = false;
    }
    if (!allMoved) {
      // Revert: srcWT was partially emptied, put it back on the candidates list by not clearing
      // Actually tryMovePositionToWT already committed partial moves — this is fine;
      // the remaining positions stay on srcWT
    }
  }

  return allWTs.filter(wt => wt.positionen.length > 0);
}
