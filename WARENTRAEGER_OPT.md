

**TECHNISCHE SPEZIFIKATION**

**Warenträger-Belegungsoptimierung**

Automatiklager Initialbestückung

*Lagersystem: STOROJET*

Alphacool International GmbH

| Version | 2.0 |
| :---- | :---- |
| **Datum** | 16.03.2026 |
| **Autor** | Albert Artykov |
| **Status** | Entwurf |
| **Änderungen v2** | Scope, Constraints, Daten, WT-Ratio |

# **Änderungshistorie v1 → v2**

| Bereich | Änderung | Begründung |
| :---- | :---- | :---- |
| Scope | System bestimmt NUR WT-Inhalt. Keine Positionierung, keine Roboter-Steuerung. | Abgrenzung zu Storojet-Software |
| Nutzung | Einmal-Tool für Erstbestückung. Kein Dauerbetrieb, keine Saisonalität. | Projektanforderung |
| Kernziel NEU | Analyse/Empfehlung des optimalen Verhältnisses Klein/Groß-WTs | Strategische Entscheidung |
| Füllgradverlust | Teiler zwischen Segmenten → konfigurierbarer Parameter | Realitätsnähere Berechnung |
| Gewicht | Hard: 24 kg (intern). Soft/Ziel: 20 kg. Storojet-Standard \= 20 kg. | Klärung |
| Daten | Echte Daten statt Dummy: Bestandsliste, Umsatz (14 Mo.), Bestellhistorie, Artikelliste | Realistische Tests |
| Datenquelle NEU | Artikelumsatz pro Monat (14 Monate) für präzisere ABC-Analyse | Bessere Datengrundlage |
| Entfernt | WT-Positionsnummerierung, Dummy-Daten-Generator, Saisonalität | Außerhalb Scope |
| Constraint-Architektur | Keine Lager-Verbote aktuell, aber erweiterbar gebaut | Zukunftssicherheit |

# **1\. Projektübersicht & Scope**

## **1.1 Was das System tut**

Das System berechnet die optimale Zuordnung von Artikeln und deren Beständen zu Warenträgern für die Initialbestückung des STOROJET-Automatiklagers bei Alphacool International GmbH.

**Konkret:**

* Welche Artikel kommen auf welchen Warenträger?  
* Wie viele Stück eines Artikels pro Warenträger?  
* Welcher Warenträger-Typ (Klein/Groß) wird verwendet?  
* Ist das aktuelle Verhältnis Klein/Groß optimal, oder sollte es angepasst werden?

## **1.2 Was das System NICHT tut**

* Keine Positionierung der WTs im Lagerregal (macht Storojet-Software)  
* Keine Roboter-Steuerung oder Fahrwegoptimierung  
* Keine Echtzeit-Nachsteuerung — Einmal-Tool für Erstbestückung  
* Keine Saisonalitätsberechnung

## **1.3 Kernziele (priorisiert)**

1. Optimales Verhältnis Klein/Groß-WTs ermitteln und empfehlen  
2. Co-occurriende Artikel zusammen auf WTs packen  
3. Alle physischen Constraints einhalten (Maße, Gewicht, Höhe)  
4. Füllgradverlust durch Teiler realistisch berücksichtigen  
5. Bottleneck-Vermeidung: High-Runner verteilen

| ⚠️ Hauptergebnis: WT-Verhältnis Das aktuelle Verhältnis (4.145 K / 1.111 G) ist ein Startwert. Das System muss verschiedene Verhältnisse simulieren und eine datenbasierte Empfehlung ausgeben. |
| :---- |

# **2\. Systemparameter & Constraints**

## **2.1 STOROJET-Lagersystem**

Automatisches Kleinteilelager mit autonomen Bodenrobotern. WTs sind Holz-Tablare mit individuellen Aufbauten (Teiler/Fächer). Zugriff von oben. Verschiedene Artikel durch Teiler getrennt, gleiche Artikel stapelbar.

## **2.2 Warenträger-Spezifikationen**

| Parameter | Klein (K) | Groß (G) | Hinweis |
| :---- | :---- | :---- | :---- |
| Anzahl (aktuell) | 4.145 | 1.111 | Zu optimieren |
| Grundfläche | 500 × 500 mm | 500 × 800 mm | Breite immer 500 mm |
| Nutzfläche (brutto) | 250.000 mm² | 400.000 mm² | Vor Teilerabzug |
| Max. Warenhöhe | 320 mm | 320 mm | Abh. Ebenenabstand |
| Max. Gewicht (hard) | 24 kg | 24 kg | Über Storojet-Standard\! |
| Zielgewicht (soft) | 20 kg | 20 kg | Storojet-Standard |
| Äquivalenz | 1 K | 1,5 K | 2 Große \= 3 Kleine |

| ⚠️ Gewicht: 24 kg mit Storojet abstimmen\! Storojet gibt offiziell 20 kg als Maximum an. Die 24 kg sind Alphacool-intern. Vor Inbetriebnahme mit Storojet klären, ob 24 kg die Gewährleistung beeinflusst. |
| :---- |

## **2.3 Teiler & Füllgradverlust**

Verschiedene Artikel werden auf dem WT durch Teiler voneinander getrennt. Gleiche Artikel sind innerhalb eines Segments stapelbar.

**Modellierung:**

* Teilerbreite: Konfigurierbarer Parameter (Default: 5 mm — muss geklärt werden)  
* Teileranzahl pro WT: Anzahl verschiedener Artikel minus 1  
* Nutzfläche\_netto \= Brutto − (Teileranzahl × Teiler\_Flächenverlust)  
* Alternativ: Pauschaler %-Abzug pro zusätzlichem Artikel (Default 2%, konfigurierbar)

*Beispiel Kleiner WT (500×500), 5 Artikel:*

* 4 Teiler à 5 mm × 500 mm \= 10.000 mm² Verlust \= 4%

| ❓ Zu klären: Teiler-Details Exakte Teilerbreite, Teilerhöhe, Anordnung (Längs/Quer/Raster) und ob Teiler variabel oder fix sind — klären mit Lagerplanung. |
| :---- |

## **2.4 Bestandsparameter**

* Gesamtbestand: 337.846 Stück (Bestand \+ in Abwicklung)  
* Bestand eines Artikels kann auf mehrere WTs verteilt werden  
* Gleiche Artikel stapelbar innerhalb Segment  
* Verschiedene Artikel durch Teiler getrennt

# **3\. Datenmodell**

Alle Inputs sind echte Alphacool-Daten. CSVs werden aus vorhandenen Excel-Dateien extrahiert.

## **3.1 Input 1: Artikelliste**

| Feld | Typ | Einheit | Beschreibung |
| :---- | :---- | :---- | :---- |
| Artikelnummer | String | — | Primärschlüssel |
| Bezeichnung | String | — | Artikelname |
| Hoehe | Float | mm | Höhe einzelner Artikel |
| Breite | Float | mm | Breite einzelner Artikel |
| Laenge | Float | mm | Länge einzelner Artikel |
| Gewicht\_kg | Float | kg | Gewicht pro Stück |
| Volumen\_l | Float | Liter | Berechnetes Volumen aus B×H×L |

## **3.2 Input 2: Bestellarchiv**

| Feld | Typ | Beschreibung |
| :---- | :---- | :---- |
| Artikelnummer | String | FK → Artikelliste |
| Menge | Integer | Bestellmenge pro Position |
| Belegnummer | String | 1 Belegnummer \= 1 Bestellung |

## **3.3 Input 3: Artikelumsatz (NEU)**

| Feld | Typ | Beschreibung |
| :---- | :---- | :---- |
| Artikelnummer | String | FK → Artikelliste |
| Umsatz\_M01 ... Umsatz\_M14 | Integer | Umgesetzte Menge pro Monat (14 Spalten) |

*Ermöglicht präzisere ABC-Klassifizierung als reine Bestellzählung.*

## **3.4 Input 4: Bestandsliste**

| Feld | Typ | Beschreibung |
| :---- | :---- | :---- |
| Artikelnummer | String | FK → Artikelliste |
| Bestand | Integer | Aktueller Bestand in Stück |
| In\_Abwicklung | Integer | Bestand in Abwicklung (optional) |

## **3.5 Output 1: Belegungsplan**

| Feld | Typ | Beschreibung |
| :---- | :---- | :---- |
| Warentraeger\_ID | String | z.B. K-0001, G-0001 |
| Warentraeger\_Typ | Enum | KLEIN / GROSS |
| Artikelnummer | String | Zugeordneter Artikel |
| Stueckzahl | Integer | Stück dieses Artikels auf diesem WT |
| Cluster\_ID | Integer | Co-Occurrence-Cluster |
| ABC\_Klasse | Char | A / B / C |
| Gesamtgewicht\_kg | Float | Kumuliert auf WT |
| Flaeche\_netto\_pct | Float | Auslastung nach Teilerabzug |
| Anzahl\_Teiler | Integer | Teiler auf diesem WT |

## **3.6 Output 2: WT-Verhältnis-Empfehlung (NEU)**

| Feld | Typ | Beschreibung |
| :---- | :---- | :---- |
| Szenario | String | z.B. Aktuell, Optimiert, Nur Kleine, Benutzerdefiniert |
| Anzahl\_Klein | Integer | Kleine WTs im Szenario |
| Anzahl\_Gross | Integer | Große WTs im Szenario |
| Stellplaetze\_K\_Aequiv | Float | Stellplätze in Kleine-Äquivalenten |
| Auslastung\_Flaeche\_Avg | Float | Durchschn. Flächenauslastung % |
| Auslastung\_Gewicht\_Avg | Float | Durchschn. Gewichtsauslastung % |
| WTs\_Ungenutzt | Integer | Leere WTs |
| WTs\_Ueberlast | Integer | WTs im Bereich 20–24 kg |
| Co\_Occurrence\_Score | Float | Wie gut sind co-occurriende Artikel beieinander |
| Empfehlung | String | Textuelle Empfehlung |

# **4\. Algorithmus-Architektur**

5 sequenzielle Phasen. Phase 5 (WT-Verhältnis-Analyse) ist neu.

## **4.1 Phase 1: Datenaufbereitung & Analyse**

**Input: Alle 4 CSVs**

6. Grundfläche pro Artikel: Breite × Länge (mm²)  
7. Max. Stapelhöhe berechnen: floor(320 / Artikelhöhe) \= max. Stapelung pro Segment  
8. ABC-Klassifizierung: Summe Umsatz über 14 Monate. A \= Top 20%, B \= 30%, C \= 50%  
9. Co-Occurrence-Matrix: Artikelpaare pro Beleg zählen  
10. Platzbedarf: Bestand × Einzelvolumen je Artikel

**Validierung:**

* Höhe \> 320 mm → Warnung „Nicht lagerfähig“  
* Fehlende Maße/Gewicht → Warnung „Unvollständig“  
* Bestellarchiv-Artikel ohne Artikelliste-Match → Log  
* Bestand \= 0 → Überspringen

## **4.2 Phase 2: Co-Occurrence-Clustering**

**Methode: Louvain Community Detection**

* Knoten \= Artikel mit Bestand \> 0  
* Kantengewicht \= Anzahl gemeinsamer Belege  
* Schwellwert: Kanten mit Gewicht ≥ 3 (konfigurierbar)

**Post-Processing:**

* Cluster zu groß (über \~20 WTs Gesamtbestand) → Subcluster bilden  
* Max. 2 A-Artikel pro Cluster  
* Isolierte Artikel → Rest-Cluster nach Größe/Kategorie

## **4.3 Phase 3: Bin Packing \+ Füllgradverlust**

**3a: WT-Größenwahl pro Cluster**

* Größter Artikel \> 200.000 mm² Grundfläche → Großer WT  
* Viele kleine Artikel die zusammen auf Klein passen → Kleiner WT  
* Großer WT nur wenn Flächenausnutzung \> 65% erwartet (2G \= 3K Kosten)

**3b: Nutzfläche berechnen**

* Nutzfläche\_netto \= Brutto − Füllgradverlust(Anzahl\_Artikeltypen)  
* Verlustmodell konfigurierbar: exakte Teilermaße ODER pauschaler %

**3c: First Fit Decreasing Packing**

11. Artikel nach Grundfläche absteigend sortieren  
12. Bestand eines Artikels auf WT packen, Constraints prüfen:  
    * Fläche ≤ Nutzfläche\_netto (dynamisch, da Teileranzahl sich ändert\!)  
    * Gewicht ≤ 20 kg (soft) bzw. 24 kg (hard)  
    * Artikelhöhe ≤ 320 mm  
13. Passt nicht → nächsten WT öffnen  
14. Bestand passt nicht komplett → Rest auf nächsten WT im Cluster

| Wichtig: Dynamische Nutzfläche Die Nutzfläche ändert sich bei JEDEM neuen Artikeltyp auf dem WT, weil ein zusätzlicher Teiler dazukommt. Der Algorithmus muss die Nutzfläche nach jedem Hinzufügen neu berechnen. |
| :---- |

**3d: Gewichts-Balancing**

* WTs \> 20 kg: Leichteste Position auf nächsten WT umverteilen  
* Nur innerhalb Cluster umverteilen

## **4.4 Phase 4: Validierung**

**Hard Fails:**

* WT \> 24 kg → FEHLER  
* Artikel Höhe \> 320 mm zugeordnet → FEHLER  
* Artikel mit Bestand \> 0 nicht zugeordnet → FEHLER

**Warnungen:**

* WT Gewicht 20–24 kg  
* WT Flächenauslastung \< 30%  
* WT mit nur 1 Artikelposition

## **4.5 Phase 5: WT-Verhältnis-Analyse (NEU)**

Das System führt den kompletten Algorithmus (Phase 1–4) für verschiedene WT-Verhältnisse aus und vergleicht die Ergebnisse.

**Szenarien:**

15. Aktuell: 4.145 K / 1.111 G  
16. Optimiert: System schlägt optimales Verhältnis vor  
17. Nur Kleine: 100% kleine WTs  
18. Mehr Große: Verhältnis zugunsten Großer verschieben  
19. Benutzerdefiniert: Freie Eingabe

**Vergleichsmetriken:**

* Durchschn. Flächenauslastung (netto)  
* Durchschn. Gewichtsauslastung  
* Ungenutzte WTs  
* WTs im Überlast-Bereich (20–24 kg)  
* Gesamtstellplätze (Kleine-Äquiv.)  
* Co-Occurrence-Score

# **5\. Dashboard-Spezifikation (React)**

## **5.1 Tech Stack**

| Komponente | Technologie |
| :---- | :---- |
| Framework | React 18+ mit Hooks |
| Styling | Tailwind CSS |
| Charts | Recharts |
| 2D WT-Vis | SVG / Canvas (custom) |
| Tabellen | TanStack Table |
| CSV Parsing | Papaparse |
| State | React Context \+ useReducer |
| Algorithmus | Web Worker (non-blocking) |

## **5.2 Bereiche**

**1 — Daten-Upload & Konfiguration**

* Drag & Drop für 4 CSVs  
* Vorschau (10 Zeilen) nach Upload  
* Konfiguration: WT-Anzahlen, Gewichtslimits, Höhenlimit, Teiler-Parameter, Co-Occurrence-Schwellwert  
* Validierung: Grün/Rot pro CSV  
* „Optimierung starten“ Button

**2 — ABC-Analyse & Umschlagshäufigkeit**

* Quelle: Artikelumsatz (14 Monate)  
* Balkendiagramm: Top 50 nach Gesamtumsatz  
* Kreisdiagramm: A/B/C Verteilung (Artikel \+ Bestand \+ Umsatz)  
* Tabelle: Komplett, sortier-/filterbar  
* KPIs: Artikelanzahl, Gesamtbestand, Ø Monatsumsatz

**3 — Co-Occurrence Heatmap**

* Top 50 Artikelpaare als Matrix-Heatmap  
* Farbskala: Weiß → Dunkelblau  
* Hover: Artikelnamen \+ Co-Occurrence-Wert \+ Cluster  
* Filter: ABC-Klasse, Cluster, Mindest-Score  
* Cluster-Overlay: Farbige Umrandung

**4 — Belegungsplan (Tabelle)**

* Gruppiert nach WT-ID  
* Spalten: ID, Typ, Artikel, Gewicht, Fläche netto %, Cluster, Teiler  
* Farbe: Grün ≤20kg, Orange 20–24kg, Rot \>24kg  
* Expandierbar: Artikeldetails pro WT  
* CSV-Export

**5 — 2D Warenträger-Visualisierung**

* Draufsicht (Top-Down), maßstabsgetreu  
* Artikel als farbige Rechtecke (Farbe \= Cluster oder ABC, umschaltbar)  
* Teiler als dünne Linien sichtbar  
* Hover: Name, Maße, Gewicht, Stückzahl  
* Gewichts-Progress-Bar (grün/orange)  
* Navigation: Vor/Zurück, Suche nach WT-ID oder Artikelnr.

**6 — WT-Verhältnis-Simulator (NEU)**

* Szenario-Vergleichstabelle  
* Slider/Eingabe: Klein/Groß frei wählbar  
* Neuberechnung per Button oder live  
* Balkendiagramm: Auslastungsvergleich  
* Empfehlungs-Box: Hervorgehobene Empfehlung  
* Stellplatz-Kalkulator (Kleine-Äquivalente)

# **6\. Erweiterbare Constraint-Architektur**

Aktuell keine Zusammen-Lagerungs-Verbote. Architektur muss erweiterbar sein.

**Vorgaben für Coding Agent:**

* Eigenes Modul: constraints.js  
* Constraint-Typen (Interface vorbereitet, leer implementiert):  
  * EXCLUDE\_TOGETHER: A und B nicht auf denselben WT  
  * REQUIRE\_TOGETHER: A und B müssen auf denselben WT  
  * MAX\_PER\_WT: Max N Stück von Artikel A pro WT  
* Laden via optionalem CSV-Upload oder JSON-Config  
* Bin-Packing prüft Constraints vor jeder Zuweisung  
* Phase 4 prüft Constraint-Verletzungen

# **7\. Implementierungsreihenfolge**

| \# | Beschreibung | Abh. | Aufwand |
| :---- | :---- | :---- | :---- |
| 1 | CSV-Upload \+ Parsing \+ Validierung (4 Dateien) | — | Mittel |
| 2 | ABC-Analyse aus Artikelumsatz \+ Charts | 1 | Klein |
| 3 | Co-Occurrence-Matrix \+ Louvain Clustering | 1 | Groß |
| 4 | Bin Packing (FFD \+ Füllgradverlust \+ Balancing) | 2+3 | Groß |
| 5 | Belegungsplan-Tabelle \+ CSV-Export | 4 | Mittel |
| 6 | 2D WT-Visualisierung | 4 | Mittel |
| 7 | Co-Occurrence-Heatmap | 3 | Mittel |
| 8 | WT-Verhältnis-Simulator \+ Szenarien | 4 | Groß |
| 9 | Validierung \+ Optimierung | 4 | Mittel |
| 10 | Constraint-Modul (API fertig, leer) | 4 | Klein |

# **8\. Offene Punkte**

| \# | Frage | Auswirkung | Status |
| :---- | :---- | :---- | :---- |
| 1 | Exakte Teilerbreite und \-anordnung? | Füllgradverlust-Berechnung | Klären mit Lagerplanung |
| 2 | 24 kg mit Storojet abgestimmt? | Gewährleistung | Klären mit Storojet |
| 3 | Artikel \> 320 mm Höhe vorhanden? | Sonderbehandlung | Prüfen nach Datenanalyse |
| 4 | Äquivalenz 2G=3K fix oder flexibel? | Stellplatz-Berechnung | Klären mit Storojet |

# **9\. Glossar**

| Begriff | Definition |
| :---- | :---- |
| WT | Warenträger — Holz-Tablar mit Teilern im STOROJET |
| STOROJET | Automatisches Kleinteilelager mit Bodenrobotern (Storojet GmbH) |
| Co-Occurrence | Häufigkeit, mit der zwei Artikel in derselben Bestellung vorkommen |
| FFD | First Fit Decreasing — Bin-Packing-Heuristik |
| ABC | Klassifizierung nach Umsatz: A (Top 20%), B (30%), C (50%) |
| Füllgradverlust | Flächenverlust durch Teiler auf dem WT |
| Hard Constraint | Muss eingehalten werden (24 kg, 320 mm) |
| Soft Constraint | Sollte eingehalten werden, Warnung bei Verstoß (20 kg) |
| Kleine-Äquivalente | Normierte Stellplatzeinheit: 1K=1, 1G=1,5 |

