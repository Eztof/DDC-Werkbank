/* =========================================================================
   Ansichten-Registry: jede Ansicht trägt sich hier ein (VIEWS.name = {...}),
   NAV legt Reihenfolge und Symbole der Navigation fest.
   ========================================================================= */
export const VIEWS = {};
export const NAV = [
  ["start", "Start", "home"], "-",
  ["overview", "Übersicht", "overview"],
  ["points", "Datenpunkte", "table"],
  ["program", "Programm & Wirkkette", "flow"],
  ["findings", "Befunde", "alert"],
  ["sched", "Zeit & Meldungen", "clock"], "-",
  ["wartung", "Wartungsdoku", "doc"],
  ["compare", "Vergleich", "compare"], "-",
  ["online", "Online", "bacnet"]
];
