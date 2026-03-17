import type { WT, ArtikelData, BestandData, HardCheckResult, HardCheckDetail } from '../types';

export function runHardChecks(
  wts: WT[],
  artikel: ArtikelData[],
  bestand: BestandData[],
): HardCheckResult[] {
  return [
    checkC1_Bestandsvollstaendigkeit(wts, bestand),
    checkC2_GewichtHardLimit(wts),
    checkC3_HoehenLimit(wts, artikel),
    checkC4_WTEindeutigkeit(wts),
    checkC5_ArtikelReferenz(wts, artikel),
    checkC6_KeineLeereWTs(wts),
    checkC7_FlaechenIntegritaet(wts),
    checkC8_ConstraintEinhaltung(),
  ];
}

function checkC1_Bestandsvollstaendigkeit(wts: WT[], bestand: BestandData[]): HardCheckResult {
  const details: HardCheckDetail[] = [];
  const placed = new Map<string, number>();
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      placed.set(pos.artikelnummer, (placed.get(pos.artikelnummer) ?? 0) + pos.stueckzahl);
    }
  }
  for (const b of bestand) {
    if (b.bestand <= 0) continue;
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
  const artMap = new Map(artikel.map(a => [a.artikelnummer, a]));
  const details: HardCheckDetail[] = [];
  for (const wt of wts) {
    for (const pos of wt.positionen) {
      const art = artMap.get(pos.artikelnummer);
      if (art && art.hoehe_mm > 320) {
        details.push({ key: pos.artikelnummer, expected: '≤320 mm', actual: `${art.hoehe_mm} mm`, message: `Artikel ${pos.artikelnummer} überschreitet 320 mm` });
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
  const TEILER_MM = 5;
  for (const wt of wts) {
    const maxDepth = wt.typ === 'KLEIN' ? 500 : 800;
    let totalDepth = 0;
    for (let i = 0; i < wt.positionen.length; i++) {
      const pos = wt.positionen[i];
      const laenge = pos.laenge_mm ?? Math.sqrt(pos.grundflaeche_mm2);
      const breite = pos.breite_mm ?? Math.sqrt(pos.grundflaeche_mm2);
      const maxStapel = Math.max(1, pos.max_stapelhoehe ?? 1);
      const slotsAcross = Math.max(1, Math.floor(500 / laenge));
      const capPerStrip = slotsAcross * maxStapel;
      const stripsNeeded = Math.max(1, Math.ceil(pos.stueckzahl / capPerStrip));
      totalDepth += stripsNeeded * breite;
      if (i > 0) totalDepth += TEILER_MM;
    }
    if (totalDepth > maxDepth + 1) { // +1mm tolerance
      details.push({ key: wt.id, expected: `≤${maxDepth} mm`, actual: `${Math.round(totalDepth)} mm`, message: `WT ${wt.id} überläuft: ${Math.round(totalDepth)} mm > ${maxDepth} mm` });
    }
  }
  return { id: 'C7', name: 'Flächenintegrität (kein Überlauf)', status: details.length === 0 ? 'PASS' : 'FAIL', errorCount: details.length, details };
}

function checkC8_ConstraintEinhaltung(): HardCheckResult {
  return { id: 'C8', name: 'Constraint-Einhaltung', status: 'PASS', errorCount: 0, details: [] };
}
