# CLAUDE.md — Warenträger-Belegungsoptimierung

## Projekt-Kontext
Einmal-Tool für die Initialbestückung des **STOROJET-Automatiklagers** bei Alphacool International GmbH.
Berechnet die optimale Zuordnung von Artikeln zu Warenträgern (Klein 500×500mm / Groß 500×800mm).
Vollständige Spezifikation: `WARENTRAEGER_OPT.md` (v2.0) — **bei Unklarheiten immer zuerst lesen**.

## App starten
```bash
cd app && npm run dev     # Dev-Server auf http://localhost:5173
cd app && npm run build   # Production Build (tsc -b && vite build)
```
Build war zuletzt sauber (28 Commits, 0 TS-Fehler).

## Dateistruktur
```
WTopti/
├── WARENTRAEGER_OPT.md          # Produktspezifikation — Quelle der Wahrheit
├── CLAUDE.md                    # Diese Datei
├── Artikelliste.xlsx            # Realdaten (nur Struktur relevant, kein Inhalt)
├── Artikelumsatz.xlsx
├── Bestandsliste 13.03.2026.xls
├── Bestellungen Sauber.xlsx
└── app/
    └── src/
        ├── types/index.ts           # Alle TypeScript-Interfaces
        ├── utils/
        │   ├── csvMapping.ts        # Excel→TS-Feldname Mappings
        │   └── fileParser.ts        # CSV/XLSX Parser (Papaparse + xlsx)
        ├── algorithm/
        │   ├── phase1.ts            # Datenaufbereitung + ABC-Klassifizierung
        │   ├── phase2.ts            # Co-Occurrence-Matrix + Louvain-Clustering
        │   ├── phase3.ts            # Bin Packing FFD + Gewichts-Balancing
        │   ├── phase4.ts            # Validierung (Hard Fails + Warnungen)
        │   ├── phase5.ts            # WT-Verhältnis-Szenarien
        │   └── constraints.ts       # Constraint-API (leer implementiert)
        ├── workers/
        │   └── optimizer.worker.ts  # Web Worker: orchestriert Phase 1–5
        ├── context/AppContext.tsx   # React Context + useReducer
        ├── hooks/useOptimizer.ts    # Worker-Kommunikation Hook
        ├── components/
        │   ├── UploadSection.tsx    # Drag&Drop 4 Dateien + Config-Panel
        │   ├── ABCSection.tsx       # ABC-Analyse Charts + Tabelle
        │   ├── CoOccurrenceSection.tsx  # SVG Heatmap
        │   ├── BelegungsplanSection.tsx # WT-Tabelle expandierbar + CSV-Export
        │   ├── WTVisualization.tsx  # SVG 2D Draufsicht
        │   └── WTRatioSection.tsx   # Szenarien-Vergleich + Simulator
        ├── App.tsx                  # Sidebar-Layout + Progress-Overlay
        └── main.tsx                 # AppProvider-Wrapper
```

## Tech Stack
| Paket | Version | Zweck |
|---|---|---|
| React | 19 | UI Framework |
| TypeScript | 5.9 | Type Safety |
| Vite | 8 | Build Tool |
| Tailwind CSS | v3 (PostCSS) | Styling |
| Recharts | 3.8 | Charts (BarChart, PieChart) |
| @tanstack/react-table | 8.21 | Tabellen |
| Papaparse | 5.5 | CSV Parsing |
| xlsx | 0.18 | Excel Parsing |
| graphology | 0.26 | Graph-Datenstruktur |
| graphology-communities-louvain | 2.0 | Louvain Clustering |

**Tailwind v3**: Konfiguration über `postcss.config.js` + `tailwind.config.js`. **NICHT** @tailwindcss/vite.

**Louvain-Import**: `import louvain from 'graphology-communities-louvain'` (default export, nicht named).

## Echte Excel-Spalten vs. Spec-Felder

| Datei | Sheet | Relevante Excel-Spalten → TS-Feld |
|---|---|---|
| Artikelliste.xlsx | "Verpackungsvolumen Atrikel" | `Nummer`→artikelnummer, `Bezeichnung`, `Höhe`→hoehe, `Breite`, `Länge`→laenge, `Gewicht in kg`→gewicht_kg, `Volumen in Liter`→volumen_l |
| Bestellungen Sauber.xlsx | "Bestellungen" | `Nummer`→artikelnummer, `Menge`, `Beleg-Nr.`→belegnummer |
| Artikelumsatz.xlsx | "Artikelumsatz" | `Nummer`→artikelnummer, `Artikelmenge`→umsatz_gesamt |
| Bestandsliste 13.03.2026.xls | "2026-03-13" | `nummer`→artikelnummer, `gesamt_x`→bestand (String mit Leerzeichen!) |

**Kritische Abweichungen von der Spec:**
- `Artikelumsatz` hat **keine 14 Monatsspalten** — nur aggregierte `Artikelmenge`. ABC läuft über Gesamtmenge. `detectUmsatzMonthColumns()` ist für zukünftige Monatsdaten vorbereitet.
- `Bestandsliste` hat **kein `In_Abwicklung`** Feld.
- `gesamt_x` in Bestandsliste ist ein **String mit Leerzeichen** → `parseInt(val.replace(/\s/g, ''))`.

## WT-Konfiguration (Defaults)
```typescript
const DEFAULT_CONFIG: WTConfig = {
  anzahl_klein: 4145,            // Aktueller Bestand
  anzahl_gross: 1111,
  gewicht_hard_kg: 24,           // Hard Limit (mit Storojet abstimmen!)
  gewicht_soft_kg: 20,           // Storojet-Standard
  hoehe_limit_mm: 320,
  teiler_breite_mm: 5,           // Noch zu klären mit Lagerplanung
  teiler_verlust_prozent: 2,     // Alternative: pauschaler %-Abzug
  teiler_modus: 'percent',       // 'exact' | 'percent'
  co_occurrence_schwellwert: 3,
};
```

## Algorithmus-Logik (Kurzübersicht)
1. **Phase 1** — Join Artikel+Bestand+Umsatz, Grundfläche=B×L, ABC via kumuliertem Umsatzanteil (A=20%,B=30%,C=50%), Bestand=0 → skip
2. **Phase 2** — Co-Occurrence-Matrix aus Belegnummern, Louvain auf Graph (Kante wenn ≥ Schwellwert), max 2 A-Artikel pro Cluster
3. **Phase 3** — FFD Bin Packing: nach Grundfläche absteigend, **dynamische Nutzfläche** (Teiler bei jedem neuen Artikeltyp neu berechnen!), Gewichts-Balancing bei >20kg
4. **Phase 4** — Hard Fails: >24kg, >320mm, Artikel nicht platziert. Warnungen: 20-24kg, <30% Auslastung
5. **Phase 5** — Szenarien: Aktuell / Nur Kleine / Mehr Große / Optimiert (±10%/20% Varianten)

## Git-Status
- Branch: `main`, 28 Commits, clean
- **Remote-Repo fehlt noch** — `gh` ist installiert, aber Token braucht `repo`-Scope:
  ```bash
  # Classic PAT mit 'repo'-Scope anlegen auf github.com/settings/tokens, dann:
  echo "TOKEN" | gh auth login --with-token
  gh repo create WTopti --private --source=. --remote=origin --push
  ```

## Offene Punkte (aus Spec Section 8)
1. Exakte Teilerbreite/-anordnung → kläre mit Lagerplanung (aktuell: pauschaler 2%-Abzug)
2. 24 kg Gewichtslimit mit Storojet bestätigen
3. Artikel > 320mm Höhe prüfen nach erster echter Datenanalyse
4. Äquivalenz 2G=3K fix oder flexibel? (Einfluss auf Stellplatz-Berechnung)

## Constraint-Modul (erweiterbar)
`constraints.ts` hat fertige API (`EXCLUDE_TOGETHER`, `REQUIRE_TOGETHER`, `MAX_PER_WT`), aber leere Implementierung. Laden via optionalem JSON-Upload oder CSV geplant.
