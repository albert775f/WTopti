import type {
  ArtikelData,
  BestellungData,
  BestandData,
  ArtikelProcessed,
  WTConfig,
  ValidationResult,
  ExclusionLogEntry,
} from '../types';

/**
 * Phase 1: Data preparation + ABC classification.
 *
 * Phase 0 (filters) runs inside this function:
 *   - Filter 1: Remove SON articles from order history
 *   - Filter 2: Exclude bestand articles without Artikelliste entry
 *   - Filters 3–6: HEIGHT_EXCEEDED, WEIGHT_EXCEEDED, DIMENSIONS_MISSING, WEIGHT_MISSING
 *
 * Returns filteredBestellungen (SON-free) for use in Phase 2.
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
  const filteredBestellungen: BestellungData[] = [];
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

  // Build lookup maps
  const bestandMap = new Map<string, number>();
  for (const b of bestand) {
    bestandMap.set(String(b.artikelnummer), b.bestand);
  }

  // Compute umsatz_gesamt from filtered order history (SON removed)
  const umsatzMap = new Map<string, number>();
  for (const b of filteredBestellungen) {
    const artNr = String(b.artikelnummer);
    umsatzMap.set(artNr, (umsatzMap.get(artNr) ?? 0) + b.menge);
  }

  // Detect order article numbers not in Artikelliste (using filtered orders)
  const artikelSet = new Set(artikel.map(a => String(a.artikelnummer)));
  const bestellArtikelSet = new Set(filteredBestellungen.map(b => String(b.artikelnummer)));
  for (const artNr of bestellArtikelSet) {
    if (!artikelSet.has(artNr)) {
      validation.artikel_ohne_match.push(artNr);
    }
  }

  // ---- Filter 2: Bestand articles without Artikelliste entry (NO_MASTER_RECORD) ----
  // Build bezeichnung lookup from raw order history (before SON filtering)
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

  // ---- Process articles: apply exclusion filters in spec priority order ----
  const enriched: Array<{
    art: ArtikelData;
    bestandVal: number;
    umsatzGesamt: number;
  }> = [];

  for (const art of artikel) {
    const artNr = String(art.artikelnummer);
    const bestandVal = bestandMap.get(artNr) ?? 0;

    if (bestandVal <= 0) continue;

    const bez = art.bezeichnung || '— unknown —';

    // Priority 1: HEIGHT_EXCEEDED
    if (art.hoehe_mm > config.hoehe_limit_mm) {
      validation.artikel_nicht_lagerfaehig.push(artNr);
      exclusionLog.push({
        artikelnummer: artNr, bezeichnung: bez,
        exclusion_reason: 'HEIGHT_EXCEEDED', exclusion_phase: 'FILTER',
        bestand: bestandVal, detail: `Hoehe_mm=${art.hoehe_mm}`,
      });
      continue;
    }

    // Priority 2: WEIGHT_EXCEEDED
    if (art.gewicht_kg > config.gewicht_hard_kg) {
      exclusionLog.push({
        artikelnummer: artNr, bezeichnung: bez,
        exclusion_reason: 'WEIGHT_EXCEEDED', exclusion_phase: 'FILTER',
        bestand: bestandVal, detail: `Gewicht_kg=${art.gewicht_kg}`,
      });
      continue;
    }

    // Priority 3: DIMENSIONS_MISSING (any dimension = 0)
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

    // Priority 4: WEIGHT_MISSING
    if (!art.gewicht_kg || art.gewicht_kg <= 0) {
      validation.artikel_unvollstaendig.push(artNr);
      exclusionLog.push({
        artikelnummer: artNr, bezeichnung: bez,
        exclusion_reason: 'WEIGHT_MISSING', exclusion_phase: 'FILTER',
        bestand: bestandVal, detail: 'Gewicht_kg fehlt oder ist 0',
      });
      continue;
    }

    enriched.push({ art, bestandVal, umsatzGesamt: umsatzMap.get(artNr) ?? 0 });
  }

  // ABC classification: sort by umsatz_gesamt descending
  enriched.sort((a, b) => b.umsatzGesamt - a.umsatzGesamt);
  const totalUmsatz = enriched.reduce((sum, e) => sum + e.umsatzGesamt, 0);
  let cumulativeUmsatz = 0;

  const processed: ArtikelProcessed[] = enriched.map(({ art, bestandVal, umsatzGesamt }) => {
    cumulativeUmsatz += umsatzGesamt;
    const cumulativePct = totalUmsatz > 0 ? cumulativeUmsatz / totalUmsatz : 1;
    let abc_klasse: 'A' | 'B' | 'C';
    if (cumulativePct <= 0.2) abc_klasse = 'A';
    else if (cumulativePct <= 0.5) abc_klasse = 'B';
    else abc_klasse = 'C';

    return {
      ...art,
      umsatz_gesamt: umsatzGesamt,
      abc_klasse,
      bestand: bestandVal,
      in_abwicklung: 0,
      platzbedarf_mm2: bestandVal * art.grundflaeche_mm2,
      warnungen: [],
    };
  });

  return { processed, validation, filteredBestellungen };
}
