import type { WT, WTConfig, ValidationResult } from '../types';

export function processPhase4(wts: WT[], config: WTConfig): ValidationResult {
  const validation: ValidationResult = {
    hard_fails: [],
    warnungen: [],
    artikel_nicht_lagerfaehig: [],
    artikel_unvollstaendig: [],
    artikel_ohne_match: [],
  };

  for (const wt of wts) {
    // Hard fail: weight > 24kg
    if (wt.gesamtgewicht_kg > config.gewicht_hard_kg) {
      validation.hard_fails.push(
        `WT ${wt.id}: Gewicht ${wt.gesamtgewicht_kg}kg > ${config.gewicht_hard_kg}kg Limit`,
      );
    }

    // Height check is already done in phase1/phase3

    // Warning: weight 20-24kg
    if (
      wt.gesamtgewicht_kg > config.gewicht_soft_kg &&
      wt.gesamtgewicht_kg <= config.gewicht_hard_kg
    ) {
      validation.warnungen.push(
        `WT ${wt.id}: Gewicht ${wt.gesamtgewicht_kg}kg > Soft-Limit ${config.gewicht_soft_kg}kg`,
      );
    }

    // Warning: utilization < 30%
    if (wt.flaeche_netto_pct < 30 && wt.positionen.length > 0) {
      validation.warnungen.push(
        `WT ${wt.id}: Flächenauslastung nur ${wt.flaeche_netto_pct}%`,
      );
    }

    // Warning: only 1 article
    if (wt.positionen.length === 1) {
      validation.warnungen.push(
        `WT ${wt.id}: Nur 1 Artikelposition`,
      );
    }
  }

  return validation;
}
