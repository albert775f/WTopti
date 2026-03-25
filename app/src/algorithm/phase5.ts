import type {
  WTConfig, OptimizationResult, ArtikelProcessed,
  WTRatioResult, ArticleCost,
} from '../types';
import { KLEIN_AREA, GROSS_AREA, KLEIN_FLOOR_M2, GROSS_FLOOR_M2, itemsPerWT2D } from './phase3';

/** Total STOROJET rack floor area — hardcoded, cannot be exceeded. */
export const WAREHOUSE_AREA_M2 = 1480.65;

/**
 * Compute per-article floor cost analysis.
 * For each article: how many KLEIN vs GROSS WTs are needed, and which is cheaper by floor area.
 */
export function computeArticleCosts(
  processed: ArtikelProcessed[],
  config: WTConfig,
): ArticleCost[] {
  const costs: ArticleCost[] = [];

  for (const art of processed) {
    if (art.bestand <= 0) continue;
    if (art.grundflaeche_mm2 <= 0) continue;

    const itemsKlein = itemsPerWT2D(art, KLEIN_AREA, config.gewicht_hard_kg, config.min_segment_mm);
    const itemsGross = itemsPerWT2D(art, GROSS_AREA, config.gewicht_hard_kg, config.min_segment_mm);
    const fitsKlein = itemsKlein > 0;

    const nKlein = fitsKlein && itemsKlein > 0 ? Math.ceil(art.bestand / itemsKlein) : 0;
    const nGross = itemsGross > 0 ? Math.ceil(art.bestand / itemsGross) : 0;

    const areaCostKlein = fitsKlein && nKlein > 0 ? nKlein * KLEIN_FLOOR_M2 : 99999;
    const areaCostGross = nGross > 0 ? nGross * GROSS_FLOOR_M2 : 99999;

    const isWeightLimited = fitsKlein && itemsKlein > 0 && itemsGross > 0 && itemsKlein === itemsGross;
    const bestType: 'KLEIN' | 'GROSS' = (!fitsKlein || itemsGross === 0 || areaCostGross < areaCostKlein) ? 'GROSS' : 'KLEIN';
    const areaSaving = Math.round(((fitsKlein && nKlein > 0 ? areaCostKlein : 0) - areaCostGross) * 100) / 100;

    costs.push({
      artikelnummer: String(art.artikelnummer),
      bezeichnung: art.bezeichnung,
      bestand: art.bestand,
      fits_klein: fitsKlein && itemsKlein > 0,
      items_per_klein: itemsKlein,
      n_klein: nKlein,
      area_cost_klein: fitsKlein && nKlein > 0 ? Math.round(areaCostKlein * 100) / 100 : 0,
      items_per_gross: itemsGross,
      n_gross: nGross,
      area_cost_gross: Math.round(areaCostGross * 100) / 100,
      best_type: bestType,
      area_saving: areaSaving,
      is_weight_limited: isWeightLimited,
    });
  }

  return costs;
}

/**
 * Phase 5: Bottom-up WT ratio calculator.
 *
 * Step 1 — Demand: sum what the current stock actually needs (no budget constraint).
 * Step 2 — Scale: project the demand ratio onto the full warehouse floor area.
 *
 * Result is the recommended purchase quantity for KLEIN and GROSS WTs.
 */
export function processPhase5(
  _baseResult: OptimizationResult,
  config: WTConfig,
  processed: ArtikelProcessed[],
): { ratioResult: WTRatioResult; articleCosts: ArticleCost[] } {
  const articleCosts = computeArticleCosts(processed, config);

  // ── Step 1: Demand ────────────────────────────────────────────────────────
  const grossArticles = articleCosts.filter(c => c.best_type === 'GROSS');
  const kleinArticles = articleCosts.filter(c => c.best_type === 'KLEIN');

  const articles_must_gross = grossArticles.filter(c => !c.fits_klein).length;
  const articles_prefer_gross = grossArticles.filter(c => c.fits_klein).length;
  const articles_on_klein = kleinArticles.length;

  let demand_klein = kleinArticles.reduce((s, c) => s + c.n_klein, 0);
  let demand_gross = grossArticles.reduce((s, c) => s + c.n_gross, 0);
  let demand_area = demand_klein * KLEIN_FLOOR_M2 + demand_gross * GROSS_FLOOR_M2;

  // Handle overflow: shift GROSS → KLEIN (smallest area savings first)
  if (demand_area > WAREHOUSE_AREA_M2) {
    const shiftable = [...grossArticles]
      .filter(c => c.fits_klein && c.n_klein > 0)
      .sort((a, b) => a.area_saving - b.area_saving);
    for (const c of shiftable) {
      if (demand_area <= WAREHOUSE_AREA_M2) break;
      demand_gross -= c.n_gross;
      demand_klein += c.n_klein;
      demand_area = demand_klein * KLEIN_FLOOR_M2 + demand_gross * GROSS_FLOOR_M2;
    }
  }

  const fits_warehouse = demand_area <= WAREHOUSE_AREA_M2;
  const overflow_m2 = fits_warehouse ? 0 : Math.round((demand_area - WAREHOUSE_AREA_M2) * 100) / 100;

  // ── Step 2: Scale to warehouse capacity ───────────────────────────────────
  let scaled_klein: number;
  let scaled_gross: number;

  if (demand_area <= 0) {
    scaled_klein = Math.floor(WAREHOUSE_AREA_M2 / KLEIN_FLOOR_M2);
    scaled_gross = 0;
  } else if (!fits_warehouse) {
    // Still overflowing after shifts — report demand as-is, no scaling possible
    scaled_klein = demand_klein;
    scaled_gross = demand_gross;
  } else {
    const ratio_klein = (demand_klein * KLEIN_FLOOR_M2) / demand_area;
    const ratio_gross = (demand_gross * GROSS_FLOOR_M2) / demand_area;

    scaled_klein = Math.floor((ratio_klein * WAREHOUSE_AREA_M2) / KLEIN_FLOOR_M2);
    scaled_gross = Math.floor((ratio_gross * WAREHOUSE_AREA_M2) / GROSS_FLOOR_M2);

    // Distribute rounding remainder to KLEIN (smaller granularity)
    const used = scaled_klein * KLEIN_FLOOR_M2 + scaled_gross * GROSS_FLOOR_M2;
    const remaining = WAREHOUSE_AREA_M2 - used;
    scaled_klein += Math.floor(remaining / KLEIN_FLOOR_M2);
  }

  const scaled_area = scaled_klein * KLEIN_FLOOR_M2 + scaled_gross * GROSS_FLOOR_M2;

  const demand_area_m2 = Math.round(demand_area * 100) / 100;
  const demand_area_pct = Math.round((demand_area / WAREHOUSE_AREA_M2) * 1000) / 10;
  const scaled_area_m2 = Math.round(scaled_area * 100) / 100;
  const reserve_klein = scaled_klein - demand_klein;
  const reserve_gross = scaled_gross - demand_gross;
  const reserve_area_m2 = Math.round((scaled_area - demand_area) * 100) / 100;

  const top_gross_examples = articleCosts
    .filter(c => c.best_type === 'GROSS' && c.fits_klein && c.area_saving > 0)
    .sort((a, b) => b.area_saving - a.area_saving)
    .slice(0, 3);

  let recommendation: string;
  if (!fits_warehouse) {
    recommendation = `Bestand überschreitet verfügbare Lagerfläche um ${overflow_m2.toFixed(1)} m². Bestandsreduzierung erforderlich.`;
  } else {
    recommendation = `Empfehlung: ${scaled_klein.toLocaleString('de-DE')} KLEIN + ${scaled_gross.toLocaleString('de-DE')} GROSS WTs beschaffen. Aktueller Bestand belegt ${demand_area_pct.toFixed(1)}% der Lagerfläche.`;
  }

  const ratioResult: WTRatioResult = {
    warehouse_area_m2: WAREHOUSE_AREA_M2,
    demand_klein,
    demand_gross,
    demand_area_m2,
    demand_area_pct,
    scaled_klein,
    scaled_gross,
    scaled_area_m2,
    reserve_klein,
    reserve_gross,
    reserve_area_m2,
    articles_must_gross,
    articles_prefer_gross,
    articles_on_klein,
    fits_warehouse,
    overflow_m2,
    top_gross_examples,
    recommendation,
  };

  return { ratioResult, articleCosts };
}
