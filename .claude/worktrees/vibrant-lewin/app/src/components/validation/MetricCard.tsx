import type { MetricResult } from '../../types';

interface Props { metric: MetricResult }

const AMPEL_COLOR = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' };

function formatValue(m: MetricResult): string {
  if (m.unit === '%') return `${(m.value * 100).toFixed(1)}%`;
  if (m.unit === 'kg') return `${m.value.toFixed(2)} kg`;
  if (m.unit === '') return m.value.toFixed(m.id === 'M9' ? 2 : 0);
  return `${m.value.toFixed(1)} ${m.unit}`;
}

function formatBaseline(m: MetricResult): string {
  if (m.unit === '%') return `${(m.baseline * 100).toFixed(1)}%`;
  if (m.unit === 'kg') return `${m.baseline.toFixed(2)} kg`;
  if (m.unit === '') return m.baseline.toFixed(m.id === 'M9' ? 2 : 0);
  return `${m.baseline.toFixed(1)} ${m.unit}`;
}

export default function MetricCard({ metric }: Props) {
  const lowerIsBetter = ['M1', 'M4', 'M5', 'M6', 'M8', 'M9', 'M10'].includes(metric.id);
  const improved = lowerIsBetter ? metric.delta < 0 : metric.delta > 0;
  const deltaColor = metric.delta === 0 ? 'text-gray-500' : improved ? 'text-green-600' : 'text-red-600';
  const arrow = metric.delta === 0 ? '' : metric.delta > 0 ? ' ↑' : ' ↓';

  const ampelDot = AMPEL_COLOR[metric.ampel] ?? '#9ca3af';

  const maxVal = Math.max(metric.value, metric.baseline, 0.001);
  const valBar = Math.min(100, (metric.value / maxVal) * 100);
  const baseBar = Math.min(100, (metric.baseline / maxVal) * 100);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{metric.id}</span>
        <span
          className="w-3 h-3 rounded-full inline-block"
          style={{ backgroundColor: ampelDot }}
          title={metric.ampel}
        />
      </div>
      <p className="text-sm text-gray-700 mb-3 leading-tight">{metric.name}</p>
      <p className="text-3xl font-bold text-gray-900 text-center mb-1">{formatValue(metric)}</p>
      <p className="text-xs text-gray-400 text-center mb-2">Baseline: {formatBaseline(metric)}</p>
      <p className={`text-xs text-center font-medium mb-3 ${deltaColor}`}>
        {metric.delta > 0 ? '+' : ''}{metric.unit === '%' ? `${(metric.delta * 100).toFixed(1)}pp` : metric.delta.toFixed(2)}{arrow}
      </p>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="w-16 text-right">Opt.</span>
          <div className="flex-1 h-2 bg-gray-100 rounded">
            <div className="h-2 bg-blue-500 rounded" style={{ width: `${valBar}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="w-16 text-right">Base</span>
          <div className="flex-1 h-2 bg-gray-100 rounded">
            <div className="h-2 bg-gray-400 rounded" style={{ width: `${baseBar}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
