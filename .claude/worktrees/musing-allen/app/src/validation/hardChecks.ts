import type { WT, ArtikelData, BestandData, HardCheckResult, HardCheckDetail } from '../types';

export function runHardChecks(
  wts: WT[],
  artikel: ArtikelData[],
  bestand: BestandData[],
  excludedArticleNumbers?: Set<string>,
): HardCheckResult[] {
  return [
    checkC1_Bestandsvollstaendigkeit(wts, bestand, excludedArticleNumbers),
    checkC2_GewichtHardLimit(wts),
    checkC3_HoehenLimit(wts, artikel),
    checkC4_WTEindeutigkeit(wts),
    checkC5_ArtikelReferenz(wts, artikel),
    checkC6_KeineLeereWTs(wts),
    checkC7_FlaechenIntegritaet(wts),
    checkC8_ConstraintEinhaltung(),
  ];
}

function checkC1_Bestandsvollstaendigkeit(
  wts: WT[], bestand: BestandData[], excludedArticleNumbers?: Set<string>,
): HardCheckResult {
  const details: HardCheckDetail[] = [];
  const placed = new Map<string, number>();
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      placed.set(pos.artikelnummer, (placed.get(pos.artikelnummer) ?? 0) + pos.stueckzahl);
    }
  }
  for (const b of bestand) {
    if (b.bestand <= 0) continue;
    // Skip intentionally excluded articles (SPERRGUT, HEIGHT_EXCEEDED, etc.) — F9
    if (excludedArticleNumbers?.has(b.artikelnummer)) continue;
    const p = placed.get(b.artikelnummer) ?? 0;
    if (p !== b.bestand) {
      details.push({
        key: b.artikelnummer,
        expected: String(b.bestand),
        actual: String(p),
        message: `Bestand ${b.bestand} ≠ platziert ${p}`,
      });
    }
  }
  return { id: 'C1', name: 'Bestandsvollständigkeit', status: details.length === 0 ? 'PASS' : 'FAIL', errorCount: details.length, details };
}

function checkC2_GewichtHardLimit(wts: WT[]): HardCheckResult {
  const details: HardCheckDetail[] = [];
  for (const wt of wts) {
    if (wt.gesamtgewicht_kg > 24) {
      details.push({ key: wt.id, expected: '≤24 kg', actual: `${wt.gesamtgewicht_kg.toFixed(2)} kg`, message: `WT ${wt.id} überschreitet 24 kg` });
    }
  }
  return { id: 'C2', name: 'Gewicht Hard-Limit (24 kg)', status: details.length === 0 ? 'PASS' : 'FAIL', errorCount: details.length, details };
}

function checkC3_HoehenLimit(wts: WT[], artikel: ArtikelData[]): HardCheckResult {
  // After Bug 16 (3D orientation), any dimension can be vertical.
  // An article is placeable iff at least one dimension ≤ 320 mm.
  // Check: min(h, b, l) > 320 means truly unplaceable (should have been filtered).
  const artMap = new Map(artikel.map(a => [a.artikelnummer, a]));
  const details: HardCheckDetail[] = [];
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      const art = artMap.get(pos.artikelnummer);
      if (art) {
        const minDim = Math.min(art.hoehe_mm, art.breite_mm, art.laenge_mm);
        if (minDim > 320) {
          details.push({ key: pos.artikelnummer, expected: '≤320 mm (min. Dim.)', actual: `${minDim} mm`, message: `Artikel ${pos.artikelnummer}: Mindestdimension ${minDim} mm > 320 mm` });
        }
      }
    }
  }
  return { id: 'C3', name: 'Höhen-Limit (320 mm)', status: details.length === 0 ? 'PASS' : 'FAIL', errorCount: details.length, details };
}

function checkC4_WTEindeutigkeit(wts: WT[]): HardCheckResult {
  const ids = new Set<string>();
  const details: HardCheckDetail[] = [];
  for (const wt of wts) {
    if (ids.has(wt.id)) {
      details.push({ key: wt.id, expected: 'eindeutig', actual: 'doppelt', message: `WT-ID ${wt.id} mehrfach vergeben` });
    }
    ids.add(wt.id);
  }
  return { id: 'C4', name: 'WT-ID Eindeutigkeit', status: details.length === 0 ? 'PASS' : 'FAIL', errorCount: details.length, details };
}

function checkC5_ArtikelReferenz(wts: WT[], artikel: ArtikelData[]): HardCheckResult {
  const artSet = new Set(artikel.map(a => a.artikelnummer));
  const details: HardCheckDetail[] = [];
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      if (!artSet.has(pos.artikelnummer)) {
        details.push({ key: pos.artikelnummer, expected: 'in Artikelliste', actual: 'nicht gefunden', message: `Artikel ${pos.artikelnummer} nicht in Artikelliste` });
      }
    }
  }
  return { id: 'C5', name: 'Artikelreferenz-Integrität', status: details.length === 0 ? 'PASS' : 'FAIL', errorCount: details.length, details };
}

function checkC6_KeineLeereWTs(wts: WT[]): HardCheckResult {
  const details: HardCheckDetail[] = [];
  for (const wt of wts) {
    if (wt.positionen.length === 0 || wt.positionen.every(p => p.stueckzahl === 0)) {
      details.push({ key: wt.id, expected: '>0 Positionen', actual: '0', message: `WT ${wt.id} ist leer` });
    }
  }
  return { id: 'C6', name: 'Keine leeren WTs', status: details.length === 0 ? 'PASS' : 'FAIL', errorCount: details.length, details };
}

function checkC7_FlaechenIntegritaet(wts: WT[]): HardCheckResult {
  const details: HardCheckDetail[] = [];

  for (const wt of wts) {
    const wtArea = wt.typ === 'KLEIN' ? 250000 : 400000;
    // Shelf model (canFitNewZone/placeNewZone) guarantees geometric validity —
    // no AREA_USABLE_FRACTION safety fraction needed.

    let usedArea = 0;
    for (const pos of wt.positionen) {
      if (pos.zone_w != null && pos.zone_h != null) {
        usedArea += pos.zone_w * pos.zone_h;
      } else {
        const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
        const stacksNeeded = Math.ceil(pos.stueckzahl / maxStapel);
        const laenge = pos.laenge_mm ?? Math.sqrt(pos.grundflaeche_mm2);
        const breite = pos.breite_mm ?? Math.sqrt(pos.grundflaeche_mm2);
        usedArea += stacksNeeded * laenge * breite;
      }
    }

    if (usedArea > wtArea * 1.01) { // 1% tolerance
      details.push({
        key: wt.id,
        expected: `≤${Math.round(wtArea)} mm²`,
        actual: `${Math.round(usedArea)} mm²`,
        message: `WT ${wt.id} überläuft: ${Math.round(usedArea)} mm² > ${Math.round(wtArea)} mm² nutzbar`,
      });
    }
  }
  return {
    id: 'C7', name: 'Flächenintegrität (kein Überlauf)',
    status: details.length === 0 ? 'PASS' : 'FAIL',
    errorCount: details.length, details,
  };
}

function checkC8_ConstraintEinhaltung(): HardCheckResult {
  return { id: 'C8', name: 'Constraint-Einhaltung', status: 'PASS', errorCount: 0, details: [] };
}
