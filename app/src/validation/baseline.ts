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
    if (art.hoehe_mm > config.hoehe_limit_mm) continue;
    if (!art.gewicht_kg || art.gewicht_kg > config.gewicht_hard_kg) continue;

    let remaining = art.bestand;
    while (remaining > 0) {
      const maxByWeight = Math.floor(config.gewicht_hard_kg / art.gewicht_kg);
      const place = Math.min(remaining, maxByWeight);
      if (place <= 0) break;

      wtCounter++;
      const id = `BL-${String(wtCounter).padStart(4, '0')}`;
      wts.push({
        id, typ: 'KLEIN', cluster_id: 0,
        positionen: [{
          artikelnummer: String(art.artikelnummer),
          bezeichnung: art.bezeichnung,
          stueckzahl: place,
          grundflaeche_mm2: art.grundflaeche_mm2,
          gewicht_kg: art.gewicht_kg,
          abc_klasse: art.abc_klasse,
        }],
        gesamtgewicht_kg: art.gewicht_kg * place,
        flaeche_brutto_mm2: 250000,
        flaeche_netto_mm2: 250000,
        flaeche_netto_pct: Math.min(100, (art.grundflaeche_mm2 * place) / 250000 * 100),
        anzahl_teiler: 0,
        gewicht_status: 'ok',
      });
      remaining -= place;
    }
  }
  return { wts, wtCount: wtCounter };
}
