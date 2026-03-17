import type {
  ArtikelData,
  BestellungData,
  BestandData,
  ArtikelProcessed,
  WTConfig,
  ValidationResult,
} from '../types';

/**
 * Phase 1: Data preparation + ABC classification.
 *
 * Receives pre-processed data from backend API:
 * - artikel: dimensions already in mm, grundflaeche_mm2 + max_stapelhoehe pre-computed
 * - bestellungen: order line items (used to compute umsatz_gesamt per article)
 * - bestand: current stock levels (from Bestandsliste upload)
 *
 * Backend already filtered: Sperrgut articles, weight > 24kg.
 * This phase still filters: hoehe_mm > 320mm (height limit).
 */
export function processPhase1(
  artikel: ArtikelData[],
  bestellungen: BestellungData[],
  bestand: BestandData[],
  config: WTConfig,
): { processed: ArtikelProcessed[]; validation: ValidationResult } {
  const validation: ValidationResult = {
    hard_fails: [],
    warnungen: [],
    artikel_nicht_lagerfaehig: [],
    artikel_unvollstaendig: [],
    artikel_ohne_match: [],
  };

  // Build lookup maps
  const bestandMap = new Map<string, number>();
  for (const b of bestand) {
    bestandMap.set(String(b.artikelnummer), b.bestand);
  }

  // Compute umsatz_gesamt by summing menge from bestellungen grouped by artikelnummer
  const umsatzMap = new Map<string, number>();
  for (const b of bestellungen) {
    const artNr = String(b.artikelnummer);
    umsatzMap.set(artNr, (umsatzMap.get(artNr) ?? 0) + b.menge);
  }

  // Detect bestellung article numbers not in Artikelliste
  const artikelSet = new Set(artikel.map(a => String(a.artikelnummer)));
  const bestellArtikelSet = new Set(bestellungen.map(b => String(b.artikelnummer)));
  for (const artNr of bestellArtikelSet) {
    if (!artikelSet.has(artNr)) {
      validation.artikel_ohne_match.push(artNr);
    }
  }

  // Detect bestand articles with stock but no Artikelliste entry (no dimensions available)
  const fehlende_artikel: Array<{ artikelnummer: string; bestand: number }> = [];
  for (const b of bestand) {
    const artNr = String(b.artikelnummer);
    if (!artikelSet.has(artNr) && b.bestand > 0) {
      fehlende_artikel.push({ artikelnummer: artNr, bestand: b.bestand });
    }
  }
  fehlende_artikel.sort((a, b) => b.bestand - a.bestand);
  validation.fehlende_artikel = fehlende_artikel;
  validation.fehlende_bestand_gesamt = fehlende_artikel.reduce((s, a) => s + a.bestand, 0);

  // Join and process articles
  const enriched: Array<{
    art: ArtikelData;
    bestandVal: number;
    umsatzGesamt: number;
    warnungen: string[];
  }> = [];

  for (const art of artikel) {
    const artNr = String(art.artikelnummer);
    const bestandVal = bestandMap.get(artNr) ?? 0;
    const umsatzGesamt = umsatzMap.get(artNr) ?? 0;
    const warnungen: string[] = [];

    // Skip articles with zero stock
    if (bestandVal <= 0) continue;

    // Filter: height > 320mm (not storable)
    if (art.hoehe_mm > config.hoehe_limit_mm) {
      validation.artikel_nicht_lagerfaehig.push(artNr);
      warnungen.push(`Höhe ${art.hoehe_mm}mm > ${config.hoehe_limit_mm}mm Limit`);
      continue; // Skip — cannot be placed
    }

    // Validate dimensions
    if (art.hoehe_mm <= 0 || art.breite_mm <= 0 || art.laenge_mm <= 0 || art.gewicht_kg <= 0) {
      validation.artikel_unvollstaendig.push(artNr);
      warnungen.push('Unvollständige Maße oder Gewicht');
    }

    enriched.push({ art, bestandVal, umsatzGesamt, warnungen });
  }

  // ABC classification: sort by umsatz_gesamt descending
  enriched.sort((a, b) => b.umsatzGesamt - a.umsatzGesamt);

  const totalUmsatz = enriched.reduce((sum, e) => sum + e.umsatzGesamt, 0);
  let cumulativeUmsatz = 0;

  const processed: ArtikelProcessed[] = enriched.map(({ art, bestandVal, umsatzGesamt, warnungen }) => {
    cumulativeUmsatz += umsatzGesamt;
    const cumulativePct = totalUmsatz > 0 ? cumulativeUmsatz / totalUmsatz : 1;

    let abc_klasse: 'A' | 'B' | 'C';
    if (cumulativePct <= 0.2) {
      abc_klasse = 'A';
    } else if (cumulativePct <= 0.5) {
      abc_klasse = 'B';
    } else {
      abc_klasse = 'C';
    }

    const platzbedarf_mm2 = bestandVal * art.grundflaeche_mm2;

    return {
      ...art,
      umsatz_gesamt: umsatzGesamt,
      abc_klasse,
      bestand: bestandVal,
      in_abwicklung: 0,
      platzbedarf_mm2,
      warnungen,
    };
  });

  return { processed, validation };
}
