import type { ArtikelProcessed, WTConfig, WT, WTTyp, WTPosition } from '../types';
import type { AffinityResult } from '../types';

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
  _minSegMm = 0,
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
 * Budget constraints removed — each article gets its best_type directly.
 */
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

  // Each article goes directly to its best_type (no budget constraint)
  for (const p of preferences) {
    plan.set(p.artikelnummer, p.best_type);
  }

  return { plan, preferences };
}

// scatterAArtikel removed in v4.0 — distribution emerges from partner-WT placement

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
// v4.0: canAddArticle — dry-run check (no WT mutation)
// ============================================================

const MAX_ARTICLES_PER_WT = 6;

function canAddArticle(wt: WT, artNr: string, art: ArtikelProcessed, config: WTConfig): boolean {
  if (wt.positionen.some(p => p.artikelnummer === artNr)) return false;
  if (wt.positionen.length >= MAX_ARTICLES_PER_WT) return false;

  const wtD = getWTDepth(wt.typ);
  const newZoneCount = wt.positionen.length + 1;
  const grid = bestGrid(newZoneCount, WT_WIDTH, wtD, config.teiler_breite_mm, config.min_segment_mm);
  if (!grid) return false;

  for (const pos of wt.positionen) {
    if (itemsPerZone(pos.hoehe_mm, pos.breite_mm, pos.laenge_mm, grid.zoneW, grid.zoneD, config.griff_puffer_mm) < pos.stueckzahl) return false;
  }

  const cap = itemsPerZone(art.hoehe_mm, art.breite_mm, art.laenge_mm, grid.zoneW, grid.zoneD, config.griff_puffer_mm);
  if (cap <= 0) return false;

  if (wt.gesamtgewicht_kg + art.gewicht_kg > config.gewicht_hard_kg) return false;

  return true;
}

// ============================================================
// Main Phase 3 entry point (v4.0: Pass 1 + Pass 2)
// ============================================================

export function processPhase3(
  processed: ArtikelProcessed[],
  affinityResult: AffinityResult,
  config: WTConfig,
): WT[] {
  const { plan: wtTypePlan } = planWTTypes(processed, config);

  const artDataMap = new Map<string, ArtikelProcessed>();
  for (const art of processed) {
    artDataMap.set(String(art.artikelnummer), art);
  }

  let kleinCounter = 0;
  let grossCounter = 0;
  function nextId(typ: WTTyp): string {
    return typ === 'KLEIN'
      ? `K-${String(++kleinCounter).padStart(4, '0')}`
      : `G-${String(++grossCounter).padStart(4, '0')}`;
  }

  const allWTs: WT[] = [];
  // Dynamic index: artNr → WTs currently containing that article
  const artToWTs = new Map<string, Set<WT>>();
  // Mono-WTs created in Pass 1 per article
  const monoIndex = new Map<string, WT[]>();

  function registerArtToWT(artNr: string, wt: WT) {
    if (!artToWTs.has(artNr)) artToWTs.set(artNr, new Set());
    artToWTs.get(artNr)!.add(wt);
  }

  // ── Pass 1: Create mono WTs ──────────────────────────────────────────────
  for (const art of processed) {
    if (art.bestand <= 0) continue;
    const artNr = String(art.artikelnummer);

    const preferredTyp = wtTypePlan.get(artNr) ?? 'KLEIN';
    const typesToTry: WTTyp[] = preferredTyp === 'KLEIN' ? ['KLEIN', 'GROSS'] : ['GROSS', 'KLEIN'];

    let grid: { cols: number; rows: number; zoneW: number; zoneD: number } | null = null;
    let cap = 0;
    let wtTyp: WTTyp = preferredTyp;

    for (const tryTyp of typesToTry) {
      const tryWtD = getWTDepth(tryTyp);
      const tryGrid = bestGrid(1, WT_WIDTH, tryWtD, config.teiler_breite_mm, config.min_segment_mm);
      if (!tryGrid) continue;
      const tryCap = itemsPerZone(art.hoehe_mm, art.breite_mm, art.laenge_mm, tryGrid.zoneW, tryGrid.zoneD, config.griff_puffer_mm);
      if (tryCap <= 0) continue;
      grid = tryGrid;
      cap = tryCap;
      wtTyp = tryTyp;
      break;
    }

    if (!grid || cap <= 0) continue;

    let remaining = art.bestand;
    const monoWTs: WT[] = [];

    while (remaining > 0) {
      let toPlace = Math.min(remaining, cap);
      if (art.gewicht_kg > 0) {
        while (toPlace > 0 && toPlace * art.gewicht_kg > config.gewicht_hard_kg) toPlace--;
      }
      if (toPlace <= 0) break;

      const wt = createWT(nextId(wtTyp), wtTyp, art.cluster_id ?? 0);
      setWTGrid(wt, grid.cols, grid.rows, grid.zoneW, grid.zoneD);
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
        zone_index: 0,
      });
      updateWTMetrics(wt, config);
      allWTs.push(wt);
      monoWTs.push(wt);
      registerArtToWT(artNr, wt);
      remaining -= toPlace;
    }

    if (monoWTs.length > 0) {
      monoIndex.set(artNr, monoWTs);
    }
  }

  // ── Pass 2: Redistribute onto partner WTs ───────────────────────────────
  const { partnerIndex } = affinityResult;

  // Sort articles by partner count desc, then umsatz desc, then bestand desc
  const sortedArticles = [...processed]
    .filter(art => art.bestand > 0)
    .sort((a, b) => {
      const aNr = String(a.artikelnummer);
      const bNr = String(b.artikelnummer);
      const aP = partnerIndex.get(aNr)?.length ?? 0;
      const bP = partnerIndex.get(bNr)?.length ?? 0;
      if (bP !== aP) return bP - aP;
      if (b.umsatz_gesamt !== a.umsatz_gesamt) return b.umsatz_gesamt - a.umsatz_gesamt;
      return b.bestand - a.bestand;
    });

  const removedWTIds = new Set<string>();

  for (const art of sortedArticles) {
    const artNr = String(art.artikelnummer);
    const partners = partnerIndex.get(artNr);
    if (!partners || partners.length === 0) continue;

    // Collect partner WTs that can accept A (dedup by WT id)
    const targetWTs: WT[] = [];
    const targetWTIds = new Set<string>();

    for (const { partner } of partners) {
      const partnerWTs = artToWTs.get(partner);
      if (!partnerWTs) continue;
      for (const wt of partnerWTs) {
        if (removedWTIds.has(wt.id)) continue;
        if (targetWTIds.has(wt.id)) continue;
        if (canAddArticle(wt, artNr, art, config)) {
          targetWTs.push(wt);
          targetWTIds.add(wt.id);
        }
      }
    }

    if (targetWTs.length === 0) continue;

    // Total bestand of A currently across all active WTs
    let totalBestand = 0;
    const currentWTs = artToWTs.get(artNr);
    if (currentWTs) {
      for (const wt of currentWTs) {
        if (removedWTIds.has(wt.id)) continue;
        const pos = wt.positionen.find(p => p.artikelnummer === artNr);
        if (pos) totalBestand += pos.stueckzahl;
      }
    }

    if (totalBestand <= 0) continue;

    const mengeProWT = Math.ceil(totalBestand / targetWTs.length);

    // Place A on partner WTs
    let distributed = 0;
    for (const wt of targetWTs) {
      if (distributed >= totalBestand) break;
      const toPlace = Math.min(mengeProWT, totalBestand - distributed);
      const wtD = getWTDepth(wt.typ);
      const placed = tryAddArticleToWT(wt, artNr, art, toPlace, wtD, config);
      if (placed > 0) {
        registerArtToWT(artNr, wt);
        distributed += placed;
      }
    }

    // Adjust own mono WTs
    let remainingBestand = totalBestand - distributed;
    const monoWTs = (monoIndex.get(artNr) ?? []).filter(wt => !removedWTIds.has(wt.id));
    // Sort ascending so smallest (most dispensable) mono WTs are removed first
    monoWTs.sort((a, b) => {
      const aPos = a.positionen.find(p => p.artikelnummer === artNr);
      const bPos = b.positionen.find(p => p.artikelnummer === artNr);
      return (aPos?.stueckzahl ?? 0) - (bPos?.stueckzahl ?? 0);
    });

    for (const monoWT of monoWTs) {
      const pos = monoWT.positionen.find(p => p.artikelnummer === artNr);
      if (!pos) continue;

      if (remainingBestand <= 0) {
        removedWTIds.add(monoWT.id);
        artToWTs.get(artNr)?.delete(monoWT);
      } else {
        // Cap to single-zone capacity of this mono WT
        const grid = bestGrid(1, WT_WIDTH, getWTDepth(monoWT.typ), config.teiler_breite_mm, config.min_segment_mm);
        const originalCap = grid
          ? itemsPerZone(art.hoehe_mm, art.breite_mm, art.laenge_mm, grid.zoneW, grid.zoneD, config.griff_puffer_mm)
          : pos.stueckzahl;
        const newAmount = Math.min(remainingBestand, originalCap);
        pos.stueckzahl = newAmount;
        updateWTMetrics(monoWT, config);
        remainingBestand -= newAmount;
      }
    }
  }

  // ── WT-Typ-Downsize ──────────────────────────────────────────────────────
  // GROSS mono-WTs whose single article fits on KLEIN → downsize
  for (const wt of allWTs) {
    if (removedWTIds.has(wt.id)) continue;
    if (wt.typ !== 'GROSS' || wt.positionen.length !== 1) continue;

    const pos = wt.positionen[0];
    const kleinGrid = bestGrid(1, WT_WIDTH, WT_DEPTH_KLEIN, config.teiler_breite_mm, config.min_segment_mm);
    if (!kleinGrid) continue;
    const cap = itemsPerZone(pos.hoehe_mm, pos.breite_mm, pos.laenge_mm, kleinGrid.zoneW, kleinGrid.zoneD, config.griff_puffer_mm);
    if (cap >= pos.stueckzahl) {
      wt.typ = 'KLEIN';
      wt.flaeche_brutto_mm2 = KLEIN_AREA;
      setWTGrid(wt, kleinGrid.cols, kleinGrid.rows, kleinGrid.zoneW, kleinGrid.zoneD);
      updateWTMetrics(wt, config);
    }
  }

  // ── Weight balancing ─────────────────────────────────────────────────────
  const activeWTs = allWTs.filter(wt => !removedWTIds.has(wt.id) && wt.positionen.length > 0);

  for (const srcWT of activeWTs) {
    if (srcWT.gesamtgewicht_kg <= config.gewicht_soft_kg) continue;
    if (srcWT.positionen.length <= 1) continue;
    const lightest = [...srcWT.positionen]
      .sort((a, b) => a.gewicht_kg * a.stueckzahl - b.gewicht_kg * b.stueckzahl)[0];
    for (const tgtWT of activeWTs) {
      if (tgtWT === srcWT || tgtWT.typ !== srcWT.typ) continue;
      if (tryMovePositionToWT(srcWT, lightest, tgtWT, config)) break;
    }
  }

  return activeWTs.filter(wt => wt.positionen.length > 0);
}
