import type { ArtikelProcessed, WTConfig, WT, WTTyp, WTPosition } from '../types';
import type { ClusterResult } from './phase2';

// WT dimensions in mm
const WT_WIDTH = 500;
const WT_DEPTH_KLEIN = 500;
const WT_DEPTH_GROSS = 800;

// Area constants
export const KLEIN_AREA = WT_WIDTH * WT_DEPTH_KLEIN;   // 250,000 mm²
export const GROSS_AREA = WT_WIDTH * WT_DEPTH_GROSS;   // 400,000 mm²
export const KLEIN_FLOOR_M2 = 0.25;
export const GROSS_FLOOR_M2 = 0.40;
export const AREA_USABLE_FRACTION = 0.92;  // ~8% for custom-cut dividers

function getWTArea(typ: WTTyp): number {
  return typ === 'KLEIN' ? KLEIN_AREA : GROSS_AREA;
}

/**
 * How many items of this article fit on a WT with given area?
 * Geometric capacity: floor(WT_area × 0.92 / (l × b)) stacks × max_stapelhoehe items/stack
 * Weight capacity: floor(maxWeightKg / gewicht_kg)
 */
export function itemsPerWT2D(artikel: ArtikelProcessed, wtArea: number, maxWeightKg: number): number {
  const maxStapel = Math.max(1, artikel.max_stapelhoehe);
  const footprint = artikel.laenge_mm * artikel.breite_mm;
  const maxStacksGeom = Math.floor((wtArea * AREA_USABLE_FRACTION) / footprint);
  const itemsGeom = maxStacksGeom * maxStapel;
  const itemsWeight = artikel.gewicht_kg > 0 ? Math.floor(maxWeightKg / artikel.gewicht_kg) : 999999;
  return Math.max(1, Math.min(itemsGeom, itemsWeight));
}

/**
 * Zone footprint for a position (mm²)
 * stacks_needed × laenge × breite
 */
function zoneFootprintPos(pos: WTPosition): number {
  const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
  const stacksNeeded = Math.ceil(pos.stueckzahl / maxStapel);
  const laenge = pos.laenge_mm ?? Math.sqrt(pos.grundflaeche_mm2);
  const breite = pos.breite_mm ?? Math.sqrt(pos.grundflaeche_mm2);
  return stacksNeeded * laenge * breite;
}

/**
 * Zone footprint for N items of an article (mm²)
 */
export function zoneFootprint(artikel: ArtikelProcessed, stueckzahl: number): number {
  const maxStapel = Math.max(1, artikel.max_stapelhoehe);
  const stacksNeeded = Math.ceil(stueckzahl / maxStapel);
  return stacksNeeded * artikel.laenge_mm * artikel.breite_mm;
}

/**
 * Max additional items that fit in remaining area, given existingStu already on WT.
 * Accounts for stack reuse: adding items to partially-filled stacks takes no extra area.
 */
function maxAdditionalByArea(artikel: ArtikelProcessed, existingStu: number, remainingArea: number): number {
  const maxStapel = Math.max(1, artikel.max_stapelhoehe);
  const footprint = artikel.laenge_mm * artikel.breite_mm;
  const currentZoneArea = Math.ceil(existingStu / maxStapel) * footprint;
  const maxTotalStacks = Math.floor((remainingArea + currentZoneArea) / footprint);
  return Math.max(0, maxTotalStacks * maxStapel - existingStu);
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

interface WTState {
  wt: WT;
  usedArea: number;     // mm² consumed by zones (recalculated after each placement)
  usableArea: number;   // WT_area × AREA_USABLE_FRACTION (fixed per WT)
}

function updateWTMetrics(wtState: WTState, config: WTConfig): void {
  const wt = wtState.wt;

  // Recalculate used area from positions
  const usedArea = wt.positionen.reduce((sum, pos) => sum + zoneFootprintPos(pos), 0);
  wtState.usedArea = usedArea;

  wt.anzahl_teiler = Math.max(0, wt.positionen.length - 1);
  wt.flaeche_netto_pct = wtState.usableArea > 0
    ? Math.round((usedArea / wtState.usableArea) * 10000) / 100
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
 * WTTypePreference — floor-cost-based WT type selection.
 * For each article, compare floor space (m²) needed on KLEIN vs GROSS.
 * Choose the type that uses less warehouse floor area.
 */
export interface WTTypePreference {
  artikelnummer: string;
  n_klein: number;
  n_gross: number;
  area_cost_klein: number;  // m²
  area_cost_gross: number;  // m²
  best_type: WTTyp;
  must_gross: boolean;
  area_saving: number;      // area_cost_klein - area_cost_gross (positive = GROSS saves m²)
}

/**
 * Pre-plan WT types using floor-area cost minimization.
 * Weight-limited articles: same capacity on both types → KLEIN is cheaper (0.25 < 0.40 m²)
 * Geometry-limited articles: GROSS depth holds more → may save floor space despite larger footprint
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
    if (art.laenge_mm > WT_WIDTH) continue;
    if (art.breite_mm > WT_DEPTH_GROSS) continue;

    const fitsKlein = art.breite_mm <= WT_DEPTH_KLEIN && art.laenge_mm <= WT_WIDTH;
    const mustGross = !fitsKlein;

    const itemsKlein = fitsKlein ? itemsPerWT2D(art, KLEIN_AREA, config.gewicht_hard_kg) : 0;
    const itemsGross = itemsPerWT2D(art, GROSS_AREA, config.gewicht_hard_kg);

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

  // Default: KLEIN
  for (const p of preferences) {
    if (!plan.has(p.artikelnummer)) {
      plan.set(p.artikelnummer, 'KLEIN');
    }
  }

  return { plan, preferences, grossBudgetUsed };
}

/** A-Artikel Scattering — unchanged from previous version */
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

export function processPhase3(
  processed: ArtikelProcessed[],
  _clusters: ClusterResult,
  config: WTConfig,
): WT[] {
  // Pre-plan WT types using floor-area cost minimization
  const { plan: wtTypePlan } = planWTTypes(processed, config);

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
    // Sort by zone footprint descending (First Fit Decreasing)
    const sorted = [...articles].sort((a, b) => b.grundflaeche_mm2 - a.grundflaeche_mm2);

    const clusterWTStates: WTState[] = [];

    for (const artikel of sorted) {
      if (artikel.hoehe_mm > config.hoehe_limit_mm) continue;
      if (artikel.grundflaeche_mm2 <= 0) continue;
      if (artikel.laenge_mm > WT_WIDTH) continue;          // article too wide
      if (artikel.breite_mm > WT_DEPTH_GROSS) continue;    // article too deep for any WT

      let remaining = artikel.bestand;

      // Determine WT type for this article
      const plannedTyp: WTTyp = wtTypePlan.get(String(artikel.artikelnummer)) ?? 'KLEIN';
      const wtAreaForArticle = plannedTyp === 'KLEIN' ? KLEIN_AREA : GROSS_AREA;
      const maxPerWT = itemsPerWT2D(artikel, wtAreaForArticle, config.gewicht_hard_kg);
      if (maxPerWT <= 0) continue;

      while (remaining > 0) {
        const tryPlace = Math.min(remaining, maxPerWT);

        // Two-pass: prefer WTs within soft weight limit, then allow up to hard limit
        let placed = false;
        for (const weightLimit of [config.gewicht_soft_kg, config.gewicht_hard_kg]) {
          if (placed) break;
          for (const wtState of clusterWTStates) {
            // Weight check
            const weightBudget = weightLimit - wtState.wt.gesamtgewicht_kg;
            if (weightBudget <= 0) continue;
            const maxByWeight = Math.floor(weightBudget / artikel.gewicht_kg);
            if (maxByWeight <= 0) continue;

            // Existing position check
            const existingPos = wtState.wt.positionen.find(
              p => p.artikelnummer === String(artikel.artikelnummer),
            );
            const existingStu = existingPos?.stueckzahl ?? 0;

            // Area check
            const remainingArea = wtState.usableArea - wtState.usedArea;
            const maxByArea = maxAdditionalByArea(artikel, existingStu, remainingArea);
            if (maxByArea <= 0) continue;

            const actualPlace = Math.min(tryPlace, maxByWeight, maxByArea);
            if (actualPlace <= 0) continue;

            if (existingPos) {
              existingPos.stueckzahl += actualPlace;
            } else {
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
            }
            updateWTMetrics(wtState, config);
            remaining -= actualPlace;
            placed = true;
            break;
          }
        }

        if (!placed) {
          // Create new WT
          const maxByWeight = Math.floor(config.gewicht_hard_kg / artikel.gewicht_kg);
          if (maxByWeight <= 0) break;

          // Determine WT type: use plan, fall back if inventory exhausted
          let typ: WTTyp = wtTypePlan.get(String(artikel.artikelnummer)) ?? 'KLEIN';
          if (typ === 'KLEIN' && kleinCounter >= config.anzahl_klein) typ = 'GROSS';
          if (typ === 'GROSS' && grossCounter >= config.anzahl_gross) typ = 'KLEIN';

          const newWTArea = getWTArea(typ);
          const newUsableArea = newWTArea * AREA_USABLE_FRACTION;
          const maxByArea = maxAdditionalByArea(artikel, 0, newUsableArea);
          const actualPlace = Math.min(tryPlace, maxByWeight, maxByArea);
          if (actualPlace <= 0) break;

          let id: string;
          if (typ === 'KLEIN') {
            kleinCounter++;
            id = `K-${String(kleinCounter).padStart(4, '0')}`;
          } else {
            grossCounter++;
            id = `G-${String(grossCounter).padStart(4, '0')}`;
          }

          const newWT = createWT(id, typ, clusterId);
          const newState: WTState = { wt: newWT, usedArea: 0, usableArea: newUsableArea };

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
    const lightestZone = zoneFootprintPos(lightest);

    const sameCluster = allWTStates.filter(
      s => s.wt.cluster_id === wt.cluster_id && s.wt.id !== wt.id,
    );
    for (const tgtState of sameCluster) {
      const targetWeight = tgtState.wt.gesamtgewicht_kg + lightest.gewicht_kg * lightest.stueckzahl;
      if (targetWeight > config.gewicht_hard_kg) continue;

      const remainingAreaTgt = tgtState.usableArea - tgtState.usedArea;
      if (lightestZone > remainingAreaTgt) continue;

      const idx = wt.positionen.indexOf(lightest);
      if (idx >= 0) {
        wt.positionen.splice(idx, 1);
        tgtState.wt.positionen.push(lightest);
        updateWTMetrics(srcState, config);
        updateWTMetrics(tgtState, config);
        break;
      }
    }
  }

  return allWTStates.map(s => s.wt);
}
