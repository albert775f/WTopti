/**
 * WTopti CLI Harness
 * Run: ts-node --transpile-only --project tsconfig.json run.ts [bestand_path]
 *
 * Loads Artikeldimensionen.xlsx + Bestellungen.xlsx + Bestandsliste from the projects/ dir,
 * runs all 5 phases, and prints a validation report focused on M7 and M9.
 */
import * as fs from 'fs';
import * as path from 'path';

import { parseArtikel, parseBestellungen, parseBestand } from '../server/src/parser';
import { processPhase1 } from '../app/src/algorithm/phase1';
import { processPhase2 } from '../app/src/algorithm/phase2';
import { processPhase3 } from '../app/src/algorithm/phase3';
import { calculateBaseline } from '../app/src/validation/baseline';
import { runHardChecks } from '../app/src/validation/hardChecks';
import { calculateMetrics } from '../app/src/validation/metrics';
import { runOrderSimulation } from '../app/src/validation/orderSimulation';
import { DEFAULT_THRESHOLDS } from '../app/src/validation/thresholds';
import type { WTConfig } from '../app/src/types';

// ── Config (mirrors UI defaults) ───────────────────────────────────────────
const config: WTConfig = {
  gewicht_hard_kg: 24,
  gewicht_soft_kg: 20,
  hoehe_limit_mm: 320,
  teiler_breite_mm: 5,
  warehouse_area_m2: 1480.65,
  min_segment_mm: 90,
  griff_puffer_mm: 0,
  affinity_threshold: 0.15,
  affinity_min_count: 5,
  affinity_min_orders_a: 10,
  refill_weeks: 5,
  exclude_prefixes: ['VML', 'VMB', 'SAM', 'OEM', 'SON'],
  min_order_count: 5,
  bulk_top3_threshold: 0.50,
};

// ── Data paths ─────────────────────────────────────────────────────────────
const PROJECTS_DIR = path.resolve(__dirname, '../..');
const ARTIKEL_FILE    = path.join(PROJECTS_DIR, 'Artikeldimensionen.xlsx');
const BESTELLUNGEN_FILE = path.join(PROJECTS_DIR, 'Bestellungen.xlsx');
const BESTAND_FILE    = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(PROJECTS_DIR, 'Bestandsliste_13_03_2026.xls');

// ── Helpers ────────────────────────────────────────────────────────────────
const hr = (char = '─') => char.repeat(62);
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const ampelChar = (a: string) => a === 'green' ? '✓' : a === 'yellow' ? '~' : '✗';

function main() {
  console.log(hr('═'));
  console.log('  WTopti CLI Harness');
  console.log(`  Bestand: ${BESTAND_FILE}`);
  console.log(hr('═'));

  // ── Step 1: Load Excel ────────────────────────────────────────────────────
  console.log('\n[1/4] Loading Excel files...');
  const artikel    = parseArtikel(fs.readFileSync(ARTIKEL_FILE));
  const bestellungen = parseBestellungen(fs.readFileSync(BESTELLUNGEN_FILE));
  const bestand    = parseBestand(fs.readFileSync(BESTAND_FILE));
  console.log(`      Artikel=${artikel.length}  Bestellungen=${bestellungen.length}  Bestand=${bestand.length}`);

  // ── Step 2: Phase 1 ────────────────────────────────────────────────────────
  console.log('\n[2/4] Phase 1 — Data prep + ABC...');
  const p1 = processPhase1(artikel, bestellungen, bestand, config);
  const { processed, filteredBestellungen } = p1;
  const storojetArts = processed.filter(a => a.bestand > 0);
  const storojetBestand = storojetArts.reduce((s, a) => s + a.bestand, 0);
  const excluded = p1.validation.exclusion_log ?? [];
  console.log(`      Processed=${processed.length}  STOROJET=${storojetArts.length}  Excluded=${excluded.length}`);
  console.log(`      Bestand STOROJET=${storojetBestand.toLocaleString()} Stk`);
  console.log(`      ABC: A=${processed.filter(a=>a.abc_klasse==='A').length}  B=${processed.filter(a=>a.abc_klasse==='B').length}  C=${processed.filter(a=>a.abc_klasse==='C').length}`);
  if (p1.validation.hard_fails.length > 0) {
    console.log(`      ⚠ Phase-1 hard fails: ${p1.validation.hard_fails.join(', ')}`);
  }

  // ── Step 3: Phase 2 ────────────────────────────────────────────────────────
  console.log('\n[3/4] Phase 2 — Affinity analysis...');
  const p2 = processPhase2(processed, filteredBestellungen, config);
  const withPartners = [...p2.partnerIndex.values()].filter(v => v.length > 0).length;
  console.log(`      Pairs=${p2.pairs.length}  Articles-with-partners=${withPartners}  Groups=${p2.groupCount}  Singletons=${p2.singletonCount}`);

  // ── Step 4: Phase 3 ────────────────────────────────────────────────────────
  console.log('\n[4/4] Phase 3 — Bin packing...');
  const t0 = Date.now();
  const wts = processPhase3(processed, p2, config);
  const elapsed = Date.now() - t0;

  const klein = wts.filter(w => w.typ === 'KLEIN').length;
  const gross = wts.filter(w => w.typ === 'GROSS').length;
  const modeA = wts.filter(w => w.mode === 'A').length;
  const modeB = wts.filter(w => w.mode === 'B').length;
  const placedArts = new Set(wts.flatMap(w => w.positionen.map(p => p.artikelnummer)));
  const placedBestand = wts.flatMap(w => w.positionen).reduce((s, p) => s + p.stueckzahl, 0);
  console.log(`      Done in ${elapsed}ms`);
  console.log(`      WTs=${wts.length} (KLEIN=${klein}, GROSS=${gross}, Mode-A=${modeA}, Mode-B=${modeB})`);
  console.log(`      Articles placed=${placedArts.size}/${storojetArts.length}  Bestand=${placedBestand.toLocaleString()}/${storojetBestand.toLocaleString()}`);

  // ── Validation ─────────────────────────────────────────────────────────────
  const { wts: baselineWTs } = calculateBaseline(processed, config);
  const excludedNrs = new Set(excluded.map(e => e.artikelnummer));
  // C1 must compare against storojet bestand (phase1-capped), not raw file bestand
  const storojetBestandList = processed
    .filter(a => a.bestand > 0)
    .map(a => ({ artikelnummer: String(a.artikelnummer), bestand: a.bestand }));
  const hardChecks = runHardChecks(wts, artikel, storojetBestandList, excludedNrs);
  const orderSim = runOrderSimulation(filteredBestellungen, wts, baselineWTs);
  const metrics = calculateMetrics(
    wts, baselineWTs, processed, filteredBestellungen,
    p2.pairs, p2.coMatrix, DEFAULT_THRESHOLDS,
    orderSim.meanPicks, orderSim.baselineMeanPicks,
  );

  // ── Hard Checks ─────────────────────────────────────────────────────────────
  console.log('\n' + hr('═'));
  console.log('  HARD CHECKS');
  console.log(hr());
  for (const c of hardChecks) {
    const icon = c.status === 'PASS' ? '✓' : '✗';
    const errs = c.errorCount > 0 ? `  (${c.errorCount} errors)` : '';
    console.log(`  ${icon} ${c.id}: ${pad(c.name, 35)}${errs}`);
    if (c.status === 'FAIL') {
      for (const d of c.details.slice(0, 5)) {
        console.log(`        → ${d.message}`);
      }
      if (c.details.length > 5) console.log(`        … +${c.details.length - 5} more`);
    }
  }

  // ── Key Metrics ────────────────────────────────────────────────────────────
  console.log('\n' + hr('═'));
  console.log('  METRICS  (actual vs baseline)');
  console.log(hr());
  for (const m of metrics) {
    const isKey = ['M1', 'M2', 'M7', 'M9'].includes(m.id);
    const valStr = m.unit === '%' ? pct(m.value) : m.value.toFixed(2);
    const baseStr = m.unit === '%' ? pct(m.baseline) : m.baseline.toFixed(2);
    const deltaNum = m.delta * (m.unit === '%' ? 100 : 1);
    const deltaStr = (deltaNum >= 0 ? '+' : '') + deltaNum.toFixed(1) + (m.unit === '%' ? 'pp' : '');
    const icon = ampelChar(m.ampel);
    const mark = isKey ? '►' : ' ';
    console.log(`  ${mark} ${icon} ${m.id}  ${pad(m.name, 28)} ${valStr.padStart(8)}  vs ${baseStr.padStart(8)}  Δ ${deltaStr}`);
  }

  // ── Primary Targets ────────────────────────────────────────────────────────
  console.log('\n' + hr('═'));
  console.log('  PRIMARY TARGETS');
  console.log(hr());
  const m7 = metrics.find(m => m.id === 'M7')!;
  const m9 = metrics.find(m => m.id === 'M9')!;
  const m7pct = (m7.value * 100).toFixed(1);
  const m7ok = m7.value >= 0.90 ? '✓' : m7.value >= 0.70 ? '~' : '✗';
  const m9ok = m9.value <= 3.5 ? '✓' : m9.value <= 4.5 ? '~' : '✗';
  console.log(`  ${m7ok} M7 Co-Location Hit Rate:  ${m7pct}%   (target ≥90%, theoretical max ~97%)`);
  console.log(`  ${m9ok} M9 Picks per Order:       ${m9.value.toFixed(2)}    (target ~3.2, baseline ${orderSim.baselineMeanPicks.toFixed(2)})`);

  // ── WT Structure ──────────────────────────────────────────────────────────
  console.log('\n' + hr('═'));
  console.log('  WT STRUCTURE');
  console.log(hr());

  // Zone depth histogram
  const allDepths = wts.flatMap(w => w.zone_depths_mm);
  const SEGS = [100, 150, 200, 350];
  const buckets: Record<number, number> = {};
  let fullCount = 0;
  for (const d of allDepths) {
    const nearest = SEGS.reduce((best, s) => Math.abs(s - d) < Math.abs(best - d) ? s : best, 9999);
    if (nearest === 9999 || d > 350) fullCount++;
    else buckets[nearest] = (buckets[nearest] ?? 0) + 1;
  }
  console.log('  Zone depth histogram:');
  for (const s of SEGS) {
    if (buckets[s]) console.log(`    ${s}mm: ${buckets[s]} zones`);
  }
  if (fullCount) console.log(`    >350mm (full): ${fullCount} zones`);

  // Articles per WT distribution
  const hist: Record<number, number> = {};
  for (const wt of wts) {
    const n = wt.positionen.length;
    hist[n] = (hist[n] ?? 0) + 1;
  }
  const avgPos = (wts.reduce((s, w) => s + w.positionen.length, 0) / wts.length).toFixed(2);
  console.log(`\n  Articles/WT distribution (avg=${avgPos}):`);
  for (const k of Object.keys(hist).map(Number).sort((a,b)=>a-b)) {
    const bar = '█'.repeat(Math.round(hist[k] / wts.length * 40));
    console.log(`    ${String(k).padStart(2)}: ${String(hist[k]).padStart(4)} WTs  ${bar}`);
  }

  // Overweight
  const overweight = wts.filter(w => w.gesamtgewicht_kg > config.gewicht_hard_kg);
  const softWarn   = wts.filter(w => w.gesamtgewicht_kg > config.gewicht_soft_kg && w.gesamtgewicht_kg <= config.gewicht_hard_kg);
  console.log(`\n  Overweight (>${config.gewicht_hard_kg}kg): ${overweight.length}`);
  console.log(`  Soft-warn  (${config.gewicht_soft_kg}-${config.gewicht_hard_kg}kg): ${softWarn.length}`);
  if (overweight.length > 0) {
    for (const wt of overweight.slice(0, 5)) {
      console.log(`    ${wt.id}: ${wt.gesamtgewicht_kg.toFixed(1)}kg  [${wt.positionen.map(p=>p.artikelnummer).join(', ')}]`);
    }
    if (overweight.length > 5) console.log(`    … +${overweight.length - 5} more`);
  }

  // ── M7 Diagnostics ────────────────────────────────────────────────────────
  console.log('\n' + hr('═'));
  console.log('  M7 DIAGNOSTICS');
  console.log(hr());
  {
    const artToWTs = new Map<string, Set<string>>();
    for (const wt of wts) {
      for (const pos of wt.positionen) {
        if (!artToWTs.has(pos.artikelnummer)) artToWTs.set(pos.artikelnummer, new Set());
        artToWTs.get(pos.artikelnummer)!.add(wt.id);
      }
    }
    const sharesWT = (a: string, b: string) => {
      const wa = artToWTs.get(a); const wb = artToWTs.get(b);
      if (!wa || !wb) return false;
      for (const id of wa) if (wb.has(id)) return true;
      return false;
    };

    let bothPlaced = 0, colocated = 0, seedMissing = 0, partnerMissing = 0;
    const missExamples: string[] = [];
    for (const pair of p2.pairs) {
      const seedOnWT = artToWTs.has(pair.seed);
      const partnerOnWT = artToWTs.has(pair.partner);
      if (!seedOnWT) { seedMissing++; continue; }
      if (!partnerOnWT) { partnerMissing++; continue; }
      bothPlaced++;
      if (sharesWT(pair.seed, pair.partner)) {
        colocated++;
      } else if (missExamples.length < 5) {
        const seedWTs = [...(artToWTs.get(pair.seed) ?? [])].slice(0, 3).join(',');
        const partnerWTs = [...(artToWTs.get(pair.partner) ?? [])].slice(0, 3).join(',');
        missExamples.push(`  (${pair.seed}→${pair.partner}) P=${pair.pGivenSeed.toFixed(2)}  seed WTs=[${seedWTs}]  partner WTs=[${partnerWTs}]`);
      }
    }
    console.log(`  Total pairs:      ${p2.pairs.length}`);
    console.log(`  Seed missing:     ${seedMissing}   (article not placed at all)`);
    console.log(`  Partner missing:  ${partnerMissing}  (partner not placed at all)`);
    console.log(`  Both placed:      ${bothPlaced}`);
    console.log(`  Co-located:       ${colocated}  (${bothPlaced > 0 ? (colocated/bothPlaced*100).toFixed(1) : 0}% of placed pairs)`);
    console.log(`  NOT co-located:   ${bothPlaced - colocated}`);
    if (missExamples.length > 0) {
      console.log('\n  Sample non-co-located pairs (seed→partner):');
      for (const ex of missExamples) console.log(ex);
    }

    const missPairs = p2.pairs.filter(pair =>
      artToWTs.has(pair.seed) && artToWTs.has(pair.partner) && !sharesWT(pair.seed, pair.partner)
    );

    // Show WT distribution for a sample non-co-located pair
    const sampleMissPairs = missPairs.slice(0, 1);
    for (const pair of sampleMissPairs) {
      const seedWTList = [...(artToWTs.get(pair.seed) ?? [])];
      const partnerWTList = [...(artToWTs.get(pair.partner) ?? [])];
      console.log(`\n  Deep dive on (${pair.seed}→${pair.partner}):`);
      console.log(`    Seed on ${seedWTList.length} WTs, Partner on ${partnerWTList.length} WTs`);
      const seedSample = seedWTList.slice(0, 3).map(id => {
        const wt = wts.find(w => w.id === id)!;
        return `${id}(${wt.typ},${wt.mode},rows=${wt.zone_depths_mm.length},arts=[${wt.positionen.map(p=>p.artikelnummer).join(',')}])`;
      });
      const partnerSample = partnerWTList.slice(0, 3).map(id => {
        const wt = wts.find(w => w.id === id)!;
        return `${id}(${wt.typ},${wt.mode},rows=${wt.zone_depths_mm.length},arts=[${wt.positionen.map(p=>p.artikelnummer).join(',')}])`;
      });
      console.log(`    Seed WTs:    ${seedSample.join('\n                 ')}`);
      console.log(`    Partner WTs: ${partnerSample.join('\n                 ')}`);
    }
  }

  // ── Exclusion breakdown ────────────────────────────────────────────────────
  if (excluded.length > 0) {
    console.log('\n' + hr('═'));
    console.log('  EXCLUSION BREAKDOWN');
    console.log(hr());
    const byReason: Record<string, number> = {};
    for (const e of excluded) byReason[e.exclusion_reason] = (byReason[e.exclusion_reason] ?? 0) + 1;
    for (const [reason, cnt] of Object.entries(byReason).sort((a,b)=>b[1]-a[1])) {
      console.log(`  ${pad(reason, 25)} ${cnt}`);
    }
  }

  // ── Final verdict ──────────────────────────────────────────────────────────
  console.log('\n' + hr('═'));
  const hasFail = hardChecks.some(c => c.status === 'FAIL');
  const m7Miss  = m7.value < 0.70;
  const status  = hasFail || m7Miss ? 'FAILED' : m7.value < 0.90 ? 'WARNING' : 'PASSED';
  console.log(`  ${status === 'PASSED' ? '✓' : '✗'} RESULT: ${status}`);
  console.log(hr('═') + '\n');

  process.exit(hasFail ? 1 : 0);
}

main();
