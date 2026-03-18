import type { ArtikelProcessed, WTConfig, WT, WTTyp, WTPosition } from '../types';
import type { ClusterResult } from './phase2';

// WT physical dimensions (mm)
const WT_WIDTH = 500;
const WT_DEPTH_KLEIN = 500;
const WT_DEPTH_GROSS = 800;
const DIVIDER_MM = 5; // gap between zones (shelf divider width)

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

/**
 * Grid-based capacity: how many items of this article fit on a WT of given dimensions?
 * Tries both article orientations (l×b and b×l), takes the better result.
 * Correct for a single article type filling the entire WT.
 */
export function itemsPerWT(
  artikel: ArtikelProcessed,
  wtWidth: number,
  wtDepth: number,
  maxWeightKg: number,
): number {
  const maxStapel = Math.max(1, artikel.max_stapelhoehe);
  const l = artikel.laenge_mm;
  const b = artikel.breite_mm;
  // Orientation 1: l along width, b along depth
  const grid1 = Math.floor(wtWidth / l) * Math.floor(wtDepth / b);
  // Orientation 2: b along width, l along depth
  const grid2 = Math.floor(wtWidth / b) * Math.floor(wtDepth / l);
  const maxStacksGeom = Math.max(grid1, grid2);
  const itemsGeom = maxStacksGeom * maxStapel;
  const itemsWeight = artikel.gewicht_kg > 0 ? Math.floor(maxWeightKg / artikel.gewicht_kg) : 999999;
  return Math.max(0, Math.min(itemsGeom, itemsWeight));
}

/** Backward-compatible alias used by phase5.ts */
export function itemsPerWT2D(artikel: ArtikelProcessed, wtArea: number, maxWeightKg: number): number {
  const depth = wtArea === KLEIN_AREA ? WT_DEPTH_KLEIN : WT_DEPTH_GROSS;
  return itemsPerWT(artikel, WT_WIDTH, depth, maxWeightKg);
}

/**
 * Zone footprint for N items of an article (mm²) — orientation-independent, for metrics.
 */
export function zoneFootprint(artikel: ArtikelProcessed, stueckzahl: number): number {
  const maxStapel = Math.max(1, artikel.max_stapelhoehe);
  const stacksNeeded = Math.ceil(stueckzahl / maxStapel);
  return stacksNeeded * artikel.laenge_mm * artikel.breite_mm;
}

function zoneFootprintPos(pos: WTPosition): number {
  const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
  const stacksNeeded = Math.ceil(pos.stueckzahl / maxStapel);
  const l = pos.laenge_mm ?? Math.sqrt(pos.grundflaeche_mm2);
  const b = pos.breite_mm ?? Math.sqrt(pos.grundflaeche_mm2);
  return stacksNeeded * l * b;
}

/**
 * Compute zone dimensions for placing stacksNeeded stacks on a WT of given width.
 * Tries both orientations, picks the one with smaller depth (uses less WT depth).
 */
function zoneLayout(
  artikel: Pick<ArtikelProcessed, 'laenge_mm' | 'breite_mm'>,
  stacksNeeded: number,
  wtWidth: number,
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

  if (across2 > 0 && h2 <= h1) {
    return { zoneW: across2 * b, zoneH: h2 };
  }
  if (across1 > 0) {
    return { zoneW: across1 * l, zoneH: h1 };
  }
  // Fallback (shouldn't happen if caller pre-checks capacity)
  return { zoneW: l, zoneH: b };
}

function createWT(id: string, typ: WTTyp, clusterId: number): WT {
  const area = getWTArea(typ);
  return {
    id, typ, positionen: [], cluster_id: clusterId,
    gesamtgewicht_kg: 0,
    flaeche_brutto_mm2: area,
    flaeche_netto_mm2: Math.round(area * AREA_USABLE_FRACTION),
    flaeche_netto_pct: 0,
    anzahl_teiler: 0,
    gewicht_status: 'ok',
  };
}

/**
 * Shelf-based layout state for a WT.
 * Mirrors the visualization layout: zones pack left-to-right per shelf,
 * new shelf starts below when width is exhausted.
 */
interface WTState {
  wt: WT;
  currentShelfUsedWidth: number; // width consumed on the current (last) shelf
  currentShelfHeight: number;    // depth of the current shelf (max zone height)
  completedShelvesDepth: number; // depth consumed by all completed shelves + dividers
  usedArea: number;              // sum of zone footprints mm² (recomputed by updateWTMetrics)
  wtWidth: number;               // 500
  wtDepth: number;               // 500 (KLEIN) or 800 (GROSS)
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

/**
 * Check if a zone (zoneW × zoneH mm) fits on the current shelf or a new shelf below.
 */
function canFitNewZone(state: WTState, zoneW: number, zoneH: number): boolean {
  // Try current shelf (append to right)
  const xOffset = state.currentShelfUsedWidth > 0
    ? state.currentShelfUsedWidth + DIVIDER_MM
    : 0;
  if (xOffset + zoneW <= state.wtWidth) {
    // Shelf height may grow; check it still fits in WT depth
    const newShelfH = Math.max(state.currentShelfHeight, zoneH);
    if (state.completedShelvesDepth + newShelfH <= state.wtDepth) return true;
  }
  // Try new shelf below
  const div = state.currentShelfHeight > 0 ? DIVIDER_MM : 0;
  const newShelfY = state.completedShelvesDepth + state.currentShelfHeight + div;
  return newShelfY + zoneH <= state.wtDepth && zoneW <= state.wtWidth;
}

/**
 * Place a zone and update shelf state. Call only after canFitNewZone returns true.
 */
function placeNewZone(state: WTState, zoneW: number, zoneH: number): void {
  const xOffset = state.currentShelfUsedWidth > 0
    ? state.currentShelfUsedWidth + DIVIDER_MM
    : 0;
  if (xOffset + zoneW <= state.wtWidth) {
    const newShelfH = Math.max(state.currentShelfHeight, zoneH);
    if (state.completedShelvesDepth + newShelfH <= state.wtDepth) {
      state.currentShelfUsedWidth = xOffset + zoneW;
      state.currentShelfHeight = newShelfH;
      return;
    }
  }
  // Start new shelf
  const div = state.currentShelfHeight > 0 ? DIVIDER_MM : 0;
  state.completedShelvesDepth += state.currentShelfHeight + div;
  state.currentShelfUsedWidth = zoneW;
  state.currentShelfHeight = zoneH;
}

/**
 * WTTypePreference — per-article floor-cost analysis.
 */
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
 * Pre-plan WT types using floor-area cost minimization.
 * Weight-limited articles: same capacity on both → KLEIN is cheaper (0.25 < 0.40 m²).
 * Geometry-limited articles: GROSS depth holds more → may save floor space.
 */
export function planWTTypes(
  processed: ArtikelProcessed[],
  config: WTConfig,
): { plan: Map<string, WTTyp>; preferences: WTTypePreference[]; grossBudgetUsed: number } {
  const preferences: WTTypePreference[] = [];

  for (const art of processed) {
    if (art.bestand <= 0) continue;
    if (art.hoehe_mm > config.hoehe_limit_mm) continue;
    if (art.grundflaeche_mm2 <= 0) continue;
    // Skip if article can't fit on any WT even rotated
    if (Math.min(art.laenge_mm, art.breite_mm) > WT_WIDTH) continue;
    if (Math.max(art.laenge_mm, art.breite_mm) > WT_DEPTH_GROSS) continue;

    const itemsKlein = itemsPerWT(art, WT_WIDTH, WT_DEPTH_KLEIN, config.gewicht_hard_kg);
    const itemsGross = itemsPerWT(art, WT_WIDTH, WT_DEPTH_GROSS, config.gewicht_hard_kg);
    const fitsKlein = itemsKlein > 0;
    const mustGross = !fitsKlein;

    const nKlein = fitsKlein ? Math.ceil(art.bestand / Math.max(1, itemsKlein)) : 999999;
    const nGross = Math.ceil(art.bestand / Math.max(1, itemsGross));

    const areaCostKlein = fitsKlein ? nKlein * KLEIN_FLOOR_M2 : 999999;
    const areaCostGross = nGross * GROSS_FLOOR_M2;

    const bestType: WTTyp = (!fitsKlein || areaCostGross < areaCostKlein) ? 'GROSS' : 'KLEIN';
    const areaSaving = areaCostKlein - areaCostGross;

    preferences.push({
      artikelnummer: String(art.artikelnummer),
      n_klein: nKlein === 999999 ? 0 : nKlein,
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

/**
 * Post-packing consolidation: dissolve WTs below area and weight thresholds
 * by moving their contents into sufficiently-filled WTs (cross-cluster).
 * Only targets WTs that are already above the threshold (not other underfilled WTs).
 */
function consolidateUnderfilled(
  allWTStates: WTState[],
  config: WTConfig,
  thresholdPct = 30,
): void {
  const rawArea = (s: WTState) => s.wtWidth * s.wtDepth;

  const candidateIds = new Set(
    allWTStates
      .filter(s => (s.usedArea / rawArea(s)) * 100 < thresholdPct
        && s.wt.gesamtgewicht_kg < config.gewicht_soft_kg)
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
        if (candidateIds.has(tgt.wt.id)) continue; // only target well-filled WTs

        // Weight check
        if (tgt.wt.gesamtgewicht_kg + pos.gewicht_kg * pos.stueckzahl > config.gewicht_hard_kg) continue;

        const existingOnTgt = tgt.wt.positionen.find(p => p.artikelnummer === pos.artikelnummer);

        if (existingOnTgt) {
          // Expanding existing zone: check total ≤ WT capacity
          const artProxy = {
            laenge_mm: pos.laenge_mm ?? 10,
            breite_mm: pos.breite_mm ?? 10,
            max_stapelhoehe: pos.max_stapelhoehe ?? 1,
            gewicht_kg: pos.gewicht_kg,
          } as ArtikelProcessed;
          const maxCap = itemsPerWT(artProxy, tgt.wtWidth, tgt.wtDepth, config.gewicht_hard_kg);
          if (existingOnTgt.stueckzahl + pos.stueckzahl > maxCap) continue;

          existingOnTgt.stueckzahl += pos.stueckzahl;
        } else {
          // New zone: shelf fit check
          const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
          const stacks = Math.ceil(pos.stueckzahl / maxStapel);
          const artProxy = {
            laenge_mm: pos.laenge_mm ?? 10,
            breite_mm: pos.breite_mm ?? 10,
          } as ArtikelProcessed;
          const { zoneW, zoneH } = zoneLayout(artProxy, stacks, tgt.wtWidth);
          if (!canFitNewZone(tgt, zoneW, zoneH)) continue;

          tgt.wt.positionen.push({ ...pos });
          placeNewZone(tgt, zoneW, zoneH);
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
      if (artikel.hoehe_mm > config.hoehe_limit_mm) continue;
      if (artikel.grundflaeche_mm2 <= 0) continue;
      // Skip articles that can't fit on any WT even when rotated
      if (Math.min(artikel.laenge_mm, artikel.breite_mm) > WT_WIDTH) continue;
      if (Math.max(artikel.laenge_mm, artikel.breite_mm) > WT_DEPTH_GROSS) continue;

      let remaining = artikel.bestand;
      const plannedTyp: WTTyp = wtTypePlan.get(String(artikel.artikelnummer)) ?? 'KLEIN';
      const wtDepth = getWTDepth(plannedTyp);
      const maxPerWT = itemsPerWT(artikel, WT_WIDTH, wtDepth, config.gewicht_hard_kg);
      if (maxPerWT <= 0) continue;

      while (remaining > 0) {
        const tryPlace = Math.min(remaining, maxPerWT);
        let placed = false;

        // Two-pass: prefer soft weight limit, then allow up to hard limit
        for (const weightLimit of [config.gewicht_soft_kg, config.gewicht_hard_kg]) {
          if (placed) break;

          for (const wtState of clusterWTStates) {
            const weightBudget = weightLimit - wtState.wt.gesamtgewicht_kg;
            if (weightBudget <= 0) continue;
            const maxByWeight = artikel.gewicht_kg > 0
              ? Math.floor(weightBudget / artikel.gewicht_kg)
              : tryPlace;
            if (maxByWeight <= 0) continue;

            const existingPos = wtState.wt.positionen.find(
              p => p.artikelnummer === String(artikel.artikelnummer),
            );

            if (existingPos) {
              // Expanding existing zone: cap at per-WT capacity for this article
              const maxExpand = maxPerWT - existingPos.stueckzahl;
              if (maxExpand <= 0) continue;
              const actualPlace = Math.min(tryPlace, maxByWeight, maxExpand);
              if (actualPlace <= 0) continue;

              existingPos.stueckzahl += actualPlace;
              updateWTMetrics(wtState, config);
              remaining -= actualPlace;
              placed = true;
              break;
            } else {
              // New zone: shelf fit check
              const stacks = Math.ceil(Math.min(tryPlace, maxByWeight) / Math.max(1, artikel.max_stapelhoehe));
              const { zoneW, zoneH } = zoneLayout(artikel, stacks, WT_WIDTH);
              if (!canFitNewZone(wtState, zoneW, zoneH)) continue;

              const actualPlace = Math.min(tryPlace, maxByWeight);
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
              placeNewZone(wtState, zoneW, zoneH);
              updateWTMetrics(wtState, config);
              remaining -= actualPlace;
              placed = true;
              break;
            }
          }
        }

        if (!placed) {
          // Create new WT
          let typ: WTTyp = wtTypePlan.get(String(artikel.artikelnummer)) ?? 'KLEIN';
          if (typ === 'KLEIN' && kleinCounter >= config.anzahl_klein) typ = 'GROSS';
          if (typ === 'GROSS' && grossCounter >= config.anzahl_gross) typ = 'KLEIN';

          const newDepth = getWTDepth(typ);
          const newMaxPerWT = itemsPerWT(artikel, WT_WIDTH, newDepth, config.gewicht_hard_kg);
          if (newMaxPerWT <= 0) break;

          const actualPlace = Math.min(tryPlace, newMaxPerWT);
          const stacks = Math.ceil(actualPlace / Math.max(1, artikel.max_stapelhoehe));
          const { zoneW, zoneH } = zoneLayout(artikel, stacks, WT_WIDTH);

          let id: string;
          if (typ === 'KLEIN') {
            kleinCounter++;
            id = `K-${String(kleinCounter).padStart(4, '0')}`;
          } else {
            grossCounter++;
            id = `G-${String(grossCounter).padStart(4, '0')}`;
          }

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

          placeNewZone(newState, zoneW, zoneH);
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
    const lightestArt = {
      laenge_mm: lightest.laenge_mm ?? 10,
      breite_mm: lightest.breite_mm ?? 10,
      max_stapelhoehe: lightest.max_stapelhoehe ?? 1,
      gewicht_kg: lightest.gewicht_kg,
    } as ArtikelProcessed;
    const { zoneW, zoneH } = zoneLayout(lightestArt, stacks, WT_WIDTH);

    const sameCluster = allWTStates.filter(
      s => s.wt.cluster_id === wt.cluster_id && s.wt.id !== wt.id,
    );

    for (const tgtState of sameCluster) {
      const targetWeight = tgtState.wt.gesamtgewicht_kg + lightest.gewicht_kg * lightest.stueckzahl;
      if (targetWeight > config.gewicht_hard_kg) continue;

      const existingOnTarget = tgtState.wt.positionen.find(p => p.artikelnummer === lightest.artikelnummer);

      if (existingOnTarget) {
        const maxCap = itemsPerWT(lightestArt, tgtState.wtWidth, tgtState.wtDepth, config.gewicht_hard_kg);
        if (existingOnTarget.stueckzahl + lightest.stueckzahl > maxCap) continue;
      } else {
        if (!canFitNewZone(tgtState, zoneW, zoneH)) continue;
      }

      const idx = wt.positionen.indexOf(lightest);
      if (idx >= 0) {
        wt.positionen.splice(idx, 1);
        if (existingOnTarget) {
          existingOnTarget.stueckzahl += lightest.stueckzahl;
        } else {
          tgtState.wt.positionen.push(lightest);
          placeNewZone(tgtState, zoneW, zoneH);
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
