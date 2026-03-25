import type { ArtikelProcessed, WTConfig, WT } from '../types';

export function calculateBaseline(
  processed: ArtikelProcessed[],
  config: WTConfig,
): { wts: WT[]; wtCount: number } {
  const sorted = [...processed].sort((a, b) =>
    String(a.artikelnummer).localeCompare(String(b.artikelnummer))
  );

  const wts: WT[] = [];
  let wtCounter = 0;

  for (const art of sorted) {
    if (art.bestand <= 0) continue;
    if (Math.min(art.hoehe_mm, art.breite_mm, art.laenge_mm) > config.hoehe_limit_mm) continue;
    if (!art.gewicht_kg || art.grundflaeche_mm2 <= 0) continue;

    const KLEIN_AREA = 250000;
    const AREA_USABLE = 0.92;
    const maxStapel = Math.max(1, art.max_stapelhoehe);
    const maxStacksGeom = Math.floor((KLEIN_AREA * AREA_USABLE) / (art.laenge_mm * art.breite_mm));
    const maxItemsGeom = maxStacksGeom * maxStapel;
    const maxItemsWeight = art.gewicht_kg > 0 ? Math.floor(config.gewicht_hard_kg / art.gewicht_kg) : 999999;
    const maxPerWT = Math.max(1, Math.min(maxItemsGeom, maxItemsWeight));

    if (maxPerWT <= 0) continue;

    let remaining = art.bestand;
    while (remaining > 0) {
      const place = Math.min(remaining, maxPerWT);
      if (place <= 0) break;

      wtCounter++;
      const id = `BL-${String(wtCounter).padStart(4, '0')}`;
      const stacksNeeded = Math.ceil(place / maxStapel);
      const usedArea = stacksNeeded * art.laenge_mm * art.breite_mm;
      const usableArea = KLEIN_AREA * AREA_USABLE;

      wts.push({
        id, typ: 'KLEIN', cluster_id: 0,
        positionen: [{
          artikelnummer: String(art.artikelnummer),
          bezeichnung: art.bezeichnung,
          stueckzahl: place,
          grundflaeche_mm2: art.grundflaeche_mm2,
          gewicht_kg: art.gewicht_kg,
          abc_klasse: art.abc_klasse,
          breite_mm: art.breite_mm,
          laenge_mm: art.laenge_mm,
          max_stapelhoehe: art.max_stapelhoehe,
        }],
        gesamtgewicht_kg: Math.round(art.gewicht_kg * place * 100) / 100,
        flaeche_brutto_mm2: KLEIN_AREA,
        flaeche_netto_mm2: Math.round(usableArea),
        flaeche_netto_pct: Math.min(100, Math.round(usedArea / usableArea * 10000) / 100),
        anzahl_teiler: 0,
        gewicht_status: 'ok',
      });
      remaining -= place;
    }
  }
  return { wts, wtCount: wtCounter };
}
