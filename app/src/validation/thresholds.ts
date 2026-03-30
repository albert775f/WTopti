import type { ThresholdConfig, AmpelColor } from '../types';

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  M2: { green: 0.65, yellow: 0.50 },
  M3: { greenLow: 0.40, greenHigh: 0.80, yellowHigh: 0.95 },
  M4: { green: 0.05, yellow: 0.15 },
  M5: { green: 0.10, yellow: 0.25 },
  M6: { green: 0.10, yellow: 0.20 },
  M7: { green: 0.90, yellow: 0.70 },
  M8: { green: 0.30, yellow: 0.60 },
  M9: { green: 3.0, yellow: 5.0 },
};

export function getAmpel(metricId: string, value: number, thresholds: ThresholdConfig): AmpelColor {
  switch (metricId) {
    case 'M2': return value > thresholds.M2.green ? 'green' : value > thresholds.M2.yellow ? 'yellow' : 'red';
    case 'M3': {
      const t = thresholds.M3;
      if (value > t.yellowHigh) return 'red';
      if (value >= t.greenLow && value <= t.greenHigh) return 'green';
      return 'yellow';
    }
    case 'M4': return value < thresholds.M4.green ? 'green' : value < thresholds.M4.yellow ? 'yellow' : 'red';
    case 'M5': return value < thresholds.M5.green ? 'green' : value < thresholds.M5.yellow ? 'yellow' : 'red';
    case 'M6': return value < thresholds.M6.green ? 'green' : value < thresholds.M6.yellow ? 'yellow' : 'red';
    case 'M7': return value > thresholds.M7.green ? 'green' : value > thresholds.M7.yellow ? 'yellow' : 'red';
    case 'M8': return value < thresholds.M8.green ? 'green' : value < thresholds.M8.yellow ? 'yellow' : 'red';
    case 'M9': return value < thresholds.M9.green ? 'green' : value < thresholds.M9.yellow ? 'yellow' : 'red';
    default: return 'green';
  }
}
