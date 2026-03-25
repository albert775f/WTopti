import type {
  WTConfig, OptimizationResult, ArtikelProcessed,
  WTRatioRecommendation, ArticleCost,
} from '../types';
import { KLEIN_AREA, GROSS_AREA, KLEIN_FLOOR_M2, GROSS_FLOOR_M2, AREA_USABLE_FRACTION, itemsPerWT2D } from './phase3';

export { AREA_USABLE_FRACTION };

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

    const fitsKlein = art.breite_mm <= 500 && art.laenge_mm <= 500;
    const itemsKlein = fitsKlein ? itemsPerWT2D(art, KLEIN_AREA, config.gewicht_hard_kg, config.min_segment_mm) : 0;
    const itemsGross = itemsPerWT2D(art, GROSS_AREA, config.gewicht_hard_kg, config.min_segment_mm);

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
 * Phase 5: Compute optimal KLEIN/GROSS ratio analytically from article costs.
 * No full pipeline re-runs — pure floor-area minimisation within warehouse area constraint.
 */
export function processPhase5(
  baseResult: OptimizationResult,
  config: WTConfig,
  processed: ArtikelProcessed[],
): { recommendation: WTRatioRecommendation; articleCosts: ArticleCost[] } {
  const articleCosts = computeArticleCosts(processed, config);

  // ── Current state (from actual packing run) ──────────────────────────────
  const current_klein = baseResult.stats.wts_klein;
  const current_gross = baseResult.stats.wts_gross;
  const current_area_m2 = Math.round((current_klein * KLEIN_FLOOR_M2 + current_gross * GROSS_FLOOR_M2) * 100) / 100;
  const current_area_free_m2 = Math.round((WAREHOUSE_AREA_M2 - current_area_m2) * 100) / 100;
  const current_area_free_pct = Math.round((current_area_free_m2 / WAREHOUSE_AREA_M2) * 1000) / 10;

  // ── Optimal state (analytical) ───────────────────────────────────────────
  // Assign each article to its best_type (floor-area minimisation, no budget constraint).
  const grossArticles = articleCosts.filter(c => c.best_type === 'GROSS');
  const kleinArticles = articleCosts.filter(c => c.best_type === 'KLEIN');

  let optimal_gross = grossArticles.reduce((s, c) => s + c.n_gross, 0);
  let optimal_klein = kleinArticles.reduce((s, c) => s + c.n_klein, 0);

  const articles_must_gross = grossArticles.filter(c => !c.fits_klein).length;
  const articles_prefer_gross = grossArticles.filter(c => c.fits_klein).length;
  const articles_on_klein = kleinArticles.length;

  // Enforce area constraint: if optimal exceeds WAREHOUSE_AREA_M2, shift cheapest GROSS→KLEIN
  let optimal_area_m2 = optimal_klein * KLEIN_FLOOR_M2 + optimal_gross * GROSS_FLOOR_M2;
  if (optimal_area_m2 > WAREHOUSE_AREA_M2) {
    const shiftable = [...grossArticles]
      .filter(c => c.fits_klein && c.n_klein > 0)
      .sort((a, b) => a.area_saving - b.area_saving); // smallest savings shifted first
    for (const c of shiftable) {
      if (optimal_area_m2 <= WAREHOUSE_AREA_M2) break;
      optimal_gross -= c.n_gross;
      optimal_klein += c.n_klein;
      optimal_area_m2 = optimal_klein * KLEIN_FLOOR_M2 + optimal_gross * GROSS_FLOOR_M2;
    }
  }

  optimal_area_m2 = Math.round((optimal_klein * KLEIN_FLOOR_M2 + optimal_gross * GROSS_FLOOR_M2) * 100) / 100;
  const optimal_area_free_m2 = Math.round((WAREHOUSE_AREA_M2 - optimal_area_m2) * 100) / 100;
  const optimal_area_free_pct = Math.round((optimal_area_free_m2 / WAREHOUSE_AREA_M2) * 1000) / 10;
  const optimal_fits = optimal_area_m2 <= WAREHOUSE_AREA_M2;

  const klein_saved = current_klein - optimal_klein;
  const gross_delta = optimal_gross - current_gross;
  const area_saved_m2 = Math.round((current_area_m2 - optimal_area_m2) * 100) / 100;

  const top_gross_examples = articleCosts
    .filter(c => c.best_type === 'GROSS' && c.fits_klein && c.area_saving > 0)
    .sort((a, b) => b.area_saving - a.area_saving)
    .slice(0, 3);

  let empfehlung: string;
  if (!optimal_fits) {
    empfehlung = `Bestand überschreitet verfügbare Lagerfläche (${WAREHOUSE_AREA_M2} m²). Bestandsreduzierung erforderlich.`;
  } else if (klein_saved > 0 || gross_delta > 0) {
    const parts: string[] = [];
    if (gross_delta > 0) parts.push(`+${gross_delta} GROSS`);
    if (klein_saved > 0) parts.push(`−${klein_saved} KLEIN`);
    empfehlung = `Optimales Verhältnis: ${parts.join(', ')}. Einsparung ${area_saved_m2.toFixed(1)} m² Lagerfläche.`;
  } else if (klein_saved < 0 || gross_delta < 0) {
    empfehlung = `Aktuelle Konfiguration hat mehr WTs als analytisch benötigt — Konsolidierungspotenzial vorhanden.`;
  } else {
    empfehlung = `Aktuelle Konfiguration entspricht dem analytisch optimalen Verhältnis.`;
  }

  const recommendation: WTRatioRecommendation = {
    warehouse_area_m2: WAREHOUSE_AREA_M2,
    current_klein,
    current_gross,
    current_area_m2,
    current_area_free_m2,
    current_area_free_pct,
    optimal_klein,
    optimal_gross,
    optimal_area_m2,
    optimal_area_free_m2,
    optimal_area_free_pct,
    optimal_fits,
    articles_must_gross,
    articles_prefer_gross,
    articles_on_klein,
    klein_saved,
    gross_delta,
    area_saved_m2,
    top_gross_examples,
    empfehlung,
  };

  return { recommendation, articleCosts };
}
