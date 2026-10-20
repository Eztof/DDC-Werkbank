# DDC-Werkbank

Werkzeug für Sicherungen von Kieback&Peter-Zentralen (DDC4000/BMR `.d4pml`/`datasave.xml`, DDC3000 `.wwf`) und Wartungsdokus (WTGML). Oberfläche im Browser, optional mit lokalem Dienst (BACnet lesen, Merkliste).

## Für die Benutzung

Auf dem Arbeitsrechner wird nichts installiert. Die fertige ZIP kommt aus GitHub (Reiter **Actions** → letzter Lauf → Artefakt *DDC-Werkbank*, oder bei Versionen unter **Releases**). Entpacken, `DDC-Werkbank.exe` starten – oder `ui\DDC-Werkbank.html` direkt per Doppelklick öffnen (dann ohne Online-Reiter). Details in `DDC-Werkbank/LIESMICH.txt`.

## Aufbau

```
src/ui/                 Oberfläche (wird zu EINER HTML-Datei gebaut)
  index.html            Gerüst, Platzhalter für CSS und JS
  main.js               Einstieg: lädt alle Module, startet die Oberfläche
  core/                 Grundlagen: DOM-Helfer, Dateien laden, Merkliste, Ansichten-Registry
  model/                Einlesen und Auswerten: Modell, DDC4000/BMR, DDC3000, Befunde
  shell/                Fenster-Gerüst, Navigation, Zustand (APP), Suche, Sprungziele
  views/                Ansichten: Start/Übersicht, Datenpunkte, Programm, Befunde/Zeit, Vergleich, Online
  wartung/              Wartungsdoku: Generator, Anlagen, WTGML, Ansicht, Verknüpfung, Zu-/Abluft
  styles/               CSS, in Nummern-Reihenfolge zusammengefügt
src/service/            Hintergrunddienst (Node, wird zur .exe): server.js, bacnet.js
tools/build.mjs         baut DDC-Werkbank/ui/DDC-Werkbank.html
tools/package.mjs       baut dist/DDC-Werkbank/ mit .exe und ZIP
test/                   Rauchtest im Browser mit künstlicher Beispiel-Sicherung
DDC-Werkbank/           Auslieferungsordner (gebaute HTML, LIESMICH)
```

Jedes Modul holt sich, was es braucht, per `import` und gibt per `export` frei, was andere nutzen. Neue Ansicht: Datei unter `views/` anlegen, `VIEWS.name = { … }` setzen, in `core/views.js` (NAV) eintragen und in `main.js` importieren.

## Entwickeln

```
npm install
npm run build      # HTML bauen
npm run watch      # bei jeder Änderung neu bauen
npm test           # bauen + Rauchtest
npm run service    # Dienst lokal starten (nutzt DDC-Werkbank/ als Ordner)
npm run package    # .exe + ZIP nach dist/
```
