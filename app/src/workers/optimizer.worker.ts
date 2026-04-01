import { processPhase1 } from '../algorithm/phase1';
import { processPhase2 } from '../algorithm/phase2';
import { processPhase3 } from '../algorithm/phase3';
import { processPhase4 } from '../algorithm/phase4';
import { processPhase5 } from '../algorithm/phase5';
import { runHardChecks } from '../validation/hardChecks';
import { calculateBaseline } from '../validation/baseline';
import { calculateMetrics } from '../validation/metrics';
import { runOrderSimulation } from '../validation/orderSimulation';
import { calculateExtremes } from '../validation/extremes';
import { DEFAULT_THRESHOLDS } from '../validation/thresholds';
import type {
  ArtikelData,
  BestellungData,
  BestandData,
  WTConfig,
  OptimizationResult,
  ValidationDashboardData,
} from '../types';

export interface WorkerInput {
  artikel: ArtikelData[];
  bestellungen: BestellungData[];
  bestand: BestandData[];
  config: WTConfig;
}

export interface WorkerMessage {
  type: 'progress' | 'result' | 'error';
  phase?: number;
  phaseName?: string;
  progress?: number;
  result?: OptimizationResult;
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  try {
    const { artikel, bestellungen, bestand, config } = e.data;

    self.postMessage({
      type: 'progress',
      phase: 1,
      phaseName: 'Datenaufbereitung & ABC-Analyse',
      progress: 0,
    } satisfies WorkerMessage);

    const phase1Result = processPhase1(artikel, bestellungen, bestand, config);
    self.postMessage({ type: 'progress', phase: 1, progress: 20 } satisfies WorkerMessage);

    self.postMessage({
      type: 'progress',
      phase: 2,
      phaseName: 'Co-Occurrence Clustering',
      progress: 20,
    } satisfies WorkerMessage);

    const phase2Result = processPhase2(phase1Result.processed, phase1Result.filteredBestellungen, config);
    self.postMessage({ type: 'progress', phase: 2, progress: 40 } satisfies WorkerMessage);

    self.postMessage({
      type: 'progress',
      phase: 3,
      phaseName: 'Bin Packing',
      progress: 40,
    } satisfies WorkerMessage);

    const wts = processPhase3(phase1Result.processed, phase2Result, config);
    self.postMessage({ type: 'progress', phase: 3, progress: 70 } satisfies WorkerMessage);

    self.postMessage({
      type: 'progress',
      phase: 4,
      phaseName: 'Validierung',
      progress: 70,
    } satisfies WorkerMessage);

    const phase4Validation = processPhase4(wts, config);
    self.postMessage({ type: 'progress', phase: 4, progress: 85 } satisfies WorkerMessage);

    self.postMessage({
      type: 'progress',
      phase: 5,
      phaseName: 'WT-Verhältnis-Analyse',
      progress: 85,
    } satisfies WorkerMessage);

    // Merge validations
    const validation = {
      hard_fails: [
        ...phase1Result.validation.hard_fails,
        ...phase4Validation.hard_fails,
      ],
      warnungen: [
        ...phase1Result.validation.warnungen,
        ...phase4Validation.warnungen,
      ],
      artikel_nicht_lagerfaehig: phase1Result.validation.artikel_nicht_lagerfaehig,
      artikel_unvollstaendig: phase1Result.validation.artikel_unvollstaendig,
      artikel_ohne_match: phase1Result.validation.artikel_ohne_match,
      fehlende_artikel: phase1Result.validation.fehlende_artikel,
      fehlende_bestand_gesamt: phase1Result.validation.fehlende_bestand_gesamt,
      exclusion_log: phase1Result.validation.exclusion_log,
    };

    const placedArtikelNummern = new Set(wts.flatMap(wt => wt.positionen.map(pos => pos.artikelnummer)));
    const baseResult: OptimizationResult = {
      wts,
      validation,
      stats: {
        artikel_gesamt: artikel.length,
        artikel_platziert: placedArtikelNummern.size,
        wts_benoetigt: wts.length,
        wts_klein: wts.filter(w => w.typ === 'KLEIN').length,
        wts_gross: wts.filter(w => w.typ === 'GROSS').length,
        gesamtbestand: bestand.reduce((s, b) => s + (b.bestand || 0), 0),
      },
    };

    const { ratioResult, articleCosts } = processPhase5(
      baseResult, config, phase1Result.processed,
    );
    baseResult.wt_ratio = ratioResult;
    baseResult.article_costs = articleCosts;

    // Compute validation dashboard
    const { wts: baselineWTs } = calculateBaseline(phase1Result.processed, config);
    const excludedArticleNumbers = new Set<string>(
      (phase1Result.validation.exclusion_log ?? []).map(e => e.artikelnummer),
    );
    // C1 must compare against storojet bestand (phase1-capped), not raw file bestand
    const storojetBestandList = phase1Result.processed
      .filter(a => a.bestand > 0)
      .map(a => ({ artikelnummer: String(a.artikelnummer), bestand: a.bestand }));
    const hardChecks = runHardChecks(wts, artikel, storojetBestandList, excludedArticleNumbers);
    const orderSimulation = runOrderSimulation(phase1Result.filteredBestellungen, wts, baselineWTs);
    const metricsRaw = calculateMetrics(
      wts, baselineWTs, phase1Result.processed, phase1Result.filteredBestellungen,
      phase2Result.pairs, phase2Result.coMatrix, DEFAULT_THRESHOLDS,
      orderSimulation.meanPicks, orderSimulation.baselineMeanPicks,
    );
    const extremes = calculateExtremes(wts, phase1Result.processed, phase2Result.coMatrix);

    const hasFail = hardChecks.some(c => c.status === 'FAIL');
    const overWeightWTs = wts.filter(w => w.gesamtgewicht_kg > 20 && w.gesamtgewicht_kg <= 24);
    const lowAreaWTs = wts.filter(w => w.positionen.length > 0 && w.flaeche_netto_pct < 30);
    const hasWarning = overWeightWTs.length > 0 || lowAreaWTs.length > 0;
    const dashboardStatus: ValidationDashboardData['status'] = hasFail ? 'FAILED' : hasWarning ? 'WARNING' : 'PASSED';

    const warnings: string[] = [];
    if (overWeightWTs.length > 0) warnings.push(`${overWeightWTs.length} WTs im Gewicht-Warnbereich (20–24 kg)`);
    if (lowAreaWTs.length > 0) warnings.push(`${lowAreaWTs.length} WTs mit Flächenauslastung < 30%`);

    baseResult.coMatrix = phase2Result.coMatrix;
    baseResult.validation_dashboard = {
      status: dashboardStatus,
      hardChecks,
      metrics: metricsRaw,
      baselineWTCount: baselineWTs.length,
      orderSimulation,
      extremes,
      warnings,
    };

    self.postMessage({ type: 'progress', phase: 5, progress: 100 } satisfies WorkerMessage);
    self.postMessage({ type: 'result', result: baseResult } satisfies WorkerMessage);
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerMessage);
  }
};
