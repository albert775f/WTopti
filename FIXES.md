# Offene Fixes

## Muss behoben werden

### F1 — `hardChecks.ts:128` — `usableArea` nicht definiert
ReferenceError in `checkC7_FlaechenIntegritaet` sobald ein WT die 1%-Toleranz überschreitet.
`usableArea` wird in der Fehlermeldung verwendet, ist aber nie definiert.
**Status:** C7 war PASS im letzten Lauf — Bug ist latent, tritt nur bei echtem Flächenüberlauf auf.
**Fix:** `usableArea` → `wtArea` in Zeilen 128 und 130.

### F2 — `phase5.ts:81` — `isWeightLimited` falsch
Wenn `fitsKlein=false`, ist `itemsKlein=0`. Falls auch `itemsGross=0`, gilt `0===0` → Artikel fälschlich als gewichtsbegrenzt gezählt statt geometriebegrenzt. Verfälscht `articles_weight_limited` und den Empfehlungstext.
**Status:** M8 (Gini-Koeffizient) und M4 (57.1% WTs im Warnbereich) bestätigen dass Gewichts-Metriken unzuverlässig sind.
**Fix:**
```typescript
// Aktuell (falsch):
const isWeightLimited = itemsKlein === itemsGross;
// Korrekt:
const isWeightLimited = fitsKlein && itemsKlein > 0 && itemsGross > 0 && itemsKlein === itemsGross;
```

### F3 — `phase5.ts:66-69` — Dimensionsfilter ignorieren 3D-Rotation
Drei Filter schließen Artikel aus, die per Rotation auf einen WT passen würden:
```typescript
if (art.hoehe_mm > config.hoehe_limit_mm) continue; // müsste Math.min(h,b,l) prüfen
if (art.laenge_mm > 500) continue;  // Rotation: jede Dim. kann entlang der Breite liegen
if (art.breite_mm > 800) continue;  // gleicher Fehler
```
Resultat: `computeArticleCosts` unvollständig → falsche GROSS/KLEIN-Empfehlung im Ratio-Tab.
**Fix:** Alle drei Filter entfernen — `bestArticleOrientation` / `itemsPerWT2D` prüft bereits korrekt.

### F4 — `baseline.ts:16` — Höhencheck ohne 3D-Rotation
```typescript
if (art.hoehe_mm > config.hoehe_limit_mm) continue;
```
Inkonsistent mit Phase 1 (`Math.min(h,b,l)`) und hardChecks C3.
**Fix:**
```typescript
if (Math.min(art.hoehe_mm, art.breite_mm, art.laenge_mm) > config.hoehe_limit_mm) continue;
```

### F9 — C1 zählt intentional gefilterte Artikel als Fehler
C1 vergleicht Bestandsliste direkt mit platzierten Mengen — ohne Rücksicht darauf ob ein Artikel absichtlich ausgeschlossen wurde (SPERRGUT, HEIGHT_EXCEEDED, WEIGHT_EXCEEDED, DIMENSIONS_MISSING). Diese haben Bestand > 0, placed = 0 → C1 FAIL pro Artikel.
**Status:** C1 zeigt 360 Fehler. Unklar wie viele davon echte Platzierfehler vs. legitime Ausschlüsse sind — damit ist C1 aktuell unbrauchbar als Qualitätsindikator.
**Fix:** C1 nur für Artikel prüfen, die Phase-1-Filter überlebt haben. Ausgeschlossene Artikel separat im Exclusion-Log belassen (bereits vorhanden), nicht als C1-Fehler zählen.

### F10 — Mega-Cluster verhindert Co-Occurrence-Nutzen (M7 = 0%)
Louvain weist 308 Artikel einem einzigen Cluster (ID 5) zu → 1287 WTs in diesem Cluster. Co-occurrierende Paare landen zufällig auf verschiedenen WTs innerhalb dieses Riesenclusters. Ergebnis: M7 (Top-100-Paare auf gleichem WT) = 0%.
**Status:** Direkt messbar im Belegungsplan. Die gesamte Co-Occurrence-Optimierung ist für die Artikel in diesem Cluster wirkungslos.
**Fix-Option A (Algorithmus):** Maximale Clustergröße begrenzen. Wenn ein Cluster mehr als N WTs füllen würde (z.B. N=20), Subcluster nach Co-Occurrence-Score bilden — stärkste Paare zusammenhalten.
**Fix-Option B (Louvain-Parameter):** Louvain-Resolution erhöhen (>1.0) → feinere, kleinere Cluster. Nachteil: schwer zu kalibrieren.
**Empfehlung:** Option A, da kontrollierbar.

---

## Sollte behoben werden

### F5 — Visualisierung stimmt nicht mit Algorithmus überein (zwei Ursachen)

**Ursache 1 — Vis sortiert anders als der Algorithmus:**
Phase 3 packt Artikel absteigend nach Grundfläche (FFD). Die Visualisierung sortiert Zonen aufsteigend nach Tiefe (`zoneH`, `WTVisualization.tsx:124`). Das sind zwei verschiedene Anordnungen — die Vis simuliert das Layout komplett neu statt das echte Ergebnis darzustellen. Zusätzlich: wenn eine Zone in der Vis-Anordnung nicht reinpasst, wird sie übersprungen (`continue`, Zeile 139) — Artikel werden nicht gerendert, obwohl der Algorithmus sie korrekt platziert hat.

**Ursache 2 — `flaeche_netto_pct` misst Artikel-Footprints, nicht Regalzeilen:**
70% Füllgrad = Summe aller Artikel-Grundflächen / WT-Gesamtfläche. Physisch belegt eine Regalzeile aber die Tiefe des größten Artikels in dieser Zeile — kleinere Artikel in derselben Zeile verschwenden die restliche Tiefe. Die Prozentanzeige ist rechnerisch korrekt, sieht aber im Vergleich zum visuell leeren WT irreführend aus.

**Fix:** `x`, `y`, `zoneW`, `zoneH` jeder Zone direkt auf `WTPosition` speichern (Phase 3). Visualisierung rendert diese Koordinaten 1:1 — kein Re-Layout, kein Overflow, keine Sortierabweichung. Löst beide Ursachen gleichzeitig.

### F6 — Phase 4 — Kein Hard Fail wenn WT-Kontingent erschöpft
Wenn der Algorithmus mehr WTs braucht als `anzahl_klein + anzahl_gross`, erzeugt er stillschweigend weitere.
**Status:** Im letzten Lauf 3045 WTs bei 4145+1111=5256 verfügbar — kein Problem. Aber bei anderen Daten könnte es triggern.
**Fix:** Neuer C-Check in Phase 4: FAIL wenn `wts_klein > config.anzahl_klein` oder `wts_gross > config.anzahl_gross`.

---

## Niedrige Priorität

### F7 — `WTRatioSection.tsx:6-7` — Konstanten-Duplikat
`KLEIN_FLOOR_M2 = 0.25` und `GROSS_FLOOR_M2 = 0.40` lokal definiert, obwohl aus `phase3.ts` exportiert.
**Fix:** Import statt lokale Definition.

---

## Offen / Klären

### F8 — Äquivalenz 1G = 1,5K vs. real 1,6K (Spec §2.2)
Physische Maße ergeben 500×800 / 500×500 = **1,6**, Spec behauptet **1,5**.
Betrifft `stellplaetze_k_aequiv` und Break-even-Berechnung.
**Aktion:** Mit Storojet / Lagerplanung klären.

---

## Beobachtungen aus aktuellem Lauf (validierungsbericht 4 / belegungsplan 6)

| Metrik | Wert | Bewertung |
|---|---|---|
| WTs gesamt | 3045 (von 5256 verfügbar) | OK |
| C1 Bestandsvollständigkeit | FAIL, 360 Fehler | Wahrscheinlich false positives → F9 |
| C2–C8 | alle PASS | OK (C7 latenter Bug F1 nicht ausgelöst) |
| M4 WTs 20–24 kg | 57.1% (1808 WTs) | Hoch, aber algorithmisch bedingt |
| M7 Co-Occ Top-100 | 0.0% | Mega-Cluster-Problem → F10 |
| M8 A-Gini | 0.94 | Scatter funktioniert (Baseline 0.98 → 0.94) |
| Cluster 5 | 308 Artikel, 1287 WTs | Mega-Cluster → F10 |
| WTs mit 1 Artikeltyp | 581 (19%) | Konsolidierung könnte besser sein |
