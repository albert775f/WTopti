import type {
  WTConfig, SzenarioResult, OptimizationResult, ArtikelProcessed,
  WTRatioRecommendation, ArticleCost,
} from '../types';
import type { CoOccurrenceMatrix } from './phase2';
import { planWTTypes, KLEIN_AREA, GROSS_AREA, KLEIN_FLOOR_M2, GROSS_FLOOR_M2, AREA_USABLE_FRACTION, itemsPerWT2D } from './phase3';

// Re-export AREA_USABLE_FRACTION so it can be used by consumers if needed
export { AREA_USABLE_FRACTION };

function calcCoOccurrenceScore(result: OptimizationResult, coMatrix: CoOccurrenceMatrix): number {
  let totalPairs = 0;
  let totalScore = 0;
  for (const wt of result.wts) {
    const arts = wt.positionen.map(p => p.artikelnummer);
    for (let i = 0; i < arts.length; i++) {
      for (let j = i + 1; j < arts.length; j++) {
        totalPairs++;
        const coScore = (coMatrix[arts[i]]?.[arts[j]] ?? 0) + (coMatrix[arts[j]]?.[arts[i]] ?? 0);
        totalScore += coScore;
      }
    }
  }
  return totalPairs > 0 ? Math.round((totalScore / totalPairs) * 100) / 100 : 0;
}

function buildSzenario(
  name: string,
  anzahlKlein: number,
  anzahlGross: number,
  result: OptimizationResult,
  coMatrix: CoOccurrenceMatrix,
): SzenarioResult {
  const stellplaetze = anzahlKlein + anzahlGross * 1.5;
  const wtsMitPositionen = result.wts.filter(w => w.positionen.length > 0);
  const avgFlaeche = wtsMitPositionen.length > 0
    ? wtsMitPositionen.reduce((s, w) => s + w.flaeche_netto_pct, 0) / wtsMitPositionen.length : 0;
  const avgGewicht = wtsMitPositionen.length > 0
    ? wtsMitPositionen.reduce((s, w) => s + (w.gesamtgewicht_kg / 24) * 100, 0) / wtsMitPositionen.length : 0;
  const wtsBenoetigt = result.wts.length;
  const wtsUngenutzt = Math.max(0, (anzahlKlein + anzahlGross) - wtsBenoetigt);
  const wtsUeberlast = result.wts.filter(w => w.gesamtgewicht_kg > 20 && w.gesamtgewicht_kg <= 24).length;
  return {
    szenario: name,
    anzahl_klein: anzahlKlein, anzahl_gross: anzahlGross,
    stellplaetze_k_aequiv: stellplaetze,
    auslastung_flaeche_avg: Math.round(avgFlaeche * 100) / 100,
    auslastung_gewicht_avg: Math.round(avgGewicht * 100) / 100,
    wts_ungenutzt: wtsUngenutzt, wts_ueberlast: wtsUeberlast,
    co_occurrence_score: calcCoOccurrenceScore(result, coMatrix),
    empfehlung: '',
  };
}

/**
 * Compute per-article floor cost analysis (for recommendation and interactive simulator).
 */
export function computeArticleCosts(
  processed: ArtikelProcessed[],
  config: WTConfig,
): ArticleCost[] {
  const costs: ArticleCost[] = [];

  for (const art of processed) {
    if (art.bestand <= 0) continue;
    if (art.hoehe_mm > config.hoehe_limit_mm) continue;
    if (art.grundflaeche_mm2 <= 0) continue;
    if (art.laenge_mm > 500) continue;
    if (art.breite_mm > 800) continue;

    const fitsKlein = art.breite_mm <= 500 && art.laenge_mm <= 500;
    const itemsKlein = fitsKlein ? itemsPerWT2D(art, KLEIN_AREA, config.gewicht_hard_kg) : 0;
    const itemsGross = itemsPerWT2D(art, GROSS_AREA, config.gewicht_hard_kg);

    const nKlein = fitsKlein ? Math.ceil(art.bestand / Math.max(1, itemsKlein)) : 0;
    const nGross = Math.ceil(art.bestand / Math.max(1, itemsGross));

    const areaCostKlein = fitsKlein ? nKlein * KLEIN_FLOOR_M2 : 99999;
    const areaCostGross = nGross * GROSS_FLOOR_M2;

    const isWeightLimited = itemsKlein === itemsGross;
    const bestType: 'KLEIN' | 'GROSS' = (!fitsKlein || areaCostGross < areaCostKlein) ? 'GROSS' : 'KLEIN';
    const areaSaving = (fitsKlein ? areaCostKlein : 0) - areaCostGross;

    costs.push({
      artikelnummer: String(art.artikelnummer),
      bezeichnung: art.bezeichnung,
      bestand: art.bestand,
      fits_klein: fitsKlein,
      items_per_klein: itemsKlein,
      n_klein: nKlein,
      area_cost_klein: fitsKlein ? Math.round(areaCostKlein * 100) / 100 : 0,
      items_per_gross: itemsGross,
      n_gross: nGross,
      area_cost_gross: Math.round(areaCostGross * 100) / 100,
      best_type: bestType,
      area_saving: Math.round(areaSaving * 100) / 100,
      is_weight_limited: isWeightLimited,
    });
  }

  return costs;
}

export function processPhase5(
  baseResult: OptimizationResult,
  config: WTConfig,
  processed: ArtikelProcessed[],
  runFullPipeline: (cfg: WTConfig) => OptimizationResult,
  coMatrix: CoOccurrenceMatrix,
): { szenarien: SzenarioResult[]; recommendation: WTRatioRecommendation; articleCosts: ArticleCost[] } {
  const szenarien: SzenarioResult[] = [];
  const warehouseAreaM2 = config.warehouse_area_m2 ?? 1480.65;

  // Scenario 1: "Optimal (Aktuell)" — efficiency-based result
  szenarien.push(buildSzenario('Optimal (Aktuell)', config.anzahl_klein, config.anzahl_gross, baseResult, coMatrix));

  // Scenario 2: "Nur KLEIN (Simulation)" — no GROSS budget
  const nurKleinConfig = {
    ...config,
    anzahl_gross: 0,
    anzahl_klein: config.anzahl_klein + Math.round(config.anzahl_gross * 1.5),
  };
  const nurKleinResult = runFullPipeline(nurKleinConfig);
  szenarien.push(buildSzenario('Nur KLEIN (Simulation)', nurKleinConfig.anzahl_klein, 0, nurKleinResult, coMatrix));

  // Scenario 3: "Nur GROSS (Simulation)"
  const nurGrossCount = Math.floor((config.anzahl_klein * KLEIN_FLOOR_M2 + config.anzahl_gross * GROSS_FLOOR_M2) / GROSS_FLOOR_M2);
  const nurGrossConfig = { ...config, anzahl_klein: 0, anzahl_gross: nurGrossCount };
  const nurGrossResult = runFullPipeline(nurGrossConfig);
  szenarien.push(buildSzenario('Nur GROSS (Simulation)', 0, nurGrossCount, nurGrossResult, coMatrix));

  // Article cost analysis
  const articleCosts = computeArticleCosts(processed, config);

  // Compute floor area used
  const optimal_klein_used = baseResult.stats.wts_klein;
  const optimal_gross_used = baseResult.stats.wts_gross;
  const area_used_m2 = Math.round((optimal_klein_used * KLEIN_FLOOR_M2 + optimal_gross_used * GROSS_FLOOR_M2) * 100) / 100;
  const area_free_m2 = Math.round((warehouseAreaM2 - area_used_m2) * 100) / 100;
  const area_free_pct = Math.round((area_free_m2 / warehouseAreaM2) * 1000) / 10;

  const klein_free = Math.max(0, config.anzahl_klein - optimal_klein_used);
  const gross_free = Math.max(0, config.anzahl_gross - optimal_gross_used);

  // Article breakdown
  const { preferences } = planWTTypes(processed, config);
  let articles_on_klein = 0;
  let articles_on_gross = 0;
  let articles_must_gross = 0;
  let articles_weight_limited = 0;
  let articles_geometry_limited = 0;

  for (const p of preferences) {
    const planned = p.must_gross || p.best_type === 'GROSS' ? 'GROSS' : 'KLEIN';
    if (p.must_gross) articles_must_gross++;
    if (planned === 'GROSS') articles_on_gross++;
    else articles_on_klein++;
  }

  for (const c of articleCosts) {
    if (c.is_weight_limited && c.fits_klein) articles_weight_limited++;
    else if (!c.fits_klein || c.items_per_gross > c.items_per_klein) articles_geometry_limited++;
  }

  const wts_if_all_klein = nurKleinResult.wts.length;
  const wts_optimal = baseResult.wts.length;
  const klein_saved = Math.max(0, wts_if_all_klein - wts_optimal);

  // Top examples where GROSS saves most floor space
  const top_gross_examples = articleCosts
    .filter(c => c.best_type === 'GROSS' && c.area_saving > 0)
    .sort((a, b) => b.area_saving - a.area_saving)
    .slice(0, 3);

  let empfehlung: string;
  if (area_free_m2 < 0) {
    empfehlung = `Lagerfläche überschritten um ${Math.abs(area_free_m2).toFixed(1)} m²! WT-Anzahl reduzieren.`;
  } else if (klein_saved > 0) {
    empfehlung = `Flächenoptimierung spart ${klein_saved} KLEIN-WTs (${(klein_saved * KLEIN_FLOOR_M2).toFixed(1)} m²) gegenüber reiner KLEIN-Strategie. ` +
      `${articles_geometry_limited} geometriebegrenzte Artikel profitieren von GROSS-Tiefe. ` +
      `${area_free_pct.toFixed(1)}% Lagerfläche (${area_free_m2.toFixed(1)} m²) verbleibt frei.`;
  } else {
    empfehlung = `WT-Verhältnis ausgeglichen. ${area_free_pct.toFixed(1)}% der Lagerfläche (${area_free_m2.toFixed(1)} m²) frei.`;
  }

  const recommendation: WTRatioRecommendation = {
    warehouse_area_m2: warehouseAreaM2,
    area_used_m2,
    area_free_m2,
    area_free_pct,
    available_klein: config.anzahl_klein,
    available_gross: config.anzahl_gross,
    optimal_klein_used,
    optimal_gross_used,
    klein_free,
    gross_free,
    articles_on_klein,
    articles_on_gross,
    articles_must_gross,
    articles_weight_limited,
    articles_geometry_limited,
    wts_if_all_klein,
    wts_optimal,
    klein_saved,
    top_gross_examples,
    empfehlung,
  };

  return { szenarien, recommendation, articleCosts };
}
