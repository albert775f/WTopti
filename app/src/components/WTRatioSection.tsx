import { useMemo, useState } from 'react';
import { useAppState } from '../context/AppContext';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

export default function WTRatioSection() {
  const { result } = useAppState();
  const [customKlein, setCustomKlein] = useState(4145);
  const [customGross, setCustomGross] = useState(1111);

  const szenarien = result?.szenarien ?? [];
  const rec = result?.wt_recommendation;

  const chartData = useMemo(() => {
    return szenarien.map((s) => ({
      name: s.szenario,
      flaeche: Math.round(s.auslastung_flaeche_avg * 10) / 10,
      gewicht: Math.round(s.auslastung_gewicht_avg * 10) / 10,
    }));
  }, [szenarien]);

  const stellplaetze = customKlein + customGross * 1.5;

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

      {/* Recommendation card */}
      {rec && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">💡</span>
            <div>
              <p className="font-semibold text-blue-900">Empfehlung</p>
              <p className="text-sm text-blue-800 mt-1">{rec.empfehlung}</p>
            </div>
          </div>

          {/* Allocation table */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            {/* KLEIN */}
            <div className="bg-white rounded-lg border border-blue-100 p-3">
              <p className="font-semibold text-gray-700 mb-2">KLEIN-WTs (500×500 mm)</p>
              <div className="space-y-1">
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
              <div className="mt-2 bg-gray-100 rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-blue-500"
                  style={{ width: `${Math.min(100, (rec.optimal_klein_used / rec.available_klein) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {Math.round((rec.optimal_klein_used / rec.available_klein) * 100)}% belegt
              </p>
            </div>

            {/* GROSS */}
            <div className="bg-white rounded-lg border border-blue-100 p-3">
              <p className="font-semibold text-gray-700 mb-2">GROSS-WTs (500×800 mm)</p>
              <div className="space-y-1">
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
                  <span className={`font-mono font-semibold ${rec.gross_free < 10 ? 'text-green-600' : 'text-gray-600'}`}>
                    {rec.gross_free.toLocaleString('de-DE')}
                  </span>
                </div>
              </div>
              <div className="mt-2 bg-gray-100 rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-amber-500"
                  style={{ width: `${Math.min(100, (rec.optimal_gross_used / rec.available_gross) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {Math.round((rec.optimal_gross_used / rec.available_gross) * 100)}% belegt
              </p>
            </div>
          </div>

          {/* Article breakdown */}
          <div className="flex gap-6 text-sm text-blue-800 border-t border-blue-200 pt-3">
            <span><strong>{rec.articles_on_gross.toLocaleString('de-DE')}</strong> Artikel-Typen auf GROSS
              {rec.articles_must_gross > 0 && ` (davon ${rec.articles_must_gross} zwingend)`}
            </span>
            <span><strong>{rec.articles_on_klein.toLocaleString('de-DE')}</strong> Artikel-Typen auf KLEIN</span>
            {rec.klein_saved > 0 && (
              <span className="text-green-700 font-semibold">↓ {rec.klein_saved} KLEIN-WTs eingespart vs. reine KLEIN-Strategie</span>
            )}
          </div>
        </div>
      )}

      {/* Scenario Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Szenario', 'Klein', 'Groß', 'Stellpl. (K-Äq.)', 'WT gesamt', 'Ø Fläche%', 'Ø Gewicht%', 'Ungenutzt', 'Score'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {szenarien.map((s, i) => (
              <tr key={s.szenario}
                className={`border-b ${i === 0 ? 'bg-blue-50 font-semibold' : 'hover:bg-gray-50'}`}>
                <td className="px-3 py-2">{s.szenario}{i === 0 && <span className="ml-1 text-xs text-blue-600">★</span>}</td>
                <td className="px-3 py-2">{s.anzahl_klein.toLocaleString('de-DE')}</td>
                <td className="px-3 py-2">{s.anzahl_gross.toLocaleString('de-DE')}</td>
                <td className="px-3 py-2">{s.stellplaetze_k_aequiv.toLocaleString('de-DE')}</td>
                <td className="px-3 py-2">{(s.anzahl_klein + s.anzahl_gross - s.wts_ungenutzt).toLocaleString('de-DE')}</td>
                <td className="px-3 py-2">{s.auslastung_flaeche_avg.toFixed(1)}%</td>
                <td className="px-3 py-2">{s.auslastung_gewicht_avg.toFixed(1)}%</td>
                <td className="px-3 py-2">{s.wts_ungenutzt.toLocaleString('de-DE')}</td>
                <td className="px-3 py-2">{s.co_occurrence_score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Szenarien-Vergleich (Ø Auslastung)</h3>
          <ResponsiveContainer width="100%" height={250}>
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

      {/* Interactive Calculator */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Stellplatz-Kalkulator</h3>
        <div className="flex items-end gap-4">
          <label className="block text-sm">
            <span className="text-gray-600">Klein-Anzahl</span>
            <input type="number" value={customKlein}
              onChange={(e) => setCustomKlein(+e.target.value)}
              className="mt-1 block w-32 rounded border-gray-300 border px-2 py-1" />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">Groß-Anzahl</span>
            <input type="number" value={customGross}
              onChange={(e) => setCustomGross(+e.target.value)}
              className="mt-1 block w-32 rounded border-gray-300 border px-2 py-1" />
          </label>
          <div className="text-sm">
            <span className="text-gray-600">K-Äquivalente: </span>
            <span className="font-bold text-lg text-blue-700">{stellplaetze.toLocaleString('de-DE')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
