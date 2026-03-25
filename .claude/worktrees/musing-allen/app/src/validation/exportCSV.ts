import type { ValidationDashboardData, WTConfig } from '../types';

export function exportValidationCSV(data: ValidationDashboardData, config: WTConfig): string {
  const rows: string[] = [];

  rows.push('Check-ID,Check-Name,Status,Fehleranzahl');
  for (const c of data.hardChecks) {
    rows.push(`${c.id},"${c.name}",${c.status},${c.errorCount}`);
  }
  rows.push('');

  rows.push('Metrik-ID,Metrik-Name,Optimiert,Baseline,Delta,Ampel');
  for (const m of data.metrics) {
    const val = m.unit === '%' ? `${(m.value * 100).toFixed(1)}%` : m.value.toFixed(2);
    const base = m.unit === '%' ? `${(m.baseline * 100).toFixed(1)}%` : m.baseline.toFixed(2);
    const delta = m.delta >= 0 ? `+${m.delta.toFixed(2)}` : m.delta.toFixed(2);
    rows.push(`${m.id},"${m.name}",${val},${base},${delta},${m.ampel}`);
  }
  rows.push('');

  rows.push('Parameter,Wert');
  rows.push(`Gewicht-Hard-Limit,${config.gewicht_hard_kg} kg`);
  rows.push(`Gewicht-Soft-Limit,${config.gewicht_soft_kg} kg`);
  rows.push(`Höhen-Limit,${config.hoehe_limit_mm} mm`);
  rows.push(`Co-Occurrence-Schwellwert,${config.co_occurrence_schwellwert}`);
  rows.push(`Simulations-Seed,42`);
  rows.push(`Simulations-Stichprobe,500`);

  return rows.join('\n');
}
