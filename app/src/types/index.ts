// ============ INPUT TYPES ============

/** Artikelliste – from backend API (dimensions already in mm, pre-computed fields) */
export interface ArtikelData {
  artikelnummer: string;
  bezeichnung: string;
  hoehe_mm: number;       // mm (converted from cm by backend); 0 if missing in source
  breite_mm: number;      // mm; 0 if missing in source
  laenge_mm: number;      // mm; 0 if missing in source
  gewicht_kg: number;     // 0 if missing in source
  volumen_l?: number;
  grundflaeche_mm2: number;   // breite_mm × laenge_mm (pre-computed by backend)
  max_stapelhoehe: number;    // floor(300 / hoehe_mm); 0 if hoehe_mm=0
  sperrgut?: string;          // raw Sperrgut value from Excel, e.g. 'Lager B'
}

/** Bestellungen Sauber.xlsx – Sheet "Bestellungen"
 *  Excel-Spalten: VK-Stufe, Datum, Kunden-Nr., Beleg-Nr., Lfd.Nr. Pos, Menge,
 *                 Nummer, Bezeichnung, Gewicht Umsatz, Gewicht Artikel,
 *                 Anzahl Pakete, Gewicht Pro Paket, Versandnr., Versandart */
export interface BestellungData {
  artikelnummer: string;
  menge: number;
  belegnummer: string;
  datum?: string;       // "YYYY-MM-DD" — used for monthly peak/median storojet calc
  bezeichnung?: string; // optional — used for SON article detection if server sends it
}

/** Bestandsliste 13.03.2026.xls – Sheet "2026-03-13"
 *  Excel-Spalten: nummer, gesamt_x
 *  HINWEIS: Kein "In_Abwicklung"-Feld in der realen Datei. */
export interface BestandData {
  artikelnummer: string;
  bestand: number;
  in_abwicklung?: number;
}

// ============ PROCESSED TYPES ============

export interface ArtikelProcessed extends ArtikelData {
  // grundflaeche_mm2 and max_stapelhoehe inherited from ArtikelData
  umsatz_gesamt: number;          // SUM(menge) from Bestellungen
  abc_klasse: 'A' | 'B' | 'C';
  bestand: number;                // = bestand_storojet — algorithm uses this value
  in_abwicklung: number;
  platzbedarf_mm2: number;        // bestand × grundflaeche_mm2
  cluster_id?: number;
  warnungen: string[];
  // Bestandsoptimierung
  bestand_gesamt: number;         // Original-Lagerbestand
  bestand_storojet: number;       // Berechneter STOROJET-Bestand (= bestand nach Decklung)
  bestand_regal: number;          // = bestand_gesamt - bestand_storojet
  weekly_demand: number;          // Wochenverbrauch (Stk/Woche)
  order_count: number;            // Anzahl bereinigte Bestellungen
  is_median_article: boolean;     // true = Bulk-Erkennung, Median-Formel aktiv
}

// ============ CONFIG TYPES ============

export interface WTConfig {
  gewicht_hard_kg: number;        // default: 24
  gewicht_soft_kg: number;        // default: 20
  hoehe_limit_mm: number;         // default: 300
  teiler_breite_mm: number;          // hardcoded 5 mm — not configurable (spec §6)
  teiler_verlust_prozent?: number;   // legacy, removed from UI
  teiler_modus?: 'exact' | 'percent'; // legacy, removed from UI
  /** @deprecated No longer used by Phase 2. Retained for backwards compatibility. */
  co_occurrence_schwellwert?: number;
  warehouse_area_m2: number;      // default: 1480.65 — total STOROJET rack floor area
  min_segment_mm: number;         // default: 90 — minimum zone width AND depth (hand reachability)
  griff_puffer_mm: number;        // default: 0 — required free space on at least one zone side for gripping
  // Affinity-based packing parameters (algorithm-internal, hidden from main UI)
  affinity_threshold: number;      // Min P(B|A) to include a pair. Default: 0.15
  affinity_min_count: number;      // Min co-occurrence count. Default: 5
  affinity_min_orders_a: number;   // Min order count for seed article. Default: 10
  // Bestandsoptimierung
  /** @deprecated No longer used by Phase 1. bestand_storojet is now derived from peak/median monthly demand. */
  refill_weeks: number;            // kept for backwards compat; ignored by algorithm
  exclude_prefixes: string[];      // default: ['VML','VMB','SAM','OEM','SON'] — hidden
  min_order_count: number;         // default: 5 — hidden
  bulk_top3_threshold: number;     // default: 0.50 — hidden
}

// ============ WT + OUTPUT TYPES ============

export type WTTyp = 'KLEIN' | 'GROSS';

export interface WTPosition {
  artikelnummer: string;
  bezeichnung: string;
  stueckzahl: number;
  grundflaeche_mm2: number;
  gewicht_kg: number;
  abc_klasse: 'A' | 'B' | 'C';
  hoehe_mm: number;        // vertical dimension of article
  breite_mm: number;       // footprint dimension
  laenge_mm: number;       // footprint dimension
  max_stapelhoehe: number; // floor(300/hoehe_mm)
  zone_index: number;      // 0-based zone index on this WT
  row_index: number;       // depth row (0-based)
  col_index: number;       // column: 0 = left/full, 1 = right (Mode B only)
}

export interface WT {
  id: string;                     // z.B. "K-0001", "G-0001"
  typ: WTTyp;
  mode: 'A' | 'B';               // A = full 500mm width, B = 2×250mm columns
  positionen: WTPosition[];
  cluster_id: number;
  gesamtgewicht_kg: number;
  flaeche_brutto_mm2: number;     // 250000 (K) oder 400000 (G)
  flaeche_netto_pct: number;      // % of zones occupied (positionen.length / zone_count * 100)
  anzahl_teiler: number;          // (rows-1) cross dividers + 1 longitudinal (Mode B)
  gewicht_status: 'ok' | 'soft_warn' | 'hard_fail';
  grid_cols: number;              // 1 (Mode A) or 2 (Mode B)
  grid_rows: number;              // number of depth rows
  zone_count: number;             // grid_rows * grid_cols
  zone_w_mm: number;              // 500 (Mode A) or 250 (Mode B)
  zone_depths_mm: number[];       // depth per row, e.g. [100, 200, 200]
  zone_d_mm: number;              // DEPRECATED — avg row depth, kept for backward compat (C7 check)
}

// ============ AFFINITY TYPES (Phase 2) ============

/** A directional affinity relationship between two articles. */
export interface AffinityPair {
  seed: string;             // artikelnummer of the more frequently ordered article
  partner: string;          // artikelnummer of the co-occurring article
  pGivenSeed: number;       // P(partner | seed)
  pGivenPartner: number;    // P(seed | partner)
  coOccCount: number;       // Raw co-occurrence count
}

/** A group of articles to be packed together onto the same WT. */
export interface AffinityGroup {
  id: number;
  members: string[];        // artikelnummern — seed first, then partners by descending P(B|A)
  pairs: AffinityPair[];    // All significant pairs within the group
  isSingleton: boolean;     // true = no significant partner found; routes to FFD path
}

/** Return type of processPhase2 — replaces ClusterResult. */
export interface AffinityResult {
  groups: AffinityGroup[];
  pairs: AffinityPair[];                              // All significant pairs (for dashboard)
  /** For each article: all partners sorted by affinity descending. Affinity = max(P(B|A), P(A|B)). */
  partnerIndex: Map<string, Array<{ partner: string; affinity: number }>>;
  coMatrix: Record<string, Record<string, number>>;   // Raw counts — same structure as before
  singletonCount: number;
  groupCount: number;
}

// ============ EXCLUSION LOG TYPES ============

export type ExclusionReason =
  | 'SPERRGUT'
  | 'HEIGHT_EXCEEDED'
  | 'WEIGHT_EXCEEDED'
  | 'DIMENSIONS_MISSING'
  | 'WEIGHT_MISSING'
  | 'NO_MASTER_RECORD'
  | 'SON_ARTICLE'
  | 'SEGMENT_TOO_SMALL'
  | 'PREFIX_EXCLUDED'
  | 'LOW_FREQUENCY';

export interface ExclusionLogEntry {
  artikelnummer: string;
  bezeichnung: string;           // "— unknown —" if not available
  exclusion_reason: ExclusionReason;
  exclusion_phase: 'FILTER' | 'VALIDATION';
  bestand: number;               // 0 for SON articles (no physical stock)
  detail: string;                // e.g. "Height_mm=510"
}

// ============ VALIDIERUNGSERGEBNIS ============

export interface ValidationResult {
  hard_fails: string[];
  warnungen: string[];
  artikel_nicht_lagerfaehig: string[];    // Höhe > 300mm
  artikel_unvollstaendig: string[];       // Fehlende Maße/Gewicht
  artikel_ohne_match: string[];           // Bestellarchiv ohne Artikelliste-Match
  fehlende_artikel?: Array<{ artikelnummer: string; bestand: number }>; // Bestand ohne Artikelliste
  fehlende_bestand_gesamt?: number;       // Summe Bestand der fehlenden Artikel
  exclusion_log?: ExclusionLogEntry[];    // All excluded articles with reason
}

// ============ OPTIMIZATION RESULT ============

export interface OptimizationResult {
  wts: WT[];
  validation: ValidationResult;
  stats: {
    artikel_gesamt: number;
    artikel_platziert: number;
    wts_benoetigt: number;
    wts_klein: number;
    wts_gross: number;
    gesamtbestand: number;
  };
  validation_dashboard?: ValidationDashboardData;
  coMatrix?: Record<string, Record<string, number>>;
}

// ============ VALIDATION TYPES ============

export type AmpelColor = 'green' | 'yellow' | 'red';

export interface HardCheckDetail {
  key: string;
  expected: string;
  actual: string;
  message: string;
}

export interface HardCheckResult {
  id: string;         // "C1"..."C7"
  name: string;
  status: 'PASS' | 'FAIL';
  errorCount: number;
  details: HardCheckDetail[];
}

export interface MetricResult {
  id: string;         // "M1"..."M10"
  name: string;
  value: number;
  baseline: number;
  delta: number;
  deltaPercent: number;
  ampel: AmpelColor;
  unit: string;       // "%", "kg", "Stück", ""
}

export interface ExtremeEntry {
  rank: number;
  key: string;        // Artikelnr. or WT-ID
  label: string;
  value: number;
  unit: string;
  targetWTId?: string;
}

export interface ThresholdConfig {
  M2: { green: number; yellow: number };
  M3: { greenLow: number; greenHigh: number; yellowHigh: number };
  M4: { green: number; yellow: number };
  M5: { green: number; yellow: number };
  M6: { green: number; yellow: number };
  M7: { green: number; yellow: number };
  M8: { green: number; yellow: number };
  M9: { green: number; yellow: number };
}

export interface OrderSimulationResult {
  seed: number;
  sampleSize: number;
  pickCounts: number[];
  histogram: Array<{ bin: number; count: number }>;
  meanPicks: number;
  medianPicks: number;
  baselineHistogram: Array<{ bin: number; count: number }>;
  baselineMeanPicks: number;
}

export interface ExtremesResult {
  largestArticle: ExtremeEntry[];
  heaviestArticle: ExtremeEntry[];
  highestStock: ExtremeEntry[];
  mostOrdered: ExtremeEntry[];
  topCoOccPair: ExtremeEntry[];
  fullestWTs: ExtremeEntry[];
  emptiestWTs: ExtremeEntry[];
  mostArticleTypes: ExtremeEntry[];
}

export interface ValidationDashboardData {
  status: 'PASSED' | 'FAILED' | 'WARNING';
  hardChecks: HardCheckResult[];
  metrics: MetricResult[];
  baselineWTCount: number;
  orderSimulation: OrderSimulationResult | null;
  extremes: ExtremesResult;
  warnings: string[];
}
