// ============ INPUT TYPES ============

/** Artikelliste – from backend API (dimensions already in mm, pre-computed fields) */
export interface ArtikelData {
  artikelnummer: string;
  bezeichnung: string;
  hoehe_mm: number;       // mm (converted from cm by backend)
  breite_mm: number;      // mm
  laenge_mm: number;      // mm
  gewicht_kg: number;
  volumen_l?: number;
  grundflaeche_mm2: number;   // breite_mm × laenge_mm (pre-computed by backend)
  max_stapelhoehe: number;    // floor(320 / hoehe_mm) (pre-computed by backend)
}

/** Bestellungen Sauber.xlsx – Sheet "Bestellungen"
 *  Excel-Spalten: VK-Stufe, Datum, Kunden-Nr., Beleg-Nr., Lfd.Nr. Pos, Menge,
 *                 Nummer, Bezeichnung, Gewicht Umsatz, Gewicht Artikel,
 *                 Anzahl Pakete, Gewicht Pro Paket, Versandnr., Versandart */
export interface BestellungData {
  artikelnummer: string;
  menge: number;
  belegnummer: string;
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
  teiler_breite_mm: number;       // default: 5
  teiler_verlust_prozent: number; // default: 2 (legacy, not used by strip model)
  teiler_modus: 'exact' | 'percent'; // legacy, strip model uses teiler_breite_mm
  co_occurrence_schwellwert: number; // default: 3
  a_artikel_scatter_n: number;    // default: 3 — split A-articles across n WTs
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
  breite_mm?: number;  // strip depth for balancing recalculation
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

// ============ VALIDIERUNGSERGEBNIS ============

export interface ValidationResult {
  hard_fails: string[];
  warnungen: string[];
  artikel_nicht_lagerfaehig: string[];    // Höhe > 320mm
  artikel_unvollstaendig: string[];       // Fehlende Maße/Gewicht
  artikel_ohne_match: string[];           // Bestellarchiv ohne Artikelliste-Match
  fehlende_artikel?: Array<{ artikelnummer: string; bestand: number }>; // Bestand ohne Artikelliste
  fehlende_bestand_gesamt?: number;       // Summe Bestand der fehlenden Artikel
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
}
