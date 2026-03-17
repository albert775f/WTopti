import type { WTConfig, SzenarioResult, OptimizationResult, ArtikelProcessed, WTRatioRecommendation } from '../types';
import type { CoOccurrenceMatrix } from './phase2';
import { planWTTypes } from './phase3';

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
    ? wtsMitPositionen.reduce((s, w) => s + w.flaeche_netto_pct, 0) / wtsMitPositionen.length
    : 0;

  const avgGewicht = wtsMitPositionen.length > 0
    ? wtsMitPositionen.reduce((s, w) => s + (w.gesamtgewicht_kg / 24) * 100, 0) / wtsMitPositionen.length
    : 0;

  const wtsBenoetigt = result.wts.length;
  const wtsUngenutzt = Math.max(0, (anzahlKlein + anzahlGross) - wtsBenoetigt);
  const wtsUeberlast = result.wts.filter(w => w.gesamtgewicht_kg > 20 && w.gesamtgewicht_kg <= 24).length;
  const coScore = calcCoOccurrenceScore(result, coMatrix);

  return {
    szenario: name,
    anzahl_klein: anzahlKlein,
    anzahl_gross: anzahlGross,
    stellplaetze_k_aequiv: stellplaetze,
    auslastung_flaeche_avg: Math.round(avgFlaeche * 100) / 100,
    auslastung_gewicht_avg: Math.round(avgGewicht * 100) / 100,
    wts_ungenutzt: wtsUngenutzt,
    wts_ueberlast: wtsUeberlast,
    co_occurrence_score: coScore,
    empfehlung: '',
  };
}

export function processPhase5(
  baseResult: OptimizationResult,
  config: WTConfig,
  processed: ArtikelProcessed[],
  runFullPipeline: (cfg: WTConfig) => OptimizationResult,
  coMatrix: CoOccurrenceMatrix,
): { szenarien: SzenarioResult[]; recommendation: WTRatioRecommendation } {
  const szenarien: SzenarioResult[] = [];

  // Scenario 1: "Optimal (Aktuell)" — efficiency-based planning (what we actually built)
  szenarien.push(buildSzenario(
    'Optimal (Aktuell)',
    config.anzahl_klein, config.anzahl_gross,
    baseResult, coMatrix,
  ));

  // Scenario 2: "Nur KLEIN (Simulation)" — what happens with no GROSS budget
  const nurKleinConfig = { ...config, anzahl_gross: 0, anzahl_klein: config.anzahl_klein + Math.round(config.anzahl_gross * 1.5) };
  const nurKleinResult = runFullPipeline(nurKleinConfig);
  szenarien.push(buildSzenario(
    'Nur KLEIN (Simulation)',
    nurKleinConfig.anzahl_klein, 0,
    nurKleinResult, coMatrix,
  ));

  // Scenario 3: "Nur GROSS (Simulation)" — all capacity as GROSS
  const nurGrossKleinEquiv = config.anzahl_klein + Math.round(config.anzahl_gross * 1.5);
  const nurGrossCount = Math.floor(nurGrossKleinEquiv / 1.5);
  const nurGrossConfig = { ...config, anzahl_klein: 0, anzahl_gross: nurGrossCount };
  const nurGrossResult = runFullPipeline(nurGrossConfig);
  szenarien.push(buildSzenario(
    'Nur GROSS (Simulation)',
    0, nurGrossCount,
    nurGrossResult, coMatrix,
  ));

  // Build recommendation from article-level analysis
  const { preferences } = planWTTypes(processed, config);

  let articles_on_gross = 0;
  let articles_on_klein = 0;
  let articles_must_gross = 0;

  for (const p of preferences) {
    if (p.mustGross) {
      articles_must_gross++;
      articles_on_gross++;
    } else if (p.nGross < p.nKlein) {
      // This article benefited from GROSS in the plan
      // Check the plan outcome via baseResult stats (approximate: count by plan, not by actual allocation)
      articles_on_gross++;
    } else {
      articles_on_klein++;
    }
  }
  // Remaining articles defaulted to KLEIN
  articles_on_klein = preferences.length - articles_on_gross;

  const optimal_klein_used = baseResult.stats.wts_klein;
  const optimal_gross_used = baseResult.stats.wts_gross;
  const klein_free = Math.max(0, config.anzahl_klein - optimal_klein_used);
  const gross_free = Math.max(0, config.anzahl_gross - optimal_gross_used);
  const wts_if_all_klein = nurKleinResult.wts.length;
  const wts_optimal = baseResult.wts.length;
  const klein_saved = Math.max(0, wts_if_all_klein - wts_optimal);

  let empfehlung: string;
  if (optimal_klein_used > config.anzahl_klein) {
    empfehlung = `KLEIN-Bestand erschöpft (${optimal_klein_used - config.anzahl_klein} fehlen). Mehr GROSS-WTs beschaffen oder Artikelbestand reduzieren.`;
  } else if (klein_saved > 0) {
    empfehlung = `Effizienz-Planung spart ${klein_saved} KLEIN-WTs gegenüber einer reinen KLEIN-Strategie. ` +
      `${optimal_gross_used} GROSS-WTs genutzt (${gross_free} frei), ${klein_free} KLEIN-WTs frei für künftigen Bestand.`;
  } else {
    empfehlung = `WT-Verhältnis ausgeglichen. ${klein_free} KLEIN und ${gross_free} GROSS frei.`;
  }

  const recommendation: WTRatioRecommendation = {
    available_klein: config.anzahl_klein,
    available_gross: config.anzahl_gross,
    optimal_klein_used,
    optimal_gross_used,
    klein_free,
    gross_free,
    articles_on_klein,
    articles_on_gross,
    articles_must_gross,
    wts_if_all_klein,
    wts_optimal,
    klein_saved,
    empfehlung,
  };

  return { szenarien, recommendation };
}
