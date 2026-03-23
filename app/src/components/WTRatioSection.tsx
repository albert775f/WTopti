import { useMemo, useState } from 'react';
import { useAppState, useAppDispatch } from '../context/AppContext';
import type { ArticleCost } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { KLEIN_FLOOR_M2, GROSS_FLOOR_M2 } from '../algorithm/phase3';

const WAREHOUSE_AREA_DEFAULT = 1480.65;

export default function WTRatioSection() {
  const { result, config } = useAppState();
  const dispatch = useAppDispatch();
  const warehouseArea = config.warehouse_area_m2 ?? WAREHOUSE_AREA_DEFAULT;

  const szenarien = result?.szenarien ?? [];
  const rec = result?.wt_recommendation;
  const articleCosts: ArticleCost[] = result?.article_costs ?? [];

  // Slider: Klein count (derives Gross count from remaining area)
  const minKlein = 0;
  const maxKlein = Math.floor(warehouseArea / KLEIN_FLOOR_M2);
  const [sliderKlein, setSliderKlein] = useState(() => config.anzahl_klein);

  const sliderGross = Math.max(0, Math.floor((warehouseArea - sliderKlein * KLEIN_FLOOR_M2) / GROSS_FLOOR_M2));
  const sliderAreaUsed = sliderKlein * KLEIN_FLOOR_M2 + sliderGross * GROSS_FLOOR_M2;
  const sliderAreaFree = Math.max(0, warehouseArea - sliderAreaUsed);

  // Re-run article assignment for slider config (fast — no full packing needed)
  const sliderAssignment = useMemo(() => {
    if (articleCosts.length === 0) return null;

    let kleinUsed = 0;
    let grossUsed = 0;
    let grossBudget = sliderGross;

    // Must-GROSS first (doesn't fit klein)
    const mustGross = articleCosts.filter(c => !c.fits_klein);
    for (const c of mustGross) {
      grossUsed += c.n_gross;
      grossBudget -= c.n_gross;
    }

    // Floor-cost optimal candidates: fit klein but best on GROSS
    const candidates = articleCosts
      .filter(c => c.fits_klein && c.best_type === 'GROSS')
      .sort((a, b) => b.area_saving - a.area_saving);

    for (const c of candidates) {
      if (grossBudget >= c.n_gross) {
        grossUsed += c.n_gross;
        grossBudget -= c.n_gross;
      } else {
        kleinUsed += c.n_klein;
      }
    }

    // Rest on KLEIN
    const kleinOnly = articleCosts.filter(c => c.fits_klein && c.best_type === 'KLEIN');
    for (const c of kleinOnly) kleinUsed += c.n_klein;

    const stockFitsKlein = kleinUsed <= sliderKlein;
    const stockFitsGross = grossUsed <= sliderGross;
    const stockFits = stockFitsKlein && stockFitsGross;

    return { kleinUsed, grossUsed, stockFits, stockFitsKlein, stockFitsGross };
  }, [articleCosts, sliderKlein, sliderGross]);

  const chartData = useMemo(() => szenarien.map(s => ({
    name: s.szenario.replace(' (Simulation)', '').replace(' (Aktuell)', ''),
    flaeche: Math.round(s.auslastung_flaeche_avg * 10) / 10,
    gewicht: Math.round(s.auslastung_gewicht_avg * 10) / 10,
  })), [szenarien]);

  if (!result) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <p>Keine Ergebnisse vorhanden. Bitte zuerst Optimierung starten.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">WT-Verhältnis-Simulator</h2>

      {/* Floor area recommendation card */}
      {rec && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">&#128208;</span>
            <div className="flex-1">
              <p className="font-semibold text-blue-900">Lagerflächenanalyse (STOROJET)</p>
              <p className="text-sm text-blue-800 mt-1">{rec.empfehlung}</p>
            </div>
          </div>

          {/* Floor area bar */}
          <div>
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>Lagerfläche gesamt: <strong>{rec.warehouse_area_m2.toLocaleString('de-DE', { minimumFractionDigits: 2 })} m²</strong></span>
              <span>
                Belegt: <strong>{rec.area_used_m2.toFixed(1)} m²</strong>
                {' | '}
                Frei: <strong className="text-green-700">{rec.area_free_m2.toFixed(1)} m² ({rec.area_free_pct.toFixed(1)}%)</strong>
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden">
              <div className="h-4 bg-blue-500 rounded-l-full transition-all"
                style={{ width: `${Math.min(100, 100 - rec.area_free_pct)}%` }} />
            </div>
          </div>

          {/* WT inventory grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-white rounded-lg border border-blue-100 p-3">
              <p className="font-semibold text-gray-700 mb-2">KLEIN-WTs (500x500mm, 0.25 m²)</p>
              <div className="space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-gray-500">Verfügbar</span>
                  <span className="font-mono">{rec.available_klein.toLocaleString('de-DE')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Genutzt</span>
                  <span className="font-mono font-semibold">{rec.optimal_klein_used.toLocaleString('de-DE')}</span>
                </div>
                <div className="flex justify-between border-t pt-1">
                  <span className="text-gray-500">Frei</span>
                  <span className={`font-mono font-semibold ${rec.klein_free > 500 ? 'text-green-600' : rec.klein_free > 100 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {rec.klein_free.toLocaleString('de-DE')}
                  </span>
                </div>
              </div>
              <div className="mt-2 bg-gray-100 rounded-full h-1.5">
                <div className="h-1.5 rounded-full bg-blue-500"
                  style={{ width: `${Math.min(100, (rec.optimal_klein_used / rec.available_klein) * 100)}%` }} />
              </div>
            </div>
            <div className="bg-white rounded-lg border border-blue-100 p-3">
              <p className="font-semibold text-gray-700 mb-2">GROSS-WTs (500x800mm, 0.40 m²)</p>
              <div className="space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-gray-500">Verfügbar</span>
                  <span className="font-mono">{rec.available_gross.toLocaleString('de-DE')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Genutzt</span>
                  <span className="font-mono font-semibold">{rec.optimal_gross_used.toLocaleString('de-DE')}</span>
                </div>
                <div className="flex justify-between border-t pt-1">
                  <span className="text-gray-500">Frei</span>
                  <span className={`font-mono font-semibold ${rec.gross_free < 5 ? 'text-green-600' : 'text-gray-600'}`}>
                    {rec.gross_free.toLocaleString('de-DE')}
                  </span>
                </div>
              </div>
              <div className="mt-2 bg-gray-100 rounded-full h-1.5">
                <div className="h-1.5 rounded-full bg-amber-500"
                  style={{ width: `${Math.min(100, (rec.optimal_gross_used / rec.available_gross) * 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Article breakdown */}
          <div className="flex flex-wrap gap-4 text-sm border-t border-blue-200 pt-3">
            <span className="text-blue-800">
              <strong>{rec.articles_on_gross}</strong> Typen auf GROSS
              {rec.articles_must_gross > 0 && ` (${rec.articles_must_gross} zwingend)`}
            </span>
            <span className="text-blue-800"><strong>{rec.articles_on_klein}</strong> Typen auf KLEIN</span>
            <span className="text-blue-800"><strong>{rec.articles_weight_limited}</strong> gewichtsbegrenzt</span>
            <span className="text-blue-800"><strong>{rec.articles_geometry_limited}</strong> geometriebegrenzt</span>
            {rec.klein_saved > 0 && (
              <span className="text-green-700 font-semibold">
                &#8595; {rec.klein_saved} KLEIN-WTs eingespart vs. reine KLEIN
              </span>
            )}
          </div>

          {/* Top GROSS examples */}
          {rec.top_gross_examples && rec.top_gross_examples.length > 0 && (
            <div className="border-t border-blue-200 pt-3">
              <p className="text-xs font-semibold text-blue-800 mb-2">Beispiele: Warum GROSS?</p>
              <div className="space-y-1">
                {rec.top_gross_examples.map((c: ArticleCost, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-blue-700">
                    <span className="font-mono w-20">{c.artikelnummer}</span>
                    <span className="flex-1 truncate">{c.bezeichnung.slice(0, 40)}</span>
                    <span className="text-gray-500">{c.n_klein}K &#8594; {c.n_gross}G</span>
                    <span className="text-green-700 font-semibold">&#8722;{c.area_saving.toFixed(1)} m²</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scenario Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Szenario', 'Klein', 'Groß', 'Fläche (m²)', 'WT gesamt', 'Ø Fläche%', 'Ø Gewicht%', 'Ungenutzt'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {szenarien.map((s, i) => {
              const areaM2 = s.anzahl_klein * KLEIN_FLOOR_M2 + s.anzahl_gross * GROSS_FLOOR_M2;
              return (
                <tr key={s.szenario} className={`border-b ${i === 0 ? 'bg-blue-50 font-semibold' : 'hover:bg-gray-50'}`}>
                  <td className="px-3 py-2">
                    {s.szenario}
                    {i === 0 && <span className="ml-1 text-blue-600 text-xs">&#9733;</span>}
                  </td>
                  <td className="px-3 py-2">{s.anzahl_klein.toLocaleString('de-DE')}</td>
                  <td className="px-3 py-2">{s.anzahl_gross.toLocaleString('de-DE')}</td>
                  <td className="px-3 py-2">{areaM2.toFixed(0)} m²</td>
                  <td className="px-3 py-2">{(s.anzahl_klein + s.anzahl_gross - s.wts_ungenutzt).toLocaleString('de-DE')}</td>
                  <td className="px-3 py-2">{s.auslastung_flaeche_avg.toFixed(1)}%</td>
                  <td className="px-3 py-2">{s.auslastung_gewicht_avg.toFixed(1)}%</td>
                  <td className="px-3 py-2">{s.wts_ungenutzt.toLocaleString('de-DE')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Szenarien-Vergleich (Ø Auslastung)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="flaeche" name="Ø Fläche %" fill="#3b82f6" />
              <Bar dataKey="gewicht" name="Ø Gewicht %" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Interactive Slider */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Verhältnis-Simulator</h3>
        <p className="text-xs text-gray-500">
          Lagerfläche gesamt: {warehouseArea.toFixed(2)} m²{' '}
          | Verschiebe Klein&#8596;Groß bei konstanter Gesamtfläche.
        </p>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <label className="text-gray-600 font-medium">
              Klein-WTs: <span className="text-blue-700 font-bold">{sliderKlein.toLocaleString('de-DE')}</span>
            </label>
            <span className="text-gray-500">
              &#8594; Groß: <strong>{sliderGross.toLocaleString('de-DE')}</strong>
            </span>
          </div>
          <input
            type="range"
            min={minKlein}
            max={maxKlein}
            step={50}
            value={sliderKlein}
            onChange={e => setSliderKlein(+e.target.value)}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>0 Klein ({Math.floor(warehouseArea / GROSS_FLOOR_M2)} Groß)</span>
            <span>{Math.floor(warehouseArea / KLEIN_FLOOR_M2)} Klein (0 Groß)</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-gray-50 rounded p-2 space-y-1">
            <p className="text-xs font-semibold text-gray-600">Fläche</p>
            <p>Belegt: {sliderAreaUsed.toFixed(1)} m²</p>
            <p className="text-green-700">
              Frei: {sliderAreaFree.toFixed(1)} m² ({(sliderAreaFree / warehouseArea * 100).toFixed(1)}%)
            </p>
          </div>
          <div className={`rounded p-2 space-y-1 text-sm ${sliderAssignment?.stockFits ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className="text-xs font-semibold text-gray-600">Bestand-Abdeckung</p>
            {sliderAssignment ? (
              <>
                <p className={sliderAssignment.stockFitsKlein ? 'text-green-700' : 'text-red-600'}>
                  Klein: {sliderAssignment.kleinUsed.toLocaleString('de-DE')} benötigt{' '}
                  {sliderAssignment.stockFitsKlein
                    ? '✓'
                    : `✗ (${(sliderAssignment.kleinUsed - sliderKlein).toLocaleString('de-DE')} fehlen)`}
                </p>
                <p className={sliderAssignment.stockFitsGross ? 'text-green-700' : 'text-red-600'}>
                  Groß: {sliderAssignment.grossUsed.toLocaleString('de-DE')} benötigt{' '}
                  {sliderAssignment.stockFitsGross
                    ? '✓'
                    : `✗ (${(sliderAssignment.grossUsed - sliderGross).toLocaleString('de-DE')} fehlen)`}
                </p>
              </>
            ) : (
              <p className="text-gray-400">Keine Artikeldaten für Simulation.</p>
            )}
          </div>
        </div>

        {/* Apply to config button */}
        <button
          onClick={() => dispatch({ type: 'SET_CONFIG', payload: { anzahl_klein: sliderKlein, anzahl_gross: sliderGross } })}
          className="w-full py-2 rounded-lg border border-blue-300 text-blue-700 text-sm hover:bg-blue-50 transition-colors"
        >
          Dieses Verhältnis als Konfiguration übernehmen ({sliderKlein.toLocaleString('de-DE')} K / {sliderGross.toLocaleString('de-DE')} G)
        </button>
      </div>
    </div>
  );
}
