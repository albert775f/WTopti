export type ConstraintType = 'EXCLUDE_TOGETHER' | 'REQUIRE_TOGETHER' | 'MAX_PER_WT';

export interface Constraint {
  type: ConstraintType;
  artikelA: string;
  artikelB?: string;
  maxMenge?: number;
}

export function loadConstraints(json?: Constraint[]): Constraint[] {
  return json ?? [];
}

export function checkConstraints(
  _constraints: Constraint[],
  _wt: { positionen: { artikelnummer: string }[] },
  _neuePosition: { artikelnummer: string },
): { valid: boolean; verletzung?: string } {
  return { valid: true };
}
