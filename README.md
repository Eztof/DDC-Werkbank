# DDC-Werkbank

Werkzeug für Sicherungen von Kieback&Peter-Zentralen (DDC4000/BMR `.d4pml`/`datasave.xml`, DDC3000 `.wwf`) und Wartungsdokus (WTGML). Oberfläche im Browser, optional mit lokalem Dienst (BACnet lesen, Merkliste).

## Für die Benutzung

Auf dem Arbeitsrechner wird nichts installiert. Die fertige ZIP kommt aus GitHub (Reiter **Actions** → letzter Lauf → Artefakt *DDC-Werkbank*, oder bei Versionen unter **Releases**). Entpacken, `DDC-Werkbank.exe` starten – oder `ui\DDC-Werkbank.html` direkt per Doppelklick öffnen (dann ohne Online-Reiter). Details in `DDC-Werkbank/LIESMICH.txt`.

## Aufbau

```
src/ui/                 Oberfläche (wird zu EINER HTML-Datei gebaut)
  index.html            Gerüst, Platzhalter für CSS und JS (+ optionale erweiterungen.js)
  main.js               Einstieg: lädt alle Module, Schnittstelle window.DDCWerkbank, Start
  core/                 Grundlagen, von allen genutzt:
    ext.js              ALLE Erweiterungspunkte (Register) an einer Stelle – hier anfangen
    registry.js         Register-Baustein (add/get/list, Reihenfolge über order)
    state.js            gemeinsamer Zustand (APP, aktuelle Zentrale)
    events.js           Ereignisse (on/emit) zum Verknüpfen ohne direkte Abhängigkeit
    nav.js              Navigation und Sprungziele (go, openPin, openNode, openRef)
    live.js             Live-Werte aller Live-Quellen für alle Ansichten
    service.js          Anfragen an den lokalen Dienst (mit Zeitlimit)
    util.js             DOM-Helfer, Formatierung, lazyAppend (lange Listen)
    load.js, persist.js Dateien einsammeln/erkennen, Merkliste
  model/                Einlesen und Auswerten
    model.js            gemeinsames Modell der Zentrale (Klemmen, Bausteine, Kanten), pinOf()
    d4pml.js, ddc3000.js  Dateiformate (melden sich in FORMATS an)
    pipeline.js         nach dem Einlesen: Auswertungen (ANALYSES), dann Prüfungen
    findings.js         Befunde aus allen Prüfungen, Prüfungen ein-/ausschalten
    checks/             je Thema eine Datei mit Prüfungen (melden sich in CHECKS an)
  shell/                Fenster-Gerüst, Navigation, Suche, Laden
  views/                Ansichten: Start/Übersicht, Datenpunkte, Programm, Befunde/Zeit, Vergleich, Online
  wartung/              Wartungsdoku: Generator, Anlagen, WTGML, Ansicht, Verknüpfung, Zu-/Abluft,
                        in-datenpunkten.js (Doku-Spalte/Filter/Knopf in den Datenpunkten)
  styles/               CSS, in Nummern-Reihenfolge zusammengefügt
src/service/            Hintergrunddienst (Node, wird zur .exe): server.js, bacnet.js
tools/build.mjs         baut DDC-Werkbank/ui/DDC-Werkbank.html
tools/package.mjs       baut dist/DDC-Werkbank/ mit .exe und ZIP
test/                   Tests im Browser: Ansichten, Online→Datenpunkte, Wartungsdoku,
                        Erweiterungen, Lasttest (test/lib/gross-sicherung.mjs erzeugt große Sicherungen)
DDC-Werkbank/           Auslieferungsordner (gebaute HTML, LIESMICH)
```

## Erweitern

Jede Erweiterung ist ein Eintrag in einem Register aus `core/ext.js`. Ein Modul trägt sich selbst ein, `main.js` importiert es – sonst muss nichts geändert werden. Gleiche `id` ersetzt einen eingebauten Eintrag, `order` bestimmt die Reihenfolge.

| Was | Register | Beispiel im Code |
|---|---|---|
| neues Dateiformat | `FORMATS` | Ende von `model/d4pml.js`, `wartung/wtgml.js` |
| Modell nach dem Einlesen ergänzen | `ANALYSES` | – |
| Prüfung / Befund | `CHECKS` | `model/checks/*.js` |
| Ansicht in der Navigation | `VIEWS` | `views/*.js` |
| Kachel auf der Übersicht | `OVERVIEW_TILES` | Ende von `views/start-overview.js` |
| Treffer in der Suche (Strg+K) | `SEARCH` | Ende von `views/points.js` |
| Spalte / Filter / Abschnitt / Knopf in den Datenpunkten | `PIN_COLUMNS`, `PIN_FILTERS`, `PIN_SECTIONS`, `PIN_ACTIONS` | `views/points.js`, `wartung/in-datenpunkten.js` |
| Reiter der Wartungsdoku | `WD_TABS` | `wartung/view.js`, `link.js`, `air.js` |
| Live-Datenquelle | `LIVE_SOURCES` + `setLive()` | `views/online.js` (BACnet) |

Rezepte:

- **Neue Prüfung:** Datei `model/checks/meine.js` anlegen, in `model/findings.js` importieren:
  ```js
  CHECKS.add({ id: "meine", label: "Meine Prüfung", cat: "Klemmen", formats: ["D4PML"],
    run(C, add) { for (const p of C.pins) if (!p.name && p.kind !== "frei") add("warn", null, p.klemme + ": ohne Namen", "", { pin: p.uid }); } });
  ```
  Läuft automatisch beim Laden, erscheint in „Befunde“, markiert die Klemme, lässt sich abhaken und unter „Prüfungen“ ausschalten. Ein Fehler in der Prüfung stoppt nichts anderes.
- **Neues Dateiformat:** `FORMATS.add({ id, label, icon, desc, exts, sniff(name, head, text), parse(text, file) })`; `parse` liefert eine Zentrale aus `newCentral()` mit `pins`, `nodes`, `edges` (danach `indexEdges(C)`). Alle Ansichten, Suche und Prüfungen ohne `formats` funktionieren dann sofort.
- **Neue Ansicht:** `VIEWS.add({ id, label, icon, group, order, needsC, render(root, C, opts) })`, Datei in `main.js` importieren. Hinspringen mit `go("id", { … })`.
- **Neue Live-Quelle:** `LIVE_SOURCES.add({ id, label, format(o) })` und `setLive(cid, [{ nodeId, ok, value }], { source: id, stamp })` – Datenpunkte (Spalte und Detail „Live“), Filter „mit Live-Wert“ und Wartungsdoku-Zeilen zeigen die Werte.
- **Lange Listen:** `lazyAppend(eltern, liste, zeile => element)` statt alle Zeilen auf einmal – die ersten sofort, der Rest beim Scrollen; Strg+F und Drucken bekommen alles.

**Ohne Neubauen:** Eine Datei `ui\erweiterungen.js` neben der HTML wird beim Start geladen (fehlt sie, passiert nichts). Darin steht die Schnittstelle `DDCWerkbank` bereit: `DDCWerkbank.register.CHECKS.add({ … })`, außerdem `go`, `openPin`, `on`, `ui.h`, `ui.icon`, `util`, `model`, `live`. Alternativ vor dem Start `window.DDCWerkbankErweiterungen = [api => { … }]`.

## Funktionen verknüpfen

- **Daten teilen:** gemeinsame Daten liegen in `core/` (z. B. `APP` in `state.js`, Live-Werte in `live.js`) und im Modell der Zentrale (`C.pins`, `C.nodes`, `C.findings`, `pinOf(C, uid)`).
- **Auf etwas reagieren:** `on("live", ({ cid }) => …)` – wer etwas Neues hat, meldet es mit `emit(...)`. Die bekannten Ereignisse stehen oben in `core/events.js`.
- **Hinspringen:** `openPin(cid, uid)`, `openNode(cid, nodeId)`, `go("ansicht", { … })` aus `core/nav.js`.

## Entwickeln

```
npm install
npm run build      # HTML bauen
npm run watch      # bei jeder Änderung neu bauen
npm test           # bauen + alle Browser-Tests (inkl. Lasttest)
npm run service    # Dienst lokal starten (nutzt DDC-Werkbank/ als Ordner)
npm run package    # .exe + ZIP nach dist/
```
