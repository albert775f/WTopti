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
  max_stapelhoehe: number;    // floor(320 / hoehe_mm); 0 if hoehe_mm=0
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
  bestand: number;
  in_abwicklung: number;
  platzbedarf_mm2: number;        // bestand × grundflaeche_mm2
  cluster_id?: number;
  warnungen: string[];
}

// ============ CONFIG TYPES ============

export interface WTConfig {
  anzahl_klein: number;           // default: 4145
  anzahl_gross: number;           // default: 1111
  gewicht_hard_kg: number;        // default: 24
  gewicht_soft_kg: number;        // default: 20
  hoehe_limit_mm: number;         // default: 320
  teiler_breite_mm: number;          // hardcoded 5 mm — not configurable (spec §6)
  teiler_verlust_prozent?: number;   // legacy, removed from UI
  teiler_modus?: 'exact' | 'percent'; // legacy, removed from UI
  co_occurrence_schwellwert: number; // default: 3
  a_artikel_scatter_n: number;    // default: 3 — split A-articles across n WTs
  warehouse_area_m2: number;      // default: 1480.65 — total STOROJET rack floor area
  min_segment_mm: number;         // default: 90 — minimum zone width AND depth (hand reachability)
  griff_puffer_mm: number;        // default: 0 — required free space on at least one zone side for gripping
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
  max_stapelhoehe: number; // floor(320/hoehe_mm)
  zone_index: number;      // 0-based zone index on this WT
}

export interface WT {
  id: string;                     // z.B. "K-0001", "G-0001"
  typ: WTTyp;
  positionen: WTPosition[];
  cluster_id: number;
  gesamtgewicht_kg: number;
  flaeche_brutto_mm2: number;     // 250000 (K) oder 400000 (G)
  flaeche_netto_pct: number;      // % of zones occupied (positionen.length / zone_count * 100)
  anzahl_teiler: number;          // (cols-1) + (rows-1)
  gewicht_status: 'ok' | 'soft_warn' | 'hard_fail';
  grid_cols: number;              // grid columns
  grid_rows: number;              // grid rows
  zone_count: number;             // grid_cols * grid_rows
  zone_w_mm: number;              // uniform zone width
  zone_d_mm: number;              // uniform zone depth
}

// ============ OUTPUT 1: BELEGUNGSPLAN ============

export interface BelegungsplanRow {
  warentraeger_id: string;
  warentraeger_typ: WTTyp;
  artikelnummer: string;
  bezeichnung: string;
  stueckzahl: number;
  cluster_id: number;
  abc_klasse: 'A' | 'B' | 'C';
  gesamtgewicht_kg: number;
  flaeche_netto_pct: number;
  anzahl_teiler: number;
}

// ============ WT-RATIO RECOMMENDATION ============

export interface ArticleCost {
  artikelnummer: string;
  bezeichnung: string;
  bestand: number;
  fits_klein: boolean;
  items_per_klein: number;
  n_klein: number;
  area_cost_klein: number;   // m² floor space if stored on KLEIN
  items_per_gross: number;
  n_gross: number;
  area_cost_gross: number;   // m² floor space if stored on GROSS
  best_type: 'KLEIN' | 'GROSS';
  area_saving: number;       // area_cost_klein - area_cost_gross (positive = GROSS saves floor space)
  is_weight_limited: boolean; // items_per_klein === items_per_gross (weight cap dominates)
}

export interface WTRatioResult {
  warehouse_area_m2: number;          // 1480.65

  // Step 1: What the stock demands (unconstrained)
  demand_klein: number;               // WTs needed for KLEIN-optimal articles
  demand_gross: number;               // WTs needed for GROSS-optimal articles
  demand_area_m2: number;             // total floor area the stock needs
  demand_area_pct: number;            // demand_area / warehouse_area × 100

  // Step 2: Scaled to warehouse capacity
  scaled_klein: number;               // recommended KLEIN count (purchase number)
  scaled_gross: number;               // recommended GROSS count (purchase number)
  scaled_area_m2: number;             // should ≈ warehouse_area_m2

  // Reserve (scaled − demand = spare WTs for growth)
  reserve_klein: number;
  reserve_gross: number;
  reserve_area_m2: number;

  // Breakdown
  articles_must_gross: number;
  articles_prefer_gross: number;
  articles_on_klein: number;

  // Comparison to current config (informational only)
  config_klein: number;
  config_gross: number;
  delta_klein: number;               // scaled_klein − config_klein
  delta_gross: number;               // scaled_gross − config_gross

  // Status
  fits_warehouse: boolean;           // demand_area ≤ warehouse_area (after best-effort shift)
  overflow_m2: number;               // if > 0: demand exceeds warehouse

  top_gross_examples: ArticleCost[];
  recommendation: string;
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
  | 'SEGMENT_TOO_SMALL';

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
  artikel_nicht_lagerfaehig: string[];    // Höhe > 320mm
  artikel_unvollstaendig: string[];       // Fehlende Maße/Gewicht
  artikel_ohne_match: string[];           // Bestellarchiv ohne Artikelliste-Match
  fehlende_artikel?: Array<{ artikelnummer: string; bestand: number }>; // Bestand ohne Artikelliste
  fehlende_bestand_gesamt?: number;       // Summe Bestand der fehlenden Artikel
  exclusion_log?: ExclusionLogEntry[];    // All excluded articles with reason
}

// ============ OPTIMIZATION RESULT ============

export interface OptimizationResult {
  wts: WT[];
  belegungsplan: BelegungsplanRow[];
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
  wt_ratio?: WTRatioResult;
  article_costs?: ArticleCost[];
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
  id: string;         // "C1"..."C8"
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
