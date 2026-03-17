import { processPhase1 } from '../algorithm/phase1';
import { processPhase2 } from '../algorithm/phase2';
import { processPhase3 } from '../algorithm/phase3';
import { processPhase4 } from '../algorithm/phase4';
import { processPhase5 } from '../algorithm/phase5';
import type {
  ArtikelData,
  BestellungData,
  BestandData,
  WTConfig,
  OptimizationResult,
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

    const phase2Result = processPhase2(phase1Result.processed, bestellungen, config);
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

    // Build belegungsplan
    const belegungsplan = wts.flatMap(wt =>
      wt.positionen.map(pos => ({
        warentraeger_id: wt.id,
        warentraeger_typ: wt.typ,
        artikelnummer: pos.artikelnummer,
        bezeichnung: pos.bezeichnung,
        stueckzahl: pos.stueckzahl,
        cluster_id: wt.cluster_id,
        abc_klasse: pos.abc_klasse,
        gesamtgewicht_kg: wt.gesamtgewicht_kg,
        flaeche_netto_pct: wt.flaeche_netto_pct,
        anzahl_teiler: wt.anzahl_teiler,
      })),
    );

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
    };

    const baseResult: OptimizationResult = {
      wts,
      belegungsplan,
      szenarien: [],
      validation,
      stats: {
        artikel_gesamt: artikel.length,
        artikel_platziert: new Set(belegungsplan.map(b => b.artikelnummer)).size,
        wts_benoetigt: wts.length,
        wts_klein: wts.filter(w => w.typ === 'KLEIN').length,
        wts_gross: wts.filter(w => w.typ === 'GROSS').length,
        gesamtbestand: bestand.reduce((s, b) => s + (b.bestand || 0), 0),
      },
    };

    const runPipeline = (cfg: WTConfig): OptimizationResult => {
      const r1 = processPhase1(artikel, bestellungen, bestand, cfg);
      const r2 = processPhase2(r1.processed, bestellungen, cfg);
      const w = processPhase3(r1.processed, r2, cfg);
      return { ...baseResult, wts: w };
    };

    const szenarien = processPhase5(baseResult, config, runPipeline);
    baseResult.szenarien = szenarien;

    self.postMessage({ type: 'progress', phase: 5, progress: 100 } satisfies WorkerMessage);
    self.postMessage({ type: 'result', result: baseResult } satisfies WorkerMessage);
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerMessage);
  }
};
