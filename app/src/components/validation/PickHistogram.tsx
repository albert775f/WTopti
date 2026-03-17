import type { OrderSimulationResult } from '../../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface Props { simulation: OrderSimulationResult }

export default function PickHistogram({ simulation }: Props) {
  const data = simulation.histogram.map((h, i) => ({
    bin: h.bin >= 6 ? '6+' : String(h.bin),
    Optimiert: h.count,
    Baseline: simulation.baselineHistogram[i]?.count ?? 0,
  }));

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-600 mb-1">M9: Picks pro Bestellung (Simulation n={simulation.sampleSize})</h4>
      <p className="text-xs text-gray-400 mb-3">
        Ø Optimiert: <strong>{simulation.meanPicks.toFixed(2)}</strong> | Ø Baseline: <strong>{simulation.baselineMeanPicks.toFixed(2)}</strong>
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <XAxis dataKey="bin" tick={{ fontSize: 11 }} label={{ value: 'Picks/Bestellung', position: 'insideBottom', offset: -2, fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Optimiert" fill="#3b82f6" maxBarSize={30} />
          <Bar dataKey="Baseline" fill="#9ca3af" maxBarSize={30} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
