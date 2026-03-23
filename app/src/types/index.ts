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
  breite_mm?: number;      // strip depth (article breite, for balancing + visualization)
  laenge_mm?: number;      // article length (for strip-aware visualization)
  max_stapelhoehe?: number; // floor(320/hoehe_mm) (for strip capacity in visualization)
  // Zone layout coords set by phase3 (used by WTVisualization to render 1:1 without re-layout)
  zone_x?: number;         // x offset on WT (mm from left edge)
  zone_y?: number;         // y offset on WT (mm from front/top edge)
  zone_w?: number;         // zone width mm
  zone_h?: number;         // zone depth mm
}

export interface WT {
  id: string;                     // z.B. "K-0001", "G-0001"
  typ: WTTyp;
  positionen: WTPosition[];
  cluster_id: number;
  gesamtgewicht_kg: number;
  flaeche_brutto_mm2: number;     // 250000 (K) oder 400000 (G)
  flaeche_netto_mm2: number;      // nach Teilerabzug
  flaeche_netto_pct: number;      // Auslastung %
  anzahl_teiler: number;
  gewicht_status: 'ok' | 'soft_warn' | 'hard_fail';
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

export interface WTRatioRecommendation {
  warehouse_area_m2: number;
  area_used_m2: number;
  area_free_m2: number;
  area_free_pct: number;
  available_klein: number;
  available_gross: number;
  optimal_klein_used: number;
  optimal_gross_used: number;
  klein_free: number;
  gross_free: number;
  articles_on_klein: number;
  articles_on_gross: number;
  articles_must_gross: number;
  articles_weight_limited: number;
  articles_geometry_limited: number;
  wts_if_all_klein: number;
  wts_optimal: number;
  klein_saved: number;
  top_gross_examples: ArticleCost[];  // top 3 examples where GROSS saves most floor space
  empfehlung: string;
}

// ============ OUTPUT 2: SZENARIO-ERGEBNIS ============

export interface SzenarioResult {
  szenario: string;
  anzahl_klein: number;
  anzahl_gross: number;
  stellplaetze_k_aequiv: number;  // K + G×1.5
  auslastung_flaeche_avg: number; // %
  auslastung_gewicht_avg: number; // %
  wts_ungenutzt: number;
  wts_ueberlast: number;          // 20-24 kg
  co_occurrence_score: number;
  empfehlung: string;
}

// ============ EXCLUSION LOG TYPES ============

export type ExclusionReason =
  | 'SPERRGUT'
  | 'HEIGHT_EXCEEDED'
  | 'WEIGHT_EXCEEDED'
  | 'DIMENSIONS_MISSING'
  | 'WEIGHT_MISSING'
  | 'NO_MASTER_RECORD'
  | 'SON_ARTICLE';

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
  szenarien: SzenarioResult[];
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
  wt_recommendation?: WTRatioRecommendation;
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
