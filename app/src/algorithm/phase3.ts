import type { ArtikelProcessed, WTConfig, WT, WTTyp, WTPosition } from '../types';
import type { ClusterResult } from './phase2';

// WT physical dimensions (mm)
const WT_WIDTH = 500;
const WT_DEPTH_KLEIN = 500;
const WT_DEPTH_GROSS = 800;
const DIVIDER_MM = 5; // gap between zones (shelf divider width)
const MAX_HEIGHT_MM = 320; // maximum vertical dimension for any article

// Area constants for floor-cost calculations (phase5)
export const KLEIN_AREA = WT_WIDTH * WT_DEPTH_KLEIN;   // 250,000 mm²
export const GROSS_AREA = WT_WIDTH * WT_DEPTH_GROSS;   // 400,000 mm²
export const KLEIN_FLOOR_M2 = 0.25;
export const GROSS_FLOOR_M2 = 0.40;
export const AREA_USABLE_FRACTION = 0.92; // kept for display metrics (flaeche_netto_mm2)

function getWTDepth(typ: WTTyp): number {
  return typ === 'KLEIN' ? WT_DEPTH_KLEIN : WT_DEPTH_GROSS;
}

function getWTArea(typ: WTTyp): number {
  return typ === 'KLEIN' ? KLEIN_AREA : GROSS_AREA;
}

// ============================================================
// 3D Orientation Optimization (Bug 16)
// ============================================================

/**
 * Result of bestArticleOrientation: the optimal axis/footprint combo
 * for placing this article on a WT of given dimensions.
 */
export interface ArticleOrientation {
  vert_mm: number;         // chosen vertical dimension
  h1_mm: number;           // footprint dim along WT width
  h2_mm: number;           // footprint dim along WT depth
  max_stapelhoehe: number; // floor(MAX_HEIGHT_MM / vert_mm)
  grundflaeche_mm2: number; // h1_mm × h2_mm
  items: number;           // max items per WT (geometry × weight)
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

/**
 * How many more items can be added to an existing zone WITHOUT requiring
 * additional stacks (i.e. without growing the zone's physical shelf footprint).
 * Only items that fit within the already-allocated stack count are allowed.
 */
function maxExpandable(pos: WTPosition): number {
  const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
  const allocatedStacks = Math.ceil(pos.stueckzahl / maxStapel);
  return allocatedStacks * maxStapel - pos.stueckzahl;
}

/**
 * Capacity check for an already-placed position (WTPosition proxy).
 * Used in consolidation and weight balancing where we only have
 * effective dims (stored in breite_mm/laenge_mm/max_stapelhoehe).
 */
function itemsFromPosition(
  pos: WTPosition,
  wtWidth: number,
  wtDepth: number,
  maxWeightKg: number,
): number {
  const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
  const l = pos.laenge_mm ?? 10;
  const b = pos.breite_mm ?? 10;
  // Try both footprint orientations
  const grid = Math.max(
    Math.floor(wtWidth / l) * Math.floor(wtDepth / b),
    Math.floor(wtWidth / b) * Math.floor(wtDepth / l),
  );
  const itemsGeom = grid * maxStapel;
  const itemsWeight = pos.gewicht_kg > 0 ? Math.floor(maxWeightKg / pos.gewicht_kg) : 999_999;
  return Math.min(itemsGeom, itemsWeight);
}

// ============================================================
// Legacy / exported helpers (unchanged API)
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

/**
 * Zone footprint for N items of an article (mm²) — uses original dimensions, for metrics.
 */
export function zoneFootprint(artikel: ArtikelProcessed, stueckzahl: number): number {
  const maxStapel = Math.max(1, artikel.max_stapelhoehe);
  const stacksNeeded = Math.ceil(stueckzahl / maxStapel);
  return stacksNeeded * artikel.laenge_mm * artikel.breite_mm;
}

function zoneFootprintPos(pos: WTPosition): number {
  // Use stored zone dimensions (actual shelf space consumed) when available
  if (pos.zone_w != null && pos.zone_h != null) return pos.zone_w * pos.zone_h;
  // Fallback for positions without stored zone dims
  const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
  const stacksNeeded = Math.ceil(pos.stueckzahl / maxStapel);
  const l = pos.laenge_mm ?? Math.sqrt(pos.grundflaeche_mm2);
  const b = pos.breite_mm ?? Math.sqrt(pos.grundflaeche_mm2);
  return stacksNeeded * l * b;
}

/**
 * Compute zone dimensions for placing stacksNeeded stacks on a WT of given width.
 * Tries both footprint orientations, picks the one with smaller depth.
 */
function zoneLayout(
  artikel: Pick<ArtikelProcessed, 'laenge_mm' | 'breite_mm'>,
  stacksNeeded: number,
  wtWidth: number,
  minSegMm = 0,
): { zoneW: number; zoneH: number } {
  const l = artikel.laenge_mm;
  const b = artikel.breite_mm;
  const n = Math.max(1, stacksNeeded);

  // Orientation 1: l along width, b along depth
  const across1 = l <= wtWidth ? Math.max(1, Math.min(n, Math.floor(wtWidth / l))) : 0;
  const h1 = across1 > 0 ? Math.ceil(n / across1) * b : Infinity;

  // Orientation 2: b along width, l along depth
  const across2 = b <= wtWidth ? Math.max(1, Math.min(n, Math.floor(wtWidth / b))) : 0;
  const h2 = across2 > 0 ? Math.ceil(n / across2) * l : Infinity;

  let zoneW: number, zoneH: number;
  if (across2 > 0 && h2 <= h1) {
    zoneW = across2 * b; zoneH = h2;
  } else if (across1 > 0) {
    zoneW = across1 * l; zoneH = h1;
  } else {
    zoneW = l; zoneH = b; // fallback
  }

  // Enforce minimum segment size (hand-reachability): pad zone if smaller than minimum.
  // The dividers will be set at least minSegMm apart — extra space is clearance.
  if (minSegMm > 0) {
    zoneW = Math.max(zoneW, Math.min(minSegMm, wtWidth));
    zoneH = Math.max(zoneH, minSegMm);
  }
  return { zoneW, zoneH };
}

function createWT(id: string, typ: WTTyp, clusterId: number): WT {
  const area = getWTArea(typ);
  return {
    id, typ, positionen: [], cluster_id: clusterId,
    gesamtgewicht_kg: 0,
    flaeche_brutto_mm2: area,
    flaeche_netto_mm2: area, // shelf model guarantees geometric validity — no fraction needed
    flaeche_netto_pct: 0,
    anzahl_teiler: 0,
    gewicht_status: 'ok',
  };
}

/**
 * Shelf-based layout state for a WT.
 */
interface WTState {
  wt: WT;
  currentShelfUsedWidth: number;
  currentShelfHeight: number;
  completedShelvesDepth: number;
  usedArea: number;
  wtWidth: number;
  wtDepth: number;
}

function updateWTMetrics(wtState: WTState, config: WTConfig): void {
  const wt = wtState.wt;
  const usedArea = wt.positionen.reduce((sum, pos) => sum + zoneFootprintPos(pos), 0);
  wtState.usedArea = usedArea;
  wt.anzahl_teiler = Math.max(0, wt.positionen.length - 1);
  wt.flaeche_netto_pct = wt.flaeche_netto_mm2 > 0
    ? Math.round((usedArea / wt.flaeche_netto_mm2) * 10000) / 100
    : 0;
  wt.gesamtgewicht_kg = Math.round(
    wt.positionen.reduce((s, p) => s + p.gewicht_kg * p.stueckzahl, 0) * 100,
  ) / 100;
  wt.gewicht_status = wt.gesamtgewicht_kg > config.gewicht_hard_kg ? 'hard_fail'
    : wt.gesamtgewicht_kg > config.gewicht_soft_kg ? 'soft_warn'
    : 'ok';
}

function canFitNewZone(state: WTState, zoneW: number, zoneH: number): boolean {
  // Try current shelf (append to right)
  const xOffset = state.currentShelfUsedWidth > 0
    ? state.currentShelfUsedWidth + DIVIDER_MM
    : 0;
  if (xOffset + zoneW <= state.wtWidth) {
    const newShelfH = Math.max(state.currentShelfHeight, zoneH);
    if (state.completedShelvesDepth + newShelfH <= state.wtDepth) return true;
  }
  // Try new shelf below
  const div = state.currentShelfHeight > 0 ? DIVIDER_MM : 0;
  const newShelfY = state.completedShelvesDepth + state.currentShelfHeight + div;
  return newShelfY + zoneH <= state.wtDepth && zoneW <= state.wtWidth;
}

function placeNewZone(state: WTState, zoneW: number, zoneH: number): { x: number; y: number } {
  const xOffset = state.currentShelfUsedWidth > 0
    ? state.currentShelfUsedWidth + DIVIDER_MM
    : 0;
  if (xOffset + zoneW <= state.wtWidth) {
    const newShelfH = Math.max(state.currentShelfHeight, zoneH);
    if (state.completedShelvesDepth + newShelfH <= state.wtDepth) {
      const coords = { x: xOffset, y: state.completedShelvesDepth };
      state.currentShelfUsedWidth = xOffset + zoneW;
      state.currentShelfHeight = newShelfH;
      return coords;
    }
  }
  // Start new shelf
  const div = state.currentShelfHeight > 0 ? DIVIDER_MM : 0;
  const newY = state.completedShelvesDepth + state.currentShelfHeight + div;
  state.completedShelvesDepth = newY;
  state.currentShelfUsedWidth = zoneW;
  state.currentShelfHeight = zoneH;
  return { x: 0, y: newY };
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
// Consolidation of underfilled WTs
// ============================================================

function consolidateUnderfilled(
  allWTStates: WTState[],
  config: WTConfig,
  thresholdPct = 30,
): void {
  const rawArea = (s: WTState) => s.wtWidth * s.wtDepth;

  const candidateIds = new Set(
    allWTStates
      .filter(s => (s.usedArea / rawArea(s)) * 100 < thresholdPct
        && s.wt.gesamtgewicht_kg < config.gewicht_soft_kg
        && !s.wt.positionen.some(p => p.abc_klasse === 'A')) // protect scattered A-articles
      .map(s => s.wt.id),
  );

  const candidates = allWTStates
    .filter(s => candidateIds.has(s.wt.id))
    .sort((a, b) => (a.usedArea / rawArea(a)) - (b.usedArea / rawArea(b)));

  for (const src of candidates) {
    if (src.wt.positionen.length === 0) continue;

    let allMoved = true;

    for (const pos of [...src.wt.positionen]) {
      let moved = false;

      for (const tgt of allWTStates) {
        if (tgt === src || tgt.wt.positionen.length === 0) continue;
        if (candidateIds.has(tgt.wt.id)) continue;
        if (tgt.wt.cluster_id !== src.wt.cluster_id) continue;

        // Weight check
        if (tgt.wt.gesamtgewicht_kg + pos.gewicht_kg * pos.stueckzahl > config.gewicht_hard_kg) continue;

        const existingOnTgt = tgt.wt.positionen.find(p => p.artikelnummer === pos.artikelnummer);

        if (existingOnTgt) {
          // Only merge if pos fits within the zone's already-allocated stacks
          if (maxExpandable(existingOnTgt) < pos.stueckzahl) continue;

          existingOnTgt.stueckzahl += pos.stueckzahl;
        } else {
          // New zone: shelf fit check using effective dims stored in pos
          const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
          const stacks = Math.ceil(pos.stueckzahl / maxStapel);
          const { zoneW, zoneH } = zoneLayout(
            { laenge_mm: pos.laenge_mm ?? 10, breite_mm: pos.breite_mm ?? 10 },
            stacks,
            tgt.wtWidth,
            config.min_segment_mm,
          );
          if (!canFitNewZone(tgt, zoneW, zoneH)) continue;

          const { x: czX, y: czY } = placeNewZone(tgt, zoneW, zoneH);
          tgt.wt.positionen.push({ ...pos, zone_x: czX, zone_y: czY, zone_w: zoneW, zone_h: zoneH });
        }

        updateWTMetrics(tgt, config);
        moved = true;
        break;
      }

      if (!moved) allMoved = false;
    }

    if (allMoved) {
      src.wt.positionen = [];
      updateWTMetrics(src, config);
    }
  }
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
    // Sort by zone footprint descending (First Fit Decreasing)
    const sorted = [...articles].sort((a, b) => b.grundflaeche_mm2 - a.grundflaeche_mm2);

    const clusterWTStates: WTState[] = [];

    for (const artikel of sorted) {
      if (artikel.grundflaeche_mm2 <= 0) continue;

      // Compute best orientation for each WT type up front
      const orientKlein = bestArticleOrientation(
        artikel.hoehe_mm, artikel.breite_mm, artikel.laenge_mm,
        artikel.gewicht_kg, WT_WIDTH, WT_DEPTH_KLEIN, config.gewicht_hard_kg, config.min_segment_mm,
      );
      const orientGross = bestArticleOrientation(
        artikel.hoehe_mm, artikel.breite_mm, artikel.laenge_mm,
        artikel.gewicht_kg, WT_WIDTH, WT_DEPTH_GROSS, config.gewicht_hard_kg, config.min_segment_mm,
      );

      // Skip article entirely if it can't fit on either WT type
      if (!orientKlein && !orientGross) continue;

      const plannedTyp: WTTyp = wtTypePlan.get(String(artikel.artikelnummer)) ?? 'KLEIN';
      let remaining = artikel.bestand;

      while (remaining > 0) {
        let placed = false;

        // Two-pass: prefer soft weight limit, then allow up to hard limit
        for (const weightLimit of [config.gewicht_soft_kg, config.gewicht_hard_kg]) {
          if (placed) break;

          for (const wtState of clusterWTStates) {
            // Pick orientation for this WT's actual type
            const orient = wtState.wt.typ === 'KLEIN' ? orientKlein : orientGross;
            if (!orient) continue;
            const maxPerWT = orient.items;

            const weightBudget = weightLimit - wtState.wt.gesamtgewicht_kg;
            if (weightBudget <= 0) continue;
            const maxByWeight = artikel.gewicht_kg > 0
              ? Math.floor(weightBudget / artikel.gewicht_kg)
              : remaining;
            if (maxByWeight <= 0) continue;

            const existingPos = wtState.wt.positionen.find(
              p => p.artikelnummer === String(artikel.artikelnummer),
            );

            if (existingPos) {
              // Expanding existing zone — only within already-allocated stacks
              // (adding stacks would change the zone's shelf footprint, which is not tracked)
              const maxExpand = maxExpandable(existingPos);
              if (maxExpand <= 0) continue;
              const actualPlace = Math.min(remaining, maxByWeight, maxExpand);
              if (actualPlace <= 0) continue;

              existingPos.stueckzahl += actualPlace;
              updateWTMetrics(wtState, config);
              remaining -= actualPlace;
              placed = true;
              break;
            } else {
              // New zone: shelf fit check with effective orientation dims
              const toPlace = Math.min(remaining, maxByWeight, maxPerWT);
              const stacks = Math.ceil(toPlace / Math.max(1, orient.max_stapelhoehe));
              const { zoneW, zoneH } = zoneLayout(
                { laenge_mm: orient.h1_mm, breite_mm: orient.h2_mm },
                stacks,
                WT_WIDTH,
                config.min_segment_mm,
              );
              if (!canFitNewZone(wtState, zoneW, zoneH)) continue;

              const { x: zoneX1, y: zoneY1 } = placeNewZone(wtState, zoneW, zoneH);
              wtState.wt.positionen.push({
                artikelnummer: String(artikel.artikelnummer),
                bezeichnung: artikel.bezeichnung,
                stueckzahl: toPlace,
                grundflaeche_mm2: orient.grundflaeche_mm2,
                gewicht_kg: artikel.gewicht_kg,
                abc_klasse: artikel.abc_klasse,
                breite_mm: orient.h2_mm,
                laenge_mm: orient.h1_mm,
                max_stapelhoehe: orient.max_stapelhoehe,
                zone_x: zoneX1, zone_y: zoneY1, zone_w: zoneW, zone_h: zoneH,
              });
              updateWTMetrics(wtState, config);
              remaining -= toPlace;
              placed = true;
              break;
            }
          }
        }

        if (!placed) {
          // Create new WT
          let typ: WTTyp = plannedTyp;
          if (typ === 'KLEIN' && kleinCounter >= config.anzahl_klein) typ = 'GROSS';
          if (typ === 'GROSS' && grossCounter >= config.anzahl_gross) typ = 'KLEIN';

          let orient = typ === 'KLEIN' ? orientKlein : orientGross;
          if (!orient) {
            // Planned type doesn't work for this article — try other type
            const alt: WTTyp = typ === 'KLEIN' ? 'GROSS' : 'KLEIN';
            const altOrient = alt === 'KLEIN' ? orientKlein : orientGross;
            if (!altOrient) break;
            typ = alt;
            orient = altOrient;
          }

          const actualPlace = Math.min(remaining, orient.items);
          const stacks = Math.ceil(actualPlace / Math.max(1, orient.max_stapelhoehe));
          const { zoneW, zoneH } = zoneLayout(
            { laenge_mm: orient.h1_mm, breite_mm: orient.h2_mm },
            stacks,
            WT_WIDTH,
            config.min_segment_mm,
          );

          let id: string;
          if (typ === 'KLEIN') {
            kleinCounter++;
            id = `K-${String(kleinCounter).padStart(4, '0')}`;
          } else {
            grossCounter++;
            id = `G-${String(grossCounter).padStart(4, '0')}`;
          }

          const newDepth = getWTDepth(typ);
          const newWT = createWT(id, typ, clusterId);
          const newState: WTState = {
            wt: newWT,
            currentShelfUsedWidth: 0,
            currentShelfHeight: 0,
            completedShelvesDepth: 0,
            usedArea: 0,
            wtWidth: WT_WIDTH,
            wtDepth: newDepth,
          };

          const { x: zoneX2, y: zoneY2 } = placeNewZone(newState, zoneW, zoneH);
          newWT.positionen.push({
            artikelnummer: String(artikel.artikelnummer),
            bezeichnung: artikel.bezeichnung,
            stueckzahl: actualPlace,
            grundflaeche_mm2: orient.grundflaeche_mm2,
            gewicht_kg: artikel.gewicht_kg,
            abc_klasse: artikel.abc_klasse,
            breite_mm: orient.h2_mm,
            laenge_mm: orient.h1_mm,
            max_stapelhoehe: orient.max_stapelhoehe,
            zone_x: zoneX2, zone_y: zoneY2, zone_w: zoneW, zone_h: zoneH,
          });
          updateWTMetrics(newState, config);
          clusterWTStates.push(newState);
          remaining -= actualPlace;
        }
      }
    }

    allWTStates.push(...clusterWTStates);
  }

  // Weight balancing: move lightest position from overweight WTs to same-cluster WTs
  for (const srcState of allWTStates) {
    const wt = srcState.wt;
    if (wt.gesamtgewicht_kg <= config.gewicht_soft_kg) continue;
    if (wt.positionen.length <= 1) continue;

    const sortedPos = [...wt.positionen].sort(
      (a, b) => a.gewicht_kg * a.stueckzahl - b.gewicht_kg * b.stueckzahl,
    );
    const lightest = sortedPos[0];
    const maxStapel = Math.max(1, lightest.max_stapelhoehe ?? 1);
    const stacks = Math.ceil(lightest.stueckzahl / maxStapel);
    const { zoneW, zoneH } = zoneLayout(
      { laenge_mm: lightest.laenge_mm ?? 10, breite_mm: lightest.breite_mm ?? 10 },
      stacks,
      WT_WIDTH,
      config.min_segment_mm,
    );

    const sameCluster = allWTStates.filter(
      s => s.wt.cluster_id === wt.cluster_id && s.wt.id !== wt.id,
    );

    for (const tgtState of sameCluster) {
      const targetWeight = tgtState.wt.gesamtgewicht_kg + lightest.gewicht_kg * lightest.stueckzahl;
      if (targetWeight > config.gewicht_hard_kg) continue;

      const existingOnTarget = tgtState.wt.positionen.find(p => p.artikelnummer === lightest.artikelnummer);

      if (existingOnTarget) {
        // Only merge if lightest fits within the zone's already-allocated stacks
        if (maxExpandable(existingOnTarget) < lightest.stueckzahl) continue;
      } else {
        if (!canFitNewZone(tgtState, zoneW, zoneH)) continue;
      }

      const idx = wt.positionen.indexOf(lightest);
      if (idx >= 0) {
        wt.positionen.splice(idx, 1);
        if (existingOnTarget) {
          existingOnTarget.stueckzahl += lightest.stueckzahl;
        } else {
          const { x: wzX, y: wzY } = placeNewZone(tgtState, zoneW, zoneH);
          lightest.zone_x = wzX;
          lightest.zone_y = wzY;
          lightest.zone_w = zoneW;
          lightest.zone_h = zoneH;
          tgtState.wt.positionen.push(lightest);
        }
        updateWTMetrics(srcState, config);
        updateWTMetrics(tgtState, config);
        break;
      }
    }
  }

  // Post-processing safety net: merge any remaining duplicate positions
  for (const state of allWTStates) {
    const merged: WTPosition[] = [];
    for (const pos of state.wt.positionen) {
      const existing = merged.find(p => p.artikelnummer === pos.artikelnummer);
      if (existing) {
        existing.stueckzahl += pos.stueckzahl;
      } else {
        merged.push({ ...pos });
      }
    }
    state.wt.positionen = merged;
    updateWTMetrics(state, config);
  }

  // Consolidate underfilled WTs (<30% area, <soft weight) across clusters
  consolidateUnderfilled(allWTStates, config, 30);

  return allWTStates
    .filter(s => s.wt.positionen.length > 0)
    .map(s => s.wt);
}
