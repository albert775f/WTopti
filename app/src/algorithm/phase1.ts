import type {
  ArtikelData,
  BestellungData,
  BestandData,
  ArtikelProcessed,
  WTConfig,
  ValidationResult,
  ExclusionLogEntry,
} from '../types';

/** Fallback history window (weeks) when Bestellungen contain no parseable dates. */
const HISTORY_WEEKS_FALLBACK = 52;

/**
 * Phase 1: Data preparation + ABC classification.
 *
 * Filter chain:
 *   Filter 1:  Remove SON articles from order history
 *   Filter 1b: Remove VML/VMB/SAM/OEM prefix orders from order history
 *   Filter 1c: Exclude Artikelliste articles with VML/VMB/SAM/OEM prefix → PREFIX_EXCLUDED
 *   Filter 2:  Bestand articles without Artikelliste entry → NO_MASTER_RECORD
 *   Filter 3:  SPERRGUT
 *   Filter 4:  HEIGHT_EXCEEDED
 *   Filter 5:  WEIGHT_EXCEEDED
 *   Filter 6:  DIMENSIONS_MISSING
 *   Filter 7:  WEIGHT_MISSING
 *   Filter 8:  order_count < min_order_count → LOW_FREQUENCY
 *   Post-ABC:  Bestandsdeckelung → bestand_storojet = peak month menge (median for bulk), capped by bestand_gesamt
 *
 * Returns filteredBestellungen (SON + prefix free) for use in Phase 2.
 */
export function processPhase1(
  artikel: ArtikelData[],
  bestellungen: BestellungData[],
  bestand: BestandData[],
  config: WTConfig,
): { processed: ArtikelProcessed[]; validation: ValidationResult; filteredBestellungen: BestellungData[] } {
  const exclusionLog: ExclusionLogEntry[] = [];

  const validation: ValidationResult = {
    hard_fails: [],
    warnungen: [],
    artikel_nicht_lagerfaehig: [],
    artikel_unvollstaendig: [],
    artikel_ohne_match: [],
    exclusion_log: exclusionLog,
  };

  // ---- Filter 1: Remove SON articles from order history ----
  let filteredBestellungen: BestellungData[] = [];
  const sonArticles = new Map<string, string>(); // artikelnummer → first bezeichnung seen
  for (const b of bestellungen) {
    const bez = b.bezeichnung ?? '';
    if (bez.startsWith('SON ')) {
      if (!sonArticles.has(String(b.artikelnummer))) {
        sonArticles.set(String(b.artikelnummer), bez);
      }
    } else {
      filteredBestellungen.push(b);
    }
  }
  for (const [artNr, bez] of sonArticles) {
    exclusionLog.push({
      artikelnummer: artNr,
      bezeichnung: bez || '— unknown —',
      exclusion_reason: 'SON_ARTICLE',
      exclusion_phase: 'FILTER',
      bestand: 0,
      detail: 'Bezeichnung beginnt mit "SON "',
    });
  }

  // Build bestand lookup
  const bestandMap = new Map<string, number>();
  for (const b of bestand) {
    bestandMap.set(String(b.artikelnummer), b.bestand);
  }

  // Also detect SON articles directly from Artikelliste (may have stock but no orders)
  for (const art of artikel) {
    const artNr = String(art.artikelnummer);
    const bez = art.bezeichnung ?? '';
    if (bez.startsWith('SON ') && !sonArticles.has(artNr)) {
      sonArticles.set(artNr, bez);
      exclusionLog.push({
        artikelnummer: artNr,
        bezeichnung: bez,
        exclusion_reason: 'SON_ARTICLE',
        exclusion_phase: 'FILTER',
        bestand: bestandMap.get(artNr) ?? 0,
        detail: 'SON-Artikel — nicht ins Automatiklager',
      });
    }
  }

  // ---- Filter 1b: Remove prefix articles from order history ----
  const excludePrefixes = (config.exclude_prefixes ?? ['VML', 'VMB', 'SAM', 'OEM']).filter(p => p !== 'SON');
  const hasExcludedPrefix = (bez: string) => excludePrefixes.some(p => bez.startsWith(p + ' '));

  filteredBestellungen = filteredBestellungen.filter(b => !hasExcludedPrefix(b.bezeichnung ?? ''));

  // ---- Build order statistics from cleaned bestellungen ----
  // Group menge by [artNr, belegnr] so each order (belegnr) counts once per article
  const belegMengeMap = new Map<string, Map<string, number>>();
  for (const b of filteredBestellungen) {
    const artNr = String(b.artikelnummer);
    const belegNr = String(b.belegnummer);
    if (!belegMengeMap.has(artNr)) belegMengeMap.set(artNr, new Map());
    const inner = belegMengeMap.get(artNr)!;
    inner.set(belegNr, (inner.get(belegNr) ?? 0) + b.menge);
  }

  const umsatzMap = new Map<string, number>();
  const orderMengenMap = new Map<string, number[]>(); // artNr → [menge per order]
  for (const [artNr, inner] of belegMengeMap) {
    const mengen = [...inner.values()];
    umsatzMap.set(artNr, mengen.reduce((s, v) => s + v, 0));
    orderMengenMap.set(artNr, mengen);
  }

  // ---- Build monthly menge map: artNr → Map<YYYY-MM, totalMenge> ----
  const monthlyMengeMap = new Map<string, Map<string, number>>();
  let minDateMs = Infinity;
  let maxDateMs = -Infinity;
  for (const b of filteredBestellungen) {
    if (!b.datum) continue;
    const artNr = String(b.artikelnummer);
    const yearMonth = b.datum.slice(0, 7); // "YYYY-MM"
    if (!monthlyMengeMap.has(artNr)) monthlyMengeMap.set(artNr, new Map());
    const monthly = monthlyMengeMap.get(artNr)!;
    monthly.set(yearMonth, (monthly.get(yearMonth) ?? 0) + b.menge);
    const t = new Date(b.datum).getTime();
    if (t < minDateMs) minDateMs = t;
    if (t > maxDateMs) maxDateMs = t;
  }

  // Derive actual history window in weeks from real date range (display-only for weekly_demand)
  const historyWeeks = (maxDateMs > minDateMs)
    ? Math.max(1, Math.round((maxDateMs - minDateMs) / (7 * 24 * 60 * 60 * 1000)))
    : HISTORY_WEEKS_FALLBACK;

  // Detect order article numbers not in Artikelliste
  const artikelSet = new Set(artikel.map(a => String(a.artikelnummer)));
  const bestellArtikelSet = new Set(filteredBestellungen.map(b => String(b.artikelnummer)));
  for (const artNr of bestellArtikelSet) {
    if (!artikelSet.has(artNr)) {
      validation.artikel_ohne_match.push(artNr);
    }
  }

  // ---- Filter 2: Bestand articles without Artikelliste entry (NO_MASTER_RECORD) ----
  const orderBezMap = new Map<string, string>();
  for (const b of bestellungen) {
    if (b.bezeichnung && !orderBezMap.has(String(b.artikelnummer))) {
      orderBezMap.set(String(b.artikelnummer), b.bezeichnung);
    }
  }
  const fehlende_artikel: Array<{ artikelnummer: string; bestand: number }> = [];
  for (const b of bestand) {
    const artNr = String(b.artikelnummer);
    if (!artikelSet.has(artNr) && b.bestand > 0) {
      fehlende_artikel.push({ artikelnummer: artNr, bestand: b.bestand });
      exclusionLog.push({
        artikelnummer: artNr,
        bezeichnung: orderBezMap.get(artNr) ?? '— unknown —',
        exclusion_reason: 'NO_MASTER_RECORD',
        exclusion_phase: 'FILTER',
        bestand: b.bestand,
        detail: 'Kein Eintrag in Artikelliste',
      });
    }
  }
  fehlende_artikel.sort((a, b) => b.bestand - a.bestand);
  validation.fehlende_artikel = fehlende_artikel;
  validation.fehlende_bestand_gesamt = fehlende_artikel.reduce((s, a) => s + a.bestand, 0);

  // ---- Process articles: apply exclusion filters ----
  const minOrderCount = config.min_order_count ?? 5;

  const enriched: Array<{
    art: ArtikelData;
    bestandVal: number;
    umsatzGesamt: number;
    orderMengen: number[];
  }> = [];

  for (const art of artikel) {
    const artNr = String(art.artikelnummer);
    const bestandVal = bestandMap.get(artNr) ?? 0;

    if (bestandVal <= 0) continue;
    if (sonArticles.has(artNr)) continue;

    const bez = art.bezeichnung || '— unknown —';

    // Filter 1c: PREFIX_EXCLUDED
    if (hasExcludedPrefix(bez)) {
      exclusionLog.push({
        artikelnummer: artNr, bezeichnung: bez,
        exclusion_reason: 'PREFIX_EXCLUDED', exclusion_phase: 'FILTER',
        bestand: bestandVal,
        detail: `Bezeichnung beginnt mit "${excludePrefixes.find(p => bez.startsWith(p + ' '))}"`,
      });
      continue;
    }

    // Filter 3: SPERRGUT
    if (art.sperrgut) {
      exclusionLog.push({
        artikelnummer: artNr, bezeichnung: bez,
        exclusion_reason: 'SPERRGUT', exclusion_phase: 'FILTER',
        bestand: bestandVal, detail: `Sperrgut=${art.sperrgut}`,
      });
      continue;
    }

    // Filter 4: HEIGHT_EXCEEDED — only if ALL dimensions exceed limit
    if (Math.min(art.hoehe_mm, art.breite_mm, art.laenge_mm) > config.hoehe_limit_mm) {
      validation.artikel_nicht_lagerfaehig.push(artNr);
      exclusionLog.push({
        artikelnummer: artNr, bezeichnung: bez,
        exclusion_reason: 'HEIGHT_EXCEEDED', exclusion_phase: 'FILTER',
        bestand: bestandVal, detail: `Hoehe_mm=${art.hoehe_mm}`,
      });
      continue;
    }

    // Filter 5: WEIGHT_EXCEEDED
    if (art.gewicht_kg > config.gewicht_hard_kg) {
      exclusionLog.push({
        artikelnummer: artNr, bezeichnung: bez,
        exclusion_reason: 'WEIGHT_EXCEEDED', exclusion_phase: 'FILTER',
        bestand: bestandVal, detail: `Gewicht_kg=${art.gewicht_kg}`,
      });
      continue;
    }

    // Filter 6: DIMENSIONS_MISSING
    if (art.hoehe_mm <= 0 || art.breite_mm <= 0 || art.laenge_mm <= 0) {
      validation.artikel_unvollstaendig.push(artNr);
      exclusionLog.push({
        artikelnummer: artNr, bezeichnung: bez,
        exclusion_reason: 'DIMENSIONS_MISSING', exclusion_phase: 'FILTER',
        bestand: bestandVal,
        detail: `Hoehe_mm=${art.hoehe_mm}, Breite_mm=${art.breite_mm}, Laenge_mm=${art.laenge_mm}`,
      });
      continue;
    }

    // Filter 6b: SEGMENT_TOO_SMALL — article footprint cannot fit in any WT orientation.
    // A GROSS WT is 500mm wide × 800mm deep. An article fits if at least one dimension ≤ 320mm
    // can serve as vertical and the remaining two footprint dimensions fit in 500×800mm.
    {
      const dims = [art.hoehe_mm, art.breite_mm, art.laenge_mm];
      const canFit = dims.some((vert, idx) => {
        if (vert <= 0 || vert > config.hoehe_limit_mm) return false;
        const fp = dims.filter((_, j) => j !== idx).sort((a, b) => a - b);
        // fp[0] ≤ fp[1]; need fp[0] ≤ 500mm (WT width) and fp[1] ≤ 800mm (GROSS depth)
        return fp[0] <= 500 && fp[1] <= 800;
      });
      if (!canFit) {
        validation.artikel_unvollstaendig.push(artNr);
        exclusionLog.push({
          artikelnummer: artNr, bezeichnung: bez,
          exclusion_reason: 'SEGMENT_TOO_SMALL', exclusion_phase: 'FILTER',
          bestand: bestandVal,
          detail: `Grundriss passt in keine WT-Ausrichtung (h=${art.hoehe_mm}, b=${art.breite_mm}, l=${art.laenge_mm})`,
        });
        continue;
      }
    }

    // Filter 7: WEIGHT_MISSING
    if (!art.gewicht_kg || art.gewicht_kg <= 0) {
      validation.artikel_unvollstaendig.push(artNr);
      exclusionLog.push({
        artikelnummer: artNr, bezeichnung: bez,
        exclusion_reason: 'WEIGHT_MISSING', exclusion_phase: 'FILTER',
        bestand: bestandVal, detail: 'Gewicht_kg fehlt oder ist 0',
      });
      continue;
    }

    // Filter 8: LOW_FREQUENCY
    const orderMengen = orderMengenMap.get(artNr) ?? [];
    if (orderMengen.length < minOrderCount) {
      exclusionLog.push({
        artikelnummer: artNr, bezeichnung: bez,
        exclusion_reason: 'LOW_FREQUENCY', exclusion_phase: 'FILTER',
        bestand: bestandVal,
        detail: `${orderMengen.length} Bestellungen (min: ${minOrderCount})`,
      });
      continue;
    }

    enriched.push({ art, bestandVal, umsatzGesamt: umsatzMap.get(artNr) ?? 0, orderMengen });
  }

  // ---- ABC classification ----
  enriched.sort((a, b) => b.umsatzGesamt - a.umsatzGesamt);
  const totalUmsatz = enriched.reduce((sum, e) => sum + e.umsatzGesamt, 0);
  let cumulativeUmsatz = 0;

  const bulkThreshold = config.bulk_top3_threshold ?? 0.5;
  const processed: ArtikelProcessed[] = enriched.map(({ art, bestandVal, umsatzGesamt, orderMengen }) => {
    cumulativeUmsatz += umsatzGesamt;
    const cumulativePct = totalUmsatz > 0 ? cumulativeUmsatz / totalUmsatz : 1;
    let abc_klasse: 'A' | 'B' | 'C';
    if (cumulativePct <= 0.2) abc_klasse = 'A';
    else if (cumulativePct <= 0.5) abc_klasse = 'B';
    else abc_klasse = 'C';

    const order_count = orderMengen.length;
    const artNr = String(art.artikelnummer);

    // Bulk detection: top 3 orders cover >= threshold of total volume
    const sortedMengen = [...orderMengen].sort((a, b) => b - a);
    const top3Sum = sortedMengen.slice(0, 3).reduce((s, v) => s + v, 0);
    const is_median_article = umsatzGesamt > 0 && top3Sum / umsatzGesamt >= bulkThreshold;

    // Weekly demand (display only): use median-adjusted rate for bulk, mean for regular
    let weekly_demand: number;
    if (is_median_article) {
      const median = sortedMengen[Math.floor(sortedMengen.length / 2)] ?? 0;
      weekly_demand = (median * order_count) / historyWeeks;
    } else {
      weekly_demand = umsatzGesamt / historyWeeks;
    }

    // bestand_storojet = peak single-month menge (or median month for bulk articles),
    // capped by bestand_gesamt, floored at 1.
    const monthlyTotals = [...(monthlyMengeMap.get(artNr)?.values() ?? [])];
    const sortedMonthly = [...monthlyTotals].sort((a, b) => a - b);
    let storojet_qty: number;
    if (sortedMonthly.length === 0) {
      // No date data — fall back to total demand
      storojet_qty = umsatzGesamt;
    } else if (is_median_article) {
      storojet_qty = sortedMonthly[Math.floor(sortedMonthly.length / 2)] ?? umsatzGesamt;
    } else {
      storojet_qty = sortedMonthly[sortedMonthly.length - 1]; // peak month
    }

    const bestand_gesamt = bestandVal;
    const bestand_storojet = Math.min(bestand_gesamt, Math.max(1, Math.ceil(storojet_qty)));
    const bestand_regal = bestand_gesamt - bestand_storojet;

    return {
      ...art,
      umsatz_gesamt: umsatzGesamt,
      abc_klasse,
      bestand: bestand_storojet,           // Algorithm uses the capped value
      in_abwicklung: 0,
      platzbedarf_mm2: bestand_storojet * art.grundflaeche_mm2,
      warnungen: [],
      bestand_gesamt,
      bestand_storojet,
      bestand_regal,
      weekly_demand,
      order_count,
      is_median_article,
    };
  });

  return { processed, validation, filteredBestellungen };
}
