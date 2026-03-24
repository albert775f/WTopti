import { useAppState, useAppDispatch } from '../context/AppContext';
import { KLEIN_FLOOR_M2, GROSS_FLOOR_M2 } from '../algorithm/phase3';
import { WAREHOUSE_AREA_M2 } from '../algorithm/phase5';

function fmt(n: number) { return n.toLocaleString('de-DE'); }
function fmtArea(n: number) { return n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

function AreaBar({ usedM2, totalM2, reserveM2 }: { usedM2: number; totalM2: number; reserveM2?: number }) {
  const demandPct = Math.min(100, (usedM2 / totalM2) * 100);
  const reservePct = reserveM2 != null ? Math.min(100 - demandPct, (reserveM2 / totalM2) * 100) : 0;
  return (
    <div className="w-full bg-gray-100 rounded-full h-3 mt-1 overflow-hidden flex">
      <div className="h-3 bg-blue-500 transition-all" style={{ width: `${demandPct}%` }} />
      {reservePct > 0 && (
        <div className="h-3 bg-blue-200 transition-all" style={{ width: `${reservePct}%` }} />
      )}
    </div>
  );
}

export default function WTRatioSection() {
  const { result } = useAppState();
  const dispatch = useAppDispatch();
  const r = result?.wt_ratio;

  if (!result || !r) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <p>Keine Ergebnisse vorhanden. Bitte zuerst Optimierung starten.</p>
      </div>
    );
  }

  const deltaKleinSign = r.delta_klein >= 0 ? '+' : '';
  const deltaGrossSign = r.delta_gross >= 0 ? '+' : '';
  const configMatchesScaled = r.delta_klein === 0 && r.delta_gross === 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-800">WT-Verhältnis-Rechner</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Lagerfläche: <strong>{fmtArea(WAREHOUSE_AREA_M2)} m²</strong>
          &ensp;·&ensp;1 KLEIN = {KLEIN_FLOOR_M2} m²
          &ensp;·&ensp;1 GROSS = {GROSS_FLOOR_M2} m²
        </p>
      </div>

      {/* Result card */}
      <div className={`rounded-lg border p-5 space-y-4 ${r.fits_warehouse ? 'border-blue-200 bg-blue-50' : 'border-red-200 bg-red-50'}`}>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Empfohlene Beschaffung für {fmtArea(WAREHOUSE_AREA_M2)} m² Lagerfläche
        </p>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide">KLEIN (500×500 mm)</p>
            <p className="text-4xl font-bold text-gray-900">{fmt(r.scaled_klein)}</p>
            <p className="text-xs text-gray-400">{fmtArea(r.scaled_klein * KLEIN_FLOOR_M2)} m²</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide">GROSS (500×800 mm)</p>
            <p className="text-4xl font-bold text-gray-900">{fmt(r.scaled_gross)}</p>
            <p className="text-xs text-gray-400">{fmtArea(r.scaled_gross * GROSS_FLOOR_M2)} m²</p>
          </div>
        </div>
        <div className="space-y-1">
          <AreaBar usedM2={r.demand_area_m2} totalM2={WAREHOUSE_AREA_M2} reserveM2={r.reserve_area_m2} />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500 mr-1 align-middle" />
              Bestand {fmtArea(r.demand_area_m2)} m² ({r.demand_area_pct.toFixed(1)}%)
            </span>
            <span>
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-200 mr-1 align-middle" />
              Reserve {fmtArea(r.reserve_area_m2)} m²
            </span>
          </div>
        </div>
      </div>

      {/* Demand vs capacity */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
        <p className="font-semibold text-gray-700">Bedarfsrechnung</p>
        <div className="grid grid-cols-2 gap-4 text-gray-600">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Bestand benötigt</p>
            <p>{fmt(r.demand_klein)} KLEIN + {fmt(r.demand_gross)} GROSS</p>
            <p className="text-xs text-gray-400 mt-0.5">{fmtArea(r.demand_area_m2)} m² = {r.demand_area_pct.toFixed(1)}% der Lagerfläche</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Reserve (auf voll skaliert)</p>
            <p>{fmt(r.reserve_klein)} KLEIN + {fmt(r.reserve_gross)} GROSS</p>
            <p className="text-xs text-gray-400 mt-0.5">{fmtArea(r.reserve_area_m2)} m² Puffer für Wachstum</p>
          </div>
        </div>
      </div>

      {/* Article breakdown */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Artikel-Verteilung</p>
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div className="bg-gray-50 rounded p-3">
            <p className="text-2xl font-bold text-amber-600">{fmt(r.articles_must_gross)}</p>
            <p className="text-xs text-gray-500 mt-1">Zwingend GROSS<br/>(passt nicht auf KLEIN)</p>
          </div>
          <div className="bg-gray-50 rounded p-3">
            <p className="text-2xl font-bold text-blue-600">{fmt(r.articles_prefer_gross)}</p>
            <p className="text-xs text-gray-500 mt-1">Bevorzugt GROSS<br/>(spart Fläche)</p>
          </div>
          <div className="bg-gray-50 rounded p-3">
            <p className="text-2xl font-bold text-gray-700">{fmt(r.articles_on_klein)}</p>
            <p className="text-xs text-gray-500 mt-1">Optimal KLEIN<br/>(spart Fläche)</p>
          </div>
        </div>
      </div>

      {/* Comparison to current config */}
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-600">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Vergleich zur aktuellen Konfiguration</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>Konfiguriert: {fmt(r.config_klein)} KLEIN / {fmt(r.config_gross)} GROSS</span>
          <span className={r.delta_klein > 0 ? 'text-amber-600 font-medium' : r.delta_klein < 0 ? 'text-green-700 font-medium' : 'text-gray-400'}>
            Δ KLEIN: {deltaKleinSign}{fmt(r.delta_klein)}
          </span>
          <span className={r.delta_gross > 0 ? 'text-amber-600 font-medium' : r.delta_gross < 0 ? 'text-green-700 font-medium' : 'text-gray-400'}>
            Δ GROSS: {deltaGrossSign}{fmt(r.delta_gross)}
          </span>
        </div>
      </div>

      {/* Overflow warning */}
      {!r.fits_warehouse && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Achtung:</strong> {r.recommendation}
        </div>
      )}

      {/* Top GROSS examples */}
      {r.top_gross_examples.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Top Artikel: Warum GROSS?</p>
          <p className="text-xs text-gray-400">Größte Flächeneinsparung durch GROSS statt KLEIN</p>
          <div className="space-y-2 mt-2">
            {r.top_gross_examples.map((c, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs flex items-center justify-center font-bold flex-shrink-0">
                  {i + 1}
                </span>
                <span className="font-mono text-xs text-gray-400 flex-shrink-0">{c.artikelnummer}</span>
                <span className="flex-1 truncate text-gray-700">{c.bezeichnung}</span>
                <span className="text-gray-400 text-xs flex-shrink-0">{fmt(c.n_klein)}K → {fmt(c.n_gross)}G</span>
                <span className="text-green-700 font-semibold text-xs flex-shrink-0">−{fmtArea(c.area_saving)} m²</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendation text (normal case only) */}
      {r.fits_warehouse && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
          {r.recommendation}
        </div>
      )}

      {/* Apply button */}
      {r.fits_warehouse && !configMatchesScaled && (
        <button
          onClick={() => dispatch({ type: 'SET_CONFIG', payload: { anzahl_klein: r.scaled_klein, anzahl_gross: r.scaled_gross } })}
          className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition-colors"
        >
          Als Konfiguration übernehmen
          &ensp;({fmt(r.scaled_klein)} KLEIN / {fmt(r.scaled_gross)} GROSS)
        </button>
      )}
      {r.fits_warehouse && configMatchesScaled && (
        <div className="w-full py-3 rounded-lg border border-green-300 bg-green-50 text-green-700 font-medium text-sm text-center">
          Konfiguration entspricht bereits der Empfehlung
        </div>
      )}
    </div>
  );
}
