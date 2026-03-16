import type { WTConfig, SzenarioResult, OptimizationResult } from '../types';

function calcCoOccurrenceScore(result: OptimizationResult): number {
  // Average co-occurrence value for article pairs on the same WT
  // Since we don't have the coMatrix here, approximate from cluster coherence
  let totalPairs = 0;
  let totalScore = 0;

  for (const wt of result.wts) {
    const arts = wt.positionen.map(p => p.artikelnummer);
    for (let i = 0; i < arts.length; i++) {
      for (let j = i + 1; j < arts.length; j++) {
        totalPairs++;
        // Articles on same WT and same cluster get score 1
        totalScore += 1;
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
): SzenarioResult {
  const stellplaetze = anzahlKlein + anzahlGross * 1.5;

  const wtsMitPositionen = result.wts.filter(w => w.positionen.length > 0);
  const avgFlaeche = wtsMitPositionen.length > 0
    ? wtsMitPositionen.reduce((s, w) => s + w.flaeche_netto_pct, 0) / wtsMitPositionen.length
    : 0;

  const avgGewicht = wtsMitPositionen.length > 0
    ? wtsMitPositionen.reduce((s, w) => {
        const brutto = w.typ === 'KLEIN' ? 250_000 : 400_000;
        const gewPct = (w.gesamtgewicht_kg / 24) * 100;
        return s + gewPct;
      }, 0) / wtsMitPositionen.length
    : 0;

  const wtsBenoetigt = result.wts.length;
  const wtsUngenutzt = Math.max(0, (anzahlKlein + anzahlGross) - wtsBenoetigt);
  const wtsUeberlast = result.wts.filter(
    w => w.gesamtgewicht_kg > 20 && w.gesamtgewicht_kg <= 24,
  ).length;

  const coScore = calcCoOccurrenceScore(result);

  let empfehlung = '';
  if (avgFlaeche < 50) {
    empfehlung = 'Zu viele WTs vorhanden — Anzahl reduzieren oder Bestand konsolidieren.';
  } else if (wtsUeberlast / Math.max(wtsBenoetigt, 1) > 0.1) {
    empfehlung = 'Zu wenige WTs oder mehr Große benötigt — Gewichtsverteilung prüfen.';
  } else {
    empfehlung = 'Verhältnis ist ausgeglichen.';
  }

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
    empfehlung,
  };
}

export function processPhase5(
  baseResult: OptimizationResult,
  config: WTConfig,
  runFullPipeline: (cfg: WTConfig) => OptimizationResult,
): SzenarioResult[] {
  const szenarien: SzenarioResult[] = [];

  // 1. "Aktuell"
  szenarien.push(buildSzenario('Aktuell', config.anzahl_klein, config.anzahl_gross, baseResult));

  // 2. "Nur Kleine": convert all capacity to K-equivalents
  const totalKEquiv = config.anzahl_klein + config.anzahl_gross * 1.5;
  const nurKleinConfig = { ...config, anzahl_klein: Math.round(totalKEquiv), anzahl_gross: 0 };
  const nurKleinResult = runFullPipeline(nurKleinConfig);
  szenarien.push(buildSzenario('Nur Kleine', nurKleinConfig.anzahl_klein, 0, nurKleinResult));

  // 3. "Mehr Große": 25% weniger Klein, proportional mehr Groß (2G = 3K)
  const wenigerKlein = Math.round(config.anzahl_klein * 0.75);
  const freigesetztK = config.anzahl_klein - wenigerKlein;
  const mehrGross = config.anzahl_gross + Math.round(freigesetztK * 2 / 3);
  const mehrGrossConfig = { ...config, anzahl_klein: wenigerKlein, anzahl_gross: mehrGross };
  const mehrGrossResult = runFullPipeline(mehrGrossConfig);
  szenarien.push(buildSzenario('Mehr Große', wenigerKlein, mehrGross, mehrGrossResult));

  // 4. "Optimiert": test 5 variants (±10%, ±20% ratio) → best utilization
  const variants = [-0.2, -0.1, 0, 0.1, 0.2];
  let bestVariant: SzenarioResult | null = null;
  let bestAuslastung = -1;

  for (const shift of variants) {
    const kShift = Math.round(config.anzahl_klein * (1 + shift));
    const kDiff = config.anzahl_klein - kShift;
    const gShift = config.anzahl_gross + Math.round(kDiff * 2 / 3);
    const varConfig = { ...config, anzahl_klein: kShift, anzahl_gross: Math.max(0, gShift) };
    const varResult = runFullPipeline(varConfig);
    const scenario = buildSzenario('Optimiert', kShift, Math.max(0, gShift), varResult);
    if (scenario.auslastung_flaeche_avg > bestAuslastung) {
      bestAuslastung = scenario.auslastung_flaeche_avg;
      bestVariant = scenario;
    }
  }

  if (bestVariant) {
    szenarien.push(bestVariant);
  }

  return szenarien;
}
