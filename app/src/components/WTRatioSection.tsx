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

  const empfohlen = useMemo(() => {
    return szenarien.find((s) => s.empfehlung && s.empfehlung.length > 0) ?? szenarien[0];
  }, [szenarien]);

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

      {/* Recommendation */}
      {empfohlen && empfohlen.empfehlung && (
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
          <p className="text-sm font-semibold text-blue-800">Empfehlung</p>
          <p className="text-sm text-blue-700 mt-1">{empfohlen.empfehlung}</p>
          <p className="text-xs text-blue-600 mt-1">
            Szenario: {empfohlen.szenario} | Klein: {empfohlen.anzahl_klein} | Groß: {empfohlen.anzahl_gross}
          </p>
        </div>
      )}

      {/* Scenario Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Szenario', 'Klein', 'Groß', 'Stellpl. (K-Äq.)', 'Ø Fläche%', 'Ø Gewicht%', 'Ungenutzt', 'Überlast', 'Score'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {szenarien.map((s) => {
              const isEmpf = empfohlen && s.szenario === empfohlen.szenario;
              return (
                <tr key={s.szenario}
                  className={`border-b ${isEmpf ? 'bg-blue-50 font-semibold' : 'hover:bg-gray-50'}`}>
                  <td className="px-3 py-2">{s.szenario}</td>
                  <td className="px-3 py-2">{s.anzahl_klein.toLocaleString('de-DE')}</td>
                  <td className="px-3 py-2">{s.anzahl_gross.toLocaleString('de-DE')}</td>
                  <td className="px-3 py-2">{s.stellplaetze_k_aequiv.toLocaleString('de-DE')}</td>
                  <td className="px-3 py-2">{s.auslastung_flaeche_avg.toFixed(1)}%</td>
                  <td className="px-3 py-2">{s.auslastung_gewicht_avg.toFixed(1)}%</td>
                  <td className="px-3 py-2">{s.wts_ungenutzt}</td>
                  <td className="px-3 py-2">{s.wts_ueberlast}</td>
                  <td className="px-3 py-2">{s.co_occurrence_score.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Szenarien-Vergleich</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" />
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
