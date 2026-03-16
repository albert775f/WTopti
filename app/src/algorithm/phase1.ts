import type {
  ArtikelData,
  BestellungData,
  UmsatzData,
  BestandData,
  ArtikelProcessed,
  WTConfig,
  ValidationResult,
} from '../types';

export function processPhase1(
  artikel: ArtikelData[],
  bestellungen: BestellungData[],
  umsatz: UmsatzData[],
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

  const umsatzMap = new Map<string, number>();
  for (const u of umsatz) {
    // umsatz[] may be a single aggregate value or 14 months — sum all
    const gesamt = u.umsatz.reduce((sum, v) => sum + v, 0);
    umsatzMap.set(String(u.artikelnummer), gesamt);
  }

  // Detect bestellung article numbers not in Artikelliste
  const artikelSet = new Set(artikel.map(a => String(a.artikelnummer)));
  const bestellArtikelSet = new Set(bestellungen.map(b => String(b.artikelnummer)));
  for (const artNr of bestellArtikelSet) {
    if (!artikelSet.has(artNr)) {
      validation.artikel_ohne_match.push(artNr);
    }
  }

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

    // Validate dimensions
    if (art.hoehe > config.hoehe_limit_mm) {
      validation.artikel_nicht_lagerfaehig.push(artNr);
      warnungen.push(`Höhe ${art.hoehe}mm > ${config.hoehe_limit_mm}mm Limit`);
    }

    if (art.hoehe <= 0 || art.breite <= 0 || art.laenge <= 0 || art.gewicht_kg <= 0) {
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

    const grundflaeche_mm2 = art.breite * art.laenge;
    const max_stapelhoehe = art.hoehe > 0 ? Math.floor(config.hoehe_limit_mm / art.hoehe) : 0;
    const platzbedarf_mm2 = bestandVal * grundflaeche_mm2;

    return {
      ...art,
      grundflaeche_mm2,
      max_stapelhoehe,
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
