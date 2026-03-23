# CLAUDE.md — Warenträger-Belegungsoptimierung

## Projekt-Kontext
Einmal-Tool für die Initialbestückung des **STOROJET-Automatiklagers** bei Alphacool International GmbH.
Berechnet die optimale Zuordnung von Artikeln zu Warenträgern (Klein 500×500mm / Groß 500×800mm).
Vollständige Spezifikation: `WARENTRAEGER_OPT.md` (v2.0) — **bei Unklarheiten immer zuerst lesen**.

## App starten
```bash
# Terminal 1: PostgreSQL
docker-compose up -d

# Terminal 2: Backend
cd server && npm run dev   # Port 3001

# Terminal 3: Frontend
cd app && npm run dev      # Port 5173
cd app && npm run build    # Production Build (tsc -b && vite build)
```
Build zuletzt sauber (~40 Commits, 0 TS-Fehler). Remote: `https://github.com/albert775f/WTopti.git`

## Dateistruktur
```
WTopti/
├── WARENTRAEGER_OPT.md          # Produktspezifikation — Quelle der Wahrheit
├── CLAUDE.md                    # Diese Datei
├── docker-compose.yml           # PostgreSQL 16-alpine (Port 5432, DB/User/PW: wtopti)
├── Artikelliste.xlsx            # Realdaten
├── Bestandsliste 13.03.2026.xls
├── Bestellungen Sauber.xlsx     # (umbenannt zu Bestellungen.xlsx)
├── server/                      # Express + TypeScript Backend (Port 3001)
│   └── src/
│       ├── routes/upload.ts     # POST /api/upload/static + /api/upload/bestand
│       └── routes/data.ts       # GET /api/data, GET /api/status
└── app/
    └── src/
        ├── types/index.ts           # Alle TypeScript-Interfaces
        ├── utils/
        │   ├── csvMapping.ts        # Excel→TS-Feldname Mappings
        │   └── fileParser.ts        # CSV/XLSX Parser (Papaparse + xlsx)
        ├── algorithm/
        │   ├── phase1.ts            # Datenaufbereitung + ABC-Klassifizierung + Filter
        │   ├── phase2.ts            # Co-Occurrence-Matrix + Louvain-Clustering
        │   ├── phase3.ts            # FFD Bin Packing + 3D-Orientierung + Balancing
        │   ├── phase4.ts            # Validierung (Hard Fails + Warnungen)
        │   ├── phase5.ts            # WT-Verhältnis-Szenarien
        │   └── constraints.ts       # Constraint-API (leer implementiert)
        ├── validation/
        │   └── hardChecks.ts        # C1–C8 Hard Checks für Validation Dashboard
        ├── workers/
        │   └── optimizer.worker.ts  # Web Worker: orchestriert Phase 1–5
        ├── context/AppContext.tsx   # React Context + useReducer
        ├── hooks/useOptimizer.ts    # Worker-Kommunikation Hook
        ├── components/
        │   ├── UploadSection.tsx        # Drag&Drop + Config-Panel
        │   ├── ABCSection.tsx           # ABC-Analyse Charts + Tabelle
        │   ├── CoOccurrenceSection.tsx  # SVG Heatmap
        │   ├── BelegungsplanSection.tsx # WT-Tabelle expandierbar + CSV-Export
        │   ├── WTVisualization.tsx      # SVG 2D Draufsicht (strip-aware, orientierungskorrigiert)
        │   └── WTRatioSection.tsx       # Szenarien-Vergleich + Simulator
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

## Datenfluss
1. **Ersteinrichtung**: Artikelliste + Bestellungen → `POST /api/upload/static` → DB (einmalig)
2. **Simulation**: Bestandsliste → `POST /api/upload/bestand` → DB → `GET /api/data` → Web Worker → Ergebnisse
- Backend ist reiner Datenspeicher, alle Algorithmen im Frontend Web Worker
- Phase 1+2 werden bei jeder Simulation neu berechnet

## API-Routen (Port 3001)
- `GET /api/status` → `{hasStaticData, artikelCount, bestellungenCount, lastBestandUpload}`
- `POST /api/upload/static` — FormData: `artikel` + `bestellungen` files
- `POST /api/upload/bestand` — FormData: `bestand` file
- `GET /api/data` → `{artikel[], bestellungen[], bestand[]}`

## Echte Excel-Spalten
| Datei | Sheet | Relevante Spalten | Hinweise |
|---|---|---|---|
| Artikelliste.xlsx | "Verpackungsvolumen Atrikel" | Nummer, Bezeichnung, Höhe_cm, Breite_cm, Länge_cm, Gewicht in kg, Volumen in Liter, Sperrgut | Dimensionen in cm → Backend ×10 → mm. Sperrgut='Lager B' → überspringen |
| Bestellungen.xlsx | "Bestellungen" | Datum, Beleg-Nr., Menge, Nummer, Bezeichnung | Früher "Bestellungen Sauber.xlsx" |
| Bestandsliste *.xls | dynamisch (z.B. 2026-03-13) | nummer, gesamt_x | gesamt_x ist String mit Leerzeichen → `parseInt(val.replace(/\s/g,''))` |

**Artikelumsatz.xlsx entfernt** — ABC läuft jetzt über `sum(Menge)` aus Bestellungen.

## WT-Konfiguration (Defaults)
```typescript
const DEFAULT_CONFIG: WTConfig = {
  anzahl_klein: 4145,
  anzahl_gross: 1111,
  gewicht_hard_kg: 24,
  gewicht_soft_kg: 20,
  hoehe_limit_mm: 320,
  teiler_breite_mm: 5,
  co_occurrence_schwellwert: 3,
  a_artikel_scatter_n: 3,        // A-Artikel auf N WTs verteilen
  warehouse_area_m2: 1480.65,
};
```

## Algorithmus-Logik

### Phase 0/1 — Datenaufbereitung + Filter
- **Filter 1**: SON-Artikel aus Bestellhistorie entfernen (Bezeichnung beginnt mit `"SON "`)
- **Filter 2**: Bestandsartikel ohne Artikelliste-Eintrag → `NO_MASTER_RECORD`
- **Filter 3–6**: `SPERRGUT`, `HEIGHT_EXCEEDED`, `WEIGHT_EXCEEDED`, `DIMENSIONS_MISSING`, `WEIGHT_MISSING`
- **HEIGHT_EXCEEDED**: Nur ausschließen wenn `min(h, b, l) > hoehe_limit_mm` — Rotation erlaubt Platzierung wenn mind. eine Dimension ≤ 320mm
- ABC via kumuliertem Umsatzanteil: A=20%, B=30%, C=50%
- Alle ausgeschlossenen Artikel im `exclusion_log` mit Grund erfasst

### Phase 3 — FFD Bin Packing (Streifenmodell)
- **3D-Orientierung** (`bestArticleOrientation`): alle 6 Kombinationen (3 Achsen × 2 Grundflächen-Rotationen), wählt max. Items pro WT
- `WTPosition` speichert: `laenge_mm = h1_mm` (quer zur WT-Breite), `breite_mm = h2_mm` (entlang WT-Tiefe), `max_stapelhoehe`
- **`zoneLayout`**: versucht beide Grundflächen-Orientierungen, wählt kleinste Tiefe — **wichtig für Viz**
- **`maxExpandable`**: begrenzt Expansion auf bereits allozierte Stapel (verhindert Flächenüberlauf)
- **Gewichts-Balancing**: leichteste Position von überlasteten WTs verschieben
- **Konsolidierung**: WTs < 30% Auslastung zusammenführen

### Validation Dashboard (C1–C8 + M1–M10)
- `hardChecks.ts`: C1 Bestandsvollständigkeit, C2 Gewicht, C3 Höhe (min-Dim!), C4 ID-Eindeutigkeit, C5 Artikelreferenz, C6 Keine leeren WTs, C7 Flächenintegrität (1% Toleranz, kein AREA_USABLE_FRACTION), C8 Constraint-Einhaltung

## WTVisualization — wichtige Implementierungsdetails
- `pickZoneLayout()` in der Viz spiegelt `zoneLayout()` aus phase3: probiert beide Orientierungen, wählt min. Tiefe → verhindert Slivers
- Zonen sortiert nach aufsteigender Höhe (shallowest first) → kurze Zonen zuerst sichtbar
- Bei Overflow: `continue` (nicht `break`) — überspringt unpassende Zonen, rendert restliche
- `COMPACT_THRESHOLD = 30`: ab 30 Stapeln als einzelnes Rect mit Grid-Overlay
- Legende unter SVG: A/B/C Farben, Teiler-Erklärung

## Git-Status
- Branch: `main`, ~42 Commits, clean
- Remote: `https://github.com/albert775f/WTopti.git` (privat)

## Offene Punkte (aus Spec Section 8)
1. Exakte Teilerbreite/-anordnung → kläre mit Lagerplanung (aktuell: 5mm fix)
2. 24 kg Gewichtslimit mit Storojet bestätigen
3. Äquivalenz 2G=3K fix oder flexibel? (Einfluss auf Stellplatz-Berechnung)

## Constraint-Modul (erweiterbar)
`constraints.ts` hat fertige API (`EXCLUDE_TOGETHER`, `REQUIRE_TOGETHER`, `MAX_PER_WT`), aber leere Implementierung.
