import { registry } from "./registry.js";

/* =========================================================================
   Erweiterungspunkte der Werkbank – alle an einer Stelle.
   Ein Modul trägt sich mit  REGISTER.add({ id, … })  ein und wird dadurch
   überall verwendet, ohne dass andere Dateien geändert werden müssen.
   Reihenfolge über  order  (kleiner = weiter vorne/oben, Standard 100).
   Beispiele und Rezepte: README.md, Abschnitt „Erweitern“.
   ========================================================================= */

/* Dateiformate – was beim Öffnen erkannt und eingelesen wird
   { id, label, icon, desc, exts: ["xml", …],
     sniff(name, head, text) → true, wenn die Datei dieses Format hat,
     parse(text, file) → Zentrale (newCentral …)         für Sicherungen,
     open(text, file, handle) → true                      für Dokumente (z. B. WTGML) }
   file = { name, path, label } */
export const FORMATS = registry("Dateiformate");

/* Auswertungen nach dem Einlesen (vor den Prüfungen): Modell ergänzen,
   Verzeichnisse aufbauen …   { id, order, run(C) } */
export const ANALYSES = registry("Auswertungen");

/* Prüfungen → Befunde
   { id, label, cat, formats?: ["D4PML", "DDC3000"], run(C, add) }
   add(sev, cat, title, detail, ref)   sev: "err" | "warn" | "info",
   ref: { pin: uid } | { node: id } | { node, nodes: [ids] } | null */
export const CHECKS = registry("Prüfungen");

/* Ansichten (linke Navigation)
   { id, label, icon, group (0 Start · 1 Zentrale · 2 Doku/Vergleich · 3 Online),
     needsC: braucht eine geladene Zentrale, compact: volle Breite,
     render(root, C, opts), badge(C) → [{ n, cls, title }] | null,
     scrollKey() → Schlüssel für gemerkte Scrollposition }  */
export const VIEWS = registry("Ansichten");

/* Kacheln auf der Übersicht   { id, order, tile(C, go) → { icon, title, value, small, detail, onclick } | null } */
export const OVERVIEW_TILES = registry("Übersicht-Kacheln");

/* Globale Suche (Strg+K)
   { id, label (Gruppe), index(C) → [[eintrag, suchtext], …],
     hit(C, eintrag) → { a, n, w, go } }      suchtext klein geschrieben (norm) */
export const SEARCH = registry("Suche");

/* Datenpunkte: Spalten, Filter, Abschnitte und Knöpfe im Detailbereich
   Spalte:   { id, label, order, cls, title(C, ctx), prepare(C, ctx), show(C, ctx),
               sort(p, ctx) → Zahl|Text, cell(C, p, ctx) → Element|Text, csv(C, p, ctx) → Text }
   Filter:   { id, label, show(C, ctx), test(p, ctx, C) }
   Abschnitt:{ id, order, render(C, p, sec, kv) }  sec(titel, zeilen), kv(k, v)
   Knopf:    { id, order, button(C, p) → Element | null }
   ctx wird je Zeichnen neu gebaut; prepare() darf Daten hineinlegen (z. B. ctx.doc). */
export const PIN_COLUMNS = registry("Datenpunkte-Spalten");
export const PIN_FILTERS = registry("Datenpunkte-Filter");
export const PIN_SECTIONS = registry("Datenpunkte-Abschnitte");
export const PIN_ACTIONS = registry("Datenpunkte-Knöpfe");

/* Wartungsdoku: Reiter
   { id, label, icon, order, needsDoc, fill(D) → volle Höhe, badge(D) → { n, cls, title } | null,
     render(body, D) } */
export const WD_TABS = registry("Wartungsdoku-Reiter");

/* Live-Datenquellen (Online-Werte)  { id, label, format(o) → { t, cls } }
   Werte kommen über setLive(cid, werte, { source }) aus core/live.js. */
export const LIVE_SOURCES = registry("Live-Quellen");

export const ALL = { FORMATS, ANALYSES, CHECKS, VIEWS, OVERVIEW_TILES, SEARCH, PIN_COLUMNS, PIN_FILTERS, PIN_SECTIONS, PIN_ACTIONS, WD_TABS, LIVE_SOURCES };
