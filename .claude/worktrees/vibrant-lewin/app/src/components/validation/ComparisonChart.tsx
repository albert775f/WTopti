import type { MetricResult } from '../../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface Props { metrics: MetricResult[] }

const LOWER_IS_BETTER = new Set(['M1', 'M4', 'M5', 'M6', 'M8', 'M9', 'M10']);

export default function ComparisonChart({ metrics }: Props) {
  const data = metrics.map(m => {
    const maxV = Math.max(m.value, m.baseline, 0.0001);
    let optNorm = Math.min(100, (m.value / maxV) * 100);
    let baseNorm = Math.min(100, (m.baseline / maxV) * 100);
    if (LOWER_IS_BETTER.has(m.id)) {
      optNorm = 100 - optNorm;
      baseNorm = 100 - baseNorm;
    }
    return { id: m.id, Optimiert: Math.round(optNorm), Baseline: Math.round(baseNorm) };
  });

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-600 mb-3">Vergleich Optimiert vs. Baseline (höher = besser)</h4>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <XAxis dataKey="id" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value) => `${value}%`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Optimiert" fill="#3b82f6" maxBarSize={20} />
          <Bar dataKey="Baseline" fill="#9ca3af" maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
