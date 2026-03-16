// ============================================================
// Input Data Types (mapped from Excel columns)
// ============================================================

/** Artikelliste.xlsx – Sheet "Verpackungsvolumen Atrikel" */
export interface ArtikelData {
  artikelnummer: number;
  bezeichnung: string;
  hoehe: number;        // mm
  breite: number;       // mm
  laenge: number;       // mm
  gewicht_kg: number;
  volumen_l: number;
  sperrgut: boolean;
  max_packmenge_sperrgut: number | null;
}

/** Bestellungen Sauber.xlsx – Sheet "Bestellungen" */
export interface BestellungData {
  belegnummer: string;
  artikelnummer: number;
  menge: number;
  bezeichnung: string;
  datum: string;
  kundennummer: string;
}

/** Artikelumsatz.xlsx – Sheet "Artikelumsatz" (aggregated total) */
export interface UmsatzData {
  artikelnummer: number;
  bezeichnung: string;
  artikelmenge: number; // total quantity sold
}

/** Bestandsliste 13.03.2026.xls – Sheet "2026-03-13" */
export interface BestandData {
  artikelnummer: number;
  bestand: number;
}

// ============================================================
// ABC-Analyse
// ============================================================

export type ABCKategorie = 'A' | 'B' | 'C';

export interface ABCResult {
  artikelnummer: number;
  bezeichnung: string;
  umsatzmenge: number;
  anteil_prozent: number;
  kumuliert_prozent: number;
  kategorie: ABCKategorie;
}

// ============================================================
// Co-Occurrence / Affinitätsanalyse
// ============================================================

export interface CoOccurrencePair {
  artikel_a: number;
  artikel_b: number;
  gemeinsame_bestellungen: number;
  jaccard_index: number;
}

export interface AffinitaetsCluster {
  cluster_id: number;
  artikel: number[];
  label?: string;
}

// ============================================================
// Warenträger (WT) Konfiguration
// ============================================================

export interface WTConfig {
  name: string;
  hoehe_mm: number;
  breite_mm: number;
  tiefe_mm: number;
  max_gewicht_kg: number;
  anzahl_faecher: number;
  fach_hoehe_mm: number;
}

export const DEFAULT_WT_CONFIGS: WTConfig[] = [
  {
    name: 'Standard-WT',
    hoehe_mm: 640,
    breite_mm: 440,
    tiefe_mm: 600,
    max_gewicht_kg: 30,
    anzahl_faecher: 1,
    fach_hoehe_mm: 640,
  },
];

// ============================================================
// Bin-Packing / Belegungsplan
// ============================================================

export interface WTFach {
  fach_index: number;
  artikel: PlatzierterArtikel[];
  restvolumen_l: number;
  restgewicht_kg: number;
}

export interface PlatzierterArtikel {
  artikelnummer: number;
  bezeichnung: string;
  menge: number;
  volumen_l: number;
  gewicht_kg: number;
  abc_kategorie: ABCKategorie;
}

export interface WT {
  wt_id: number;
  config: WTConfig;
  faecher: WTFach[];
  auslastung_prozent: number;
  gewicht_gesamt_kg: number;
}

export interface BelegungsplanRow {
  wt_id: number;
  wt_name: string;
  fach_index: number;
  artikelnummer: number;
  bezeichnung: string;
  menge: number;
  abc_kategorie: ABCKategorie;
  volumen_l: number;
  gewicht_kg: number;
  auslastung_prozent: number;
}

// ============================================================
// WT-Verhältnis-Analyse / Szenario
// ============================================================

export interface WTVerteilung {
  config_name: string;
  anzahl: number;
}

export interface SzenarioResult {
  szenario_id: number;
  label: string;
  verteilung: WTVerteilung[];
  gesamt_wt: number;
  durchschn_auslastung: number;
  unplatzierte_artikel: number;
  score: number;
}

// ============================================================
// App State
// ============================================================

export type AppStep =
  | 'upload'
  | 'abc-analyse'
  | 'co-occurrence'
  | 'belegungsplan'
  | 'wt-verhaeltnis'
  | 'export';

export interface AppState {
  step: AppStep;
  artikelListe: ArtikelData[];
  bestellungen: BestellungData[];
  umsatzDaten: UmsatzData[];
  bestandsDaten: BestandData[];
  abcResults: ABCResult[];
  coOccurrences: CoOccurrencePair[];
  cluster: AffinitaetsCluster[];
  belegungsplan: WT[];
  szenarien: SzenarioResult[];
  wtConfigs: WTConfig[];
  isProcessing: boolean;
  error: string | null;
}
