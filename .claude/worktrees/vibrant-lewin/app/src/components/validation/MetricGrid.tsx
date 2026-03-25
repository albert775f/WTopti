import type { MetricResult } from '../../types';
import MetricCard from './MetricCard';

interface Props { metrics: MetricResult[] }

export default function MetricGrid({ metrics }: Props) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {metrics.map(m => <MetricCard key={m.id} metric={m} />)}
    </div>
  );
}
