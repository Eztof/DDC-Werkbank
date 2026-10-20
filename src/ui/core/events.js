/* =========================================================================
   Ereignisse: lose Kopplung zwischen den Teilen der Werkbank.
   Ein Modul meldet etwas (emit), andere hören mit (on) – ohne sich gegenseitig
   zu kennen. Beispiel: Online liest Live-Werte → Datenpunkte zeigen sie an.

   Bekannte Ereignisse:
     "zentralen"     Sicherungen geladen oder entfernt         { centrals }
     "zentrale"      andere Zentrale ausgewählt                 { cid }
     "ansicht"       Ansicht gewechselt (go)                    { view, opts }
     "live"          neue Live-Werte einer Zentrale (Online)    { cid, stamp }
   ========================================================================= */
const LISTENERS = new Map();

/* Zuhören; gibt eine Funktion zum Abmelden zurück */
export function on(name, fn) {
  if (!LISTENERS.has(name)) LISTENERS.set(name, new Set());
  LISTENERS.get(name).add(fn);
  return () => LISTENERS.get(name).delete(fn);
}
export function emit(name, data) {
  for (const fn of [...(LISTENERS.get(name) || [])]) {
    try { fn(data); } catch (e) { console.error("Ereignis " + name + ":", e); }
  }
}
