import type { ArtikelProcessed, WTConfig, WT, WTTyp } from '../types';
import type { ClusterResult } from './phase2';

function calcNutzflaeche(wtTyp: WTTyp, anzahlArtikelTypen: number, config: WTConfig): number {
  const brutto = wtTyp === 'KLEIN' ? 250_000 : 400_000;
  const teilerAnzahl = Math.max(0, anzahlArtikelTypen - 1);
  if (config.teiler_modus === 'exact') {
    const verlust = teilerAnzahl * config.teiler_breite_mm * 500; // 500mm WT-Breite
    return brutto - verlust;
  } else {
    const verlustProzent = teilerAnzahl * config.teiler_verlust_prozent / 100;
    return brutto * (1 - verlustProzent);
  }
}

function chooseWTTyp(clusterArticles: ArtikelProcessed[]): WTTyp {
  const maxFlaeche = Math.max(...clusterArticles.map(a => a.grundflaeche_mm2));
  if (maxFlaeche > 200_000) return 'GROSS';

  // Check if utilization would be better with large WT
  const totalFlaeche = clusterArticles.reduce((s, a) => s + a.grundflaeche_mm2, 0);
  const kleinNutz = 250_000;
  if (totalFlaeche / kleinNutz > 0.65) return 'GROSS';

  return 'KLEIN';
}

function createWT(id: string, typ: WTTyp, clusterId: number): WT {
  const brutto = typ === 'KLEIN' ? 250_000 : 400_000;
  return {
    id,
    typ,
    positionen: [],
    cluster_id: clusterId,
    gesamtgewicht_kg: 0,
    flaeche_brutto_mm2: brutto,
    flaeche_netto_mm2: brutto,
    flaeche_netto_pct: 0,
    anzahl_teiler: 0,
    gewicht_status: 'ok',
  };
}

function belegteFlaeche(wt: WT): number {
  return wt.positionen.reduce((s, p) => s + p.grundflaeche_mm2 * p.stueckzahl, 0);
}

function updateWTMetrics(wt: WT, config: WTConfig): void {
  const artikelTypen = new Set(wt.positionen.map(p => p.artikelnummer)).size;
  wt.anzahl_teiler = Math.max(0, artikelTypen - 1);
  wt.flaeche_netto_mm2 = calcNutzflaeche(wt.typ, artikelTypen, config);
  const belegt = belegteFlaeche(wt);
  wt.flaeche_netto_pct = wt.flaeche_netto_mm2 > 0
    ? Math.round((belegt / wt.flaeche_netto_mm2) * 10000) / 100
    : 0;
  wt.gesamtgewicht_kg = wt.positionen.reduce((s, p) => s + p.gewicht_kg * p.stueckzahl, 0);
  wt.gesamtgewicht_kg = Math.round(wt.gesamtgewicht_kg * 100) / 100;

  if (wt.gesamtgewicht_kg > config.gewicht_hard_kg) {
    wt.gewicht_status = 'hard_fail';
  } else if (wt.gesamtgewicht_kg > config.gewicht_soft_kg) {
    wt.gewicht_status = 'soft_warn';
  } else {
    wt.gewicht_status = 'ok';
  }
}

function canFit(
  wt: WT,
  artikel: ArtikelProcessed,
  stueckzahl: number,
  config: WTConfig,
): boolean {
  // Compute what nutzflaeche would be with potentially one more article type
  const existingTypes = new Set(wt.positionen.map(p => p.artikelnummer));
  const newTypeCount = existingTypes.has(String(artikel.artikelnummer))
    ? existingTypes.size
    : existingTypes.size + 1;
  const nutzflaeche = calcNutzflaeche(wt.typ, newTypeCount, config);

  const currentBelegt = belegteFlaeche(wt);
  const neededFlaeche = artikel.grundflaeche_mm2 * stueckzahl;
  if (currentBelegt + neededFlaeche > nutzflaeche) return false;

  const currentWeight = wt.positionen.reduce((s, p) => s + p.gewicht_kg * p.stueckzahl, 0);
  if (currentWeight + stueckzahl * artikel.gewicht_kg > config.gewicht_hard_kg) return false;

  if (artikel.hoehe > config.hoehe_limit_mm) return false;

  return true;
}

export function processPhase3(
  processed: ArtikelProcessed[],
  _clusters: ClusterResult,
  config: WTConfig,
): WT[] {
  const allWTs: WT[] = [];
  let kleinCounter = 0;
  let grossCounter = 0;

  // Group articles by cluster
  const clusterGroups = new Map<number, ArtikelProcessed[]>();
  for (const art of processed) {
    const cid = art.cluster_id ?? 0;
    if (!clusterGroups.has(cid)) clusterGroups.set(cid, []);
    clusterGroups.get(cid)!.push(art);
  }

  for (const [clusterId, articles] of clusterGroups) {
    const wtTyp = chooseWTTyp(articles);

    // Sort by grundflaeche descending (First Fit Decreasing)
    const sorted = [...articles].sort((a, b) => b.grundflaeche_mm2 - a.grundflaeche_mm2);

    const clusterWTs: WT[] = [];

    for (const artikel of sorted) {
      // Skip non-storable articles
      if (artikel.hoehe > config.hoehe_limit_mm) continue;
      if (artikel.grundflaeche_mm2 <= 0) continue;

      let remaining = artikel.bestand;

      while (remaining > 0) {
        // How many can stack in one position
        const maxStack = artikel.max_stapelhoehe > 0 ? artikel.max_stapelhoehe : 1;

        // Try to fit on existing WT
        let placed = false;
        for (const wt of clusterWTs) {
          // Try different amounts from maxStack down to 1
          const tryCount = Math.min(remaining, maxStack);
          if (canFit(wt, artikel, tryCount, config)) {
            wt.positionen.push({
              artikelnummer: String(artikel.artikelnummer),
              bezeichnung: artikel.bezeichnung,
              stueckzahl: tryCount,
              grundflaeche_mm2: artikel.grundflaeche_mm2,
              gewicht_kg: artikel.gewicht_kg,
              abc_klasse: artikel.abc_klasse,
            });
            updateWTMetrics(wt, config);
            remaining -= tryCount;
            placed = true;
            break;
          }
          // Try with just 1 if maxStack didn't fit
          if (tryCount > 1 && canFit(wt, artikel, 1, config)) {
            wt.positionen.push({
              artikelnummer: String(artikel.artikelnummer),
              bezeichnung: artikel.bezeichnung,
              stueckzahl: 1,
              grundflaeche_mm2: artikel.grundflaeche_mm2,
              gewicht_kg: artikel.gewicht_kg,
              abc_klasse: artikel.abc_klasse,
            });
            updateWTMetrics(wt, config);
            remaining -= 1;
            placed = true;
            break;
          }
        }

        if (!placed) {
          // Open new WT
          let id: string;
          if (wtTyp === 'KLEIN') {
            kleinCounter++;
            id = `K-${String(kleinCounter).padStart(4, '0')}`;
          } else {
            grossCounter++;
            id = `G-${String(grossCounter).padStart(4, '0')}`;
          }
          const newWT = createWT(id, wtTyp, clusterId);
          const tryCount = Math.min(remaining, maxStack);
          newWT.positionen.push({
            artikelnummer: String(artikel.artikelnummer),
            bezeichnung: artikel.bezeichnung,
            stueckzahl: tryCount,
            grundflaeche_mm2: artikel.grundflaeche_mm2,
            gewicht_kg: artikel.gewicht_kg,
            abc_klasse: artikel.abc_klasse,
          });
          updateWTMetrics(newWT, config);
          clusterWTs.push(newWT);
          remaining -= tryCount;
        }
      }
    }

    allWTs.push(...clusterWTs);
  }

  // Weight balancing: try to move lightest position from overweight WTs
  for (const wt of allWTs) {
    if (wt.gesamtgewicht_kg <= config.gewicht_soft_kg) continue;
    if (wt.positionen.length <= 1) continue;

    // Find lightest position
    const sorted = [...wt.positionen].sort(
      (a, b) => a.gewicht_kg * a.stueckzahl - b.gewicht_kg * b.stueckzahl,
    );
    const lightest = sorted[0];

    // Find another WT in same cluster that can take it
    const sameCluster = allWTs.filter(
      w => w.cluster_id === wt.cluster_id && w.id !== wt.id,
    );
    for (const target of sameCluster) {
      const targetWeight = target.gesamtgewicht_kg + lightest.gewicht_kg * lightest.stueckzahl;
      if (targetWeight <= config.gewicht_hard_kg) {
        // Move position
        const idx = wt.positionen.indexOf(lightest);
        if (idx >= 0) {
          wt.positionen.splice(idx, 1);
          target.positionen.push(lightest);
          updateWTMetrics(wt, config);
          updateWTMetrics(target, config);
          break;
        }
      }
    }
  }

  return allWTs;
}
