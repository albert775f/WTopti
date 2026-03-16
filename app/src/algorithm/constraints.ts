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
  constraints: Constraint[],
  wt: { positionen: { artikelnummer: string }[] },
  neuePosition: { artikelnummer: string },
): { valid: boolean; verletzung?: string } {
  return { valid: true };
}
