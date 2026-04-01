/**
 * WTopti Groove Position Brute-Force Search
 *
 * Loads Phase 1+2 once (groove-independent), then sweeps:
 *   A. All valid KLEIN groove combos with GROSS fixed to current default
 *   B. All valid GROSS groove combos with KLEIN fixed to best from A
 *   C. Top-5 KLEIN × top-5 GROSS cross-validation
 *
 * Reference baseline: last run stored in the DB (not calculateBaseline).
 * M7 computed directly from wts + affinity pairs.
 * M9 computed from runOrderSimulation.meanPicks (no baseline wts needed).
 *
 * Time-box: 30 minutes. Run: npx tsx harness/groove_search.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

import { parseArtikel, parseBestellungen, parseBestand } from '../server/src/parser';
import { processPhase1 } from '../app/src/algorithm/phase1';
import { processPhase2 } from '../app/src/algorithm/phase2';
import { processPhase3 } from '../app/src/algorithm/phase3';
import { runHardChecks } from '../app/src/validation/hardChecks';
import { runOrderSimulation } from '../app/src/validation/orderSimulation';
import type { WTConfig, WT, AffinityPair } from '../app/src/types';
import type { AffinityResult } from '../app/src/algorithm/phase2';

// ── Config (mirrors UI defaults) ───────────────────────────────────────────
const config: WTConfig = {
  gewicht_hard_kg: 24,
  gewicht_soft_kg: 20,
  hoehe_limit_mm: 300,
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
  stock_multiplier: 1.0,
  min_active_months: 3,
};

const DEFAULT_KLEIN_GROOVES = [350];
const DEFAULT_GROSS_GROOVES = [100, 150, 200, 350];

const PROJECTS_DIR = path.resolve(__dirname, '../..');
const ARTIKEL_FILE      = path.join(PROJECTS_DIR, 'Artikeldimensionen.xlsx');
const BESTELLUNGEN_FILE = path.join(PROJECTS_DIR, 'Bestellungen.xlsx');
const BESTAND_FILE      = path.join(PROJECTS_DIR, 'Bestandsliste_13_03_2026.xls');
const DB_API            = 'http://localhost:3001/api/runs';

const TIME_LIMIT_MS = 30 * 60 * 1000;

// ── DB: fetch best run for reference ──────────────────────────────────────

interface DbRun {
  id: number;
  created_at: string;
  metrics: Array<{ id: string; value: number }> | null;
  stats: { wts_benoetigt: number } | null;
}

async function fetchBestRun(): Promise<DbRun | null> {
  return new Promise(resolve => {
    http.get(DB_API, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const runs: DbRun[] = JSON.parse(body);
          if (!runs.length) return resolve(null);
          // Pick run with best M9 (lowest picks per order)
          const valid = runs.filter(r => r.metrics?.some(m => m.id === 'M9'));
          if (!valid.length) return resolve(runs[0]);
          const best = valid.reduce((b, r) => {
            const bM9 = b.metrics!.find(m => m.id === 'M9')!.value;
            const rM9 = r.metrics!.find(m => m.id === 'M9')!.value;
            return rM9 < bM9 ? r : b;
          });
          resolve(best);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// ── Groove combo generation ────────────────────────────────────────────────

function generateGrooveCombos(wtDepth: number, step = 50, minZone = 90): number[][] {
  const positions: number[] = [];
  for (let p = step; p < wtDepth; p += step) positions.push(p);

  const valid: number[][] = [];

  function pick(startIdx: number, current: number[]) {
    // Check current combo validity
    if (current.length > 0) {
      const bounds = [0, ...current, wtDepth];
      let ok = true;
      for (let i = 1; i < bounds.length; i++) {
        if (bounds[i] - bounds[i - 1] < minZone) { ok = false; break; }
      }
      if (ok) valid.push([...current]);
    }
    // Continue extending
    for (let i = startIdx; i < positions.length; i++) {
      current.push(positions[i]);
      pick(i + 1, current);
      current.pop();
    }
  }

  pick(0, []);
  return valid;
}

// ── M7 + M9 computation (no baseline wts needed) ──────────────────────────

function computeM7(wts: WT[], pairs: AffinityPair[]): number {
  if (pairs.length === 0) return 0;
  const artToWTs = new Map<string, Set<string>>();
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      if (!artToWTs.has(pos.artikelnummer)) artToWTs.set(pos.artikelnummer, new Set());
      artToWTs.get(pos.artikelnummer)!.add(wt.id);
    }
  }
  let hits = 0;
  for (const { seed, partner } of pairs) {
    const wa = artToWTs.get(seed);
    const wb = artToWTs.get(partner);
    if (!wa || !wb) continue;
    for (const id of wa) if (wb.has(id)) { hits++; break; }
  }
  return hits / pairs.length;
}

// ── Single-config run ──────────────────────────────────────────────────────

interface RunResult {
  kleinGrooves: number[];
  grossGrooves: number[];
  wts: number;
  klein: number;
  gross: number;
  m7: number;
  m9: number;
  c1Pass: boolean;
  ms: number;
}

type Phase1Result = ReturnType<typeof processPhase1>;

function runConfig(
  kleinGrooves: number[],
  grossGrooves: number[],
  processed: Phase1Result['processed'],
  p2: AffinityResult,
  filteredBestellungen: Phase1Result['filteredBestellungen'],
  artikel: ReturnType<typeof parseArtikel>,
  storojetBestandList: Array<{ artikelnummer: string; bestand: number }>,
  excludedNrs: Set<string>,
): RunResult {
  const t0 = Date.now();
  const wts = processPhase3(processed, p2, config, { klein: kleinGrooves, gross: grossGrooves });
  const m7 = computeM7(wts, p2.pairs);
  // M9: pass empty baseline — we only use meanPicks (not baselineMeanPicks)
  const sim = runOrderSimulation(filteredBestellungen, wts, []);
  const m9 = sim.meanPicks;
  const hardChecks = runHardChecks(wts, artikel, storojetBestandList, excludedNrs);
  const c1 = hardChecks.find(c => c.id === 'C1');

  return {
    kleinGrooves, grossGrooves,
    wts: wts.length,
    klein: wts.filter(w => w.typ === 'KLEIN').length,
    gross: wts.filter(w => w.typ === 'GROSS').length,
    m7, m9,
    c1Pass: c1?.status === 'PASS',
    ms: Date.now() - t0,
  };
}

// ── Results reporting ──────────────────────────────────────────────────────

function printResults(
  results: RunResult[], title: string,
  refM7: number, refM9: number, refWTs: number,
  topN = 10,
) {
  const sorted = [...results].sort((a, b) => a.m9 - b.m9);
  const hr = '─'.repeat(108);
  console.log('\n' + '═'.repeat(108));
  console.log(`  ${title}  (top ${Math.min(topN, sorted.length)}, sorted M9 ↑)`);
  console.log(`  Reference (best DB run): WTs=${refWTs}  M7=${(refM7*100).toFixed(1)}%  M9=${refM9.toFixed(3)}`);
  console.log(hr);
  console.log(`  ${'#'.padEnd(4)} ${'KLEIN grooves'.padEnd(22)} ${'GROSS grooves'.padEnd(34)} ${'WTs'.padStart(5)} ${'ΔWTs'.padStart(6)} ${'M7'.padStart(7)} ${'ΔM7'.padStart(7)} ${'M9'.padStart(6)} ${'ΔM9'.padStart(7)} ${'C1'.padStart(3)}`);
  console.log(hr);
  for (let i = 0; i < Math.min(topN, sorted.length); i++) {
    const r = sorted[i];
    const kMark = JSON.stringify(r.kleinGrooves) === JSON.stringify(DEFAULT_KLEIN_GROOVES) ? '*' : ' ';
    const gMark = JSON.stringify(r.grossGrooves) === JSON.stringify(DEFAULT_GROSS_GROOVES) ? '*' : ' ';
    const dWTs = r.wts - refWTs;
    const dM7 = (r.m7 - refM7) * 100;
    const dM9 = r.m9 - refM9;
    const c1 = r.c1Pass ? '✓' : '✗';
    console.log(
      `  ${String(i+1).padEnd(4)}` +
      ` ${(kMark + '[' + r.kleinGrooves.join(',') + ']').padEnd(22)}` +
      ` ${(gMark + '[' + r.grossGrooves.join(',') + ']').padEnd(34)}` +
      ` ${String(r.wts).padStart(5)}` +
      ` ${(dWTs >= 0 ? '+' : '') + dWTs}`.padStart(7) +
      ` ${(r.m7*100).toFixed(1)+'%'}`.padStart(8) +
      ` ${(dM7 >= 0 ? '+' : '') + dM7.toFixed(1)+'pp'}`.padStart(8) +
      ` ${r.m9.toFixed(3)}`.padStart(7) +
      ` ${(dM9 >= 0 ? '+' : '') + dM9.toFixed(3)}`.padStart(8) +
      ` ${c1.padStart(3)}`,
    );
  }
  console.log(hr);
  console.log('  (* = current default grooves)');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  const timedOut = () => Date.now() - startMs >= TIME_LIMIT_MS;

  console.log('═'.repeat(80));
  console.log('  WTopti Groove Position Search');
  console.log('═'.repeat(80));

  // Fetch DB reference run
  console.log('\nFetching best run from DB...');
  const refRun = await fetchBestRun();
  const refM7  = refRun?.metrics?.find(m => m.id === 'M7')?.value ?? 0;
  const refM9  = refRun?.metrics?.find(m => m.id === 'M9')?.value ?? 999;
  const refWTs = refRun?.stats?.wts_benoetigt ?? 0;
  if (refRun) {
    console.log(`  Reference run #${refRun.id} (${refRun.created_at.slice(0,10)}): WTs=${refWTs}  M7=${(refM7*100).toFixed(1)}%  M9=${refM9.toFixed(3)}`);
  } else {
    console.log('  (no DB run found — deltas will show vs 0)');
  }

  // Load data
  console.log('\n[1/4] Loading Excel files...');
  const artikel      = parseArtikel(fs.readFileSync(ARTIKEL_FILE));
  const bestellungen = parseBestellungen(fs.readFileSync(BESTELLUNGEN_FILE));
  const bestand      = parseBestand(fs.readFileSync(BESTAND_FILE));
  console.log(`      Artikel=${artikel.length}  Bestellungen=${bestellungen.length}  Bestand=${bestand.length}`);

  // Phase 1
  console.log('\n[2/4] Phase 1...');
  const p1 = processPhase1(artikel, bestellungen, bestand, config);
  const { processed, filteredBestellungen } = p1;
  const excluded = p1.validation.exclusion_log ?? [];
  const storojetArts = processed.filter(a => a.bestand > 0);
  console.log(`      Processed=${processed.length}  STOROJET=${storojetArts.length}  Excluded=${excluded.length}`);

  // Phase 2
  console.log('\n[3/4] Phase 2...');
  const p2 = processPhase2(processed, filteredBestellungen, config);
  console.log(`      Pairs=${p2.pairs.length}  Groups=${p2.groupCount}  Singletons=${p2.singletonCount}`);

  const excludedNrs = new Set(excluded.map(e => e.artikelnummer));
  const storojetBestandList = processed
    .filter(a => a.bestand > 0)
    .map(a => ({ artikelnummer: String(a.artikelnummer), bestand: a.bestand }));

  // Generate combos (geometry is the only constraint)
  console.log('\n[4/4] Generating groove combos...');
  const kleinCombos = generateGrooveCombos(500);
  const grossCombos = generateGrooveCombos(800);
  console.log(`      KLEIN: ${kleinCombos.length} valid combos  GROSS: ${grossCombos.length} valid combos`);
  console.log(`      Estimated runs: ${kleinCombos.length} + ${grossCombos.length} + ≤25 cross`);
  console.log(`      Time limit: 30 min`);

  const run = (k: number[], g: number[]) => runConfig(
    k, g, processed, p2, filteredBestellungen, artikel, storojetBestandList, excludedNrs,
  );

  // ── A: KLEIN sweep (GROSS = default) ──────────────────────────────────
  console.log('\n  [A] KLEIN sweep (GROSS=default)');
  const kleinResults: RunResult[] = [];
  for (let i = 0; i < kleinCombos.length; i++) {
    if (timedOut()) { console.log(`  ⏱ Timeout after ${i} KLEIN runs`); break; }
    kleinResults.push(run(kleinCombos[i], DEFAULT_GROSS_GROOVES));
    if ((i + 1) % 5 === 0 || i === kleinCombos.length - 1) {
      const b = [...kleinResults].sort((a, b) => a.m9 - b.m9)[0];
      process.stdout.write(`\r    [${i+1}/${kleinCombos.length}] best M9=${b.m9.toFixed(3)} M7=${(b.m7*100).toFixed(1)}% WTs=${b.wts} K=[${b.kleinGrooves}]   `);
    }
  }
  console.log();

  const bestKlein = kleinResults.length > 0
    ? [...kleinResults].sort((a, b) => a.m9 - b.m9)[0].kleinGrooves
    : DEFAULT_KLEIN_GROOVES;
  console.log(`  Best KLEIN: [${bestKlein}]`);

  // ── B: GROSS sweep (KLEIN = best from A) ──────────────────────────────
  console.log(`\n  [B] GROSS sweep (KLEIN=[${bestKlein}])`);
  const grossResults: RunResult[] = [];
  for (let i = 0; i < grossCombos.length; i++) {
    if (timedOut()) { console.log(`\n  ⏱ Timeout after ${i} GROSS runs`); break; }
    grossResults.push(run(bestKlein, grossCombos[i]));
    if ((i + 1) % 50 === 0 || i === grossCombos.length - 1) {
      const b = [...grossResults].sort((a, b) => a.m9 - b.m9)[0];
      process.stdout.write(`\r    [${i+1}/${grossCombos.length}] best M9=${b.m9.toFixed(3)} M7=${(b.m7*100).toFixed(1)}% WTs=${b.wts} G=[${b.grossGrooves}]   `);
    }
  }
  console.log();

  const bestGross = grossResults.length > 0
    ? [...grossResults].sort((a, b) => a.m9 - b.m9)[0].grossGrooves
    : DEFAULT_GROSS_GROOVES;
  console.log(`  Best GROSS: [${bestGross}]`);

  // ── C: Cross-validation top-5 × top-5 ────────────────────────────────
  const crossResults: RunResult[] = [];
  if (!timedOut()) {
    console.log('\n  [C] Cross-validation (top-5 KLEIN × top-5 GROSS)');
    const top5K = [...kleinResults].sort((a, b) => a.m9 - b.m9).slice(0, 5).map(r => r.kleinGrooves);
    const top5G = [...grossResults].sort((a, b) => a.m9 - b.m9).slice(0, 5).map(r => r.grossGrooves);
    const seen = new Set<string>();
    for (const kr of [...kleinResults, ...grossResults]) {
      seen.add(JSON.stringify(kr.kleinGrooves) + '|' + JSON.stringify(kr.grossGrooves));
    }
    let n = 0;
    for (const k of top5K) {
      for (const g of top5G) {
        if (timedOut()) break;
        const key = JSON.stringify(k) + '|' + JSON.stringify(g);
        if (seen.has(key)) continue;
        crossResults.push(run(k, g));
        seen.add(key);
        n++;
      }
    }
    console.log(`    ${n} new combos run`);
  }

  // Ensure current default is included
  const allResults = [...kleinResults, ...grossResults, ...crossResults];
  const defaultKey = JSON.stringify(DEFAULT_KLEIN_GROOVES) + '|' + JSON.stringify(DEFAULT_GROSS_GROOVES);
  const seenKeys = new Set(allResults.map(r => JSON.stringify(r.kleinGrooves) + '|' + JSON.stringify(r.grossGrooves)));
  if (!seenKeys.has(defaultKey)) {
    allResults.push(run(DEFAULT_KLEIN_GROOVES, DEFAULT_GROSS_GROOVES));
  }

  const elapsed = Math.round((Date.now() - startMs) / 1000);
  console.log(`\n  Done. ${allResults.length} configs in ${elapsed}s.`);

  // ── Print tables ──────────────────────────────────────────────────────
  printResults(allResults, 'ALL CONFIGS (top 15)', refM7, refM9, refWTs, 15);

  const kleinOnly = allResults.filter(
    r => JSON.stringify(r.grossGrooves) === JSON.stringify(DEFAULT_GROSS_GROOVES),
  );
  const grossOnly = allResults.filter(
    r => JSON.stringify(r.kleinGrooves) === JSON.stringify(bestKlein),
  );

  if (kleinOnly.length > 1)
    printResults(kleinOnly, `KLEIN SWEEP — GROSS=[${DEFAULT_GROSS_GROOVES}]`, refM7, refM9, refWTs);
  if (grossOnly.length > 1)
    printResults(grossOnly, `GROSS SWEEP — KLEIN=[${bestKlein}]`, refM7, refM9, refWTs);
  if (crossResults.length > 0)
    printResults(crossResults, 'CROSS-VALIDATION', refM7, refM9, refWTs);
}

main().catch(console.error);
