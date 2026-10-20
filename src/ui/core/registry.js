/* =========================================================================
   Register: geordnete Listen von Erweiterungen (Dateiformate, Ansichten,
   Prüfungen, Spalten …). Jeder Eintrag hat eine eindeutige id und optional
   eine Reihenfolge (order, kleiner = weiter vorne).
   ========================================================================= */
export function registry(name) {
  const items = new Map();
  let seq = 0, sorted = null;
  const R = {
    name,
    /* Eintragen; gleiche id ersetzt den alten Eintrag (z. B. zum Überschreiben eines eingebauten) */
    add(def) {
      if (!def || typeof def !== "object" || !def.id) throw new Error(name + ": Eintrag ohne id");
      const old = items.get(def.id);
      items.set(def.id, Object.assign({ order: 100 }, def, { _seq: old ? old._seq : seq++ }));
      sorted = null; R.ver++;
      return items.get(def.id);
    },
    remove(id) { if (items.delete(id)) { sorted = null; R.ver++; } },
    get: id => items.get(id) || null,
    has: id => items.has(id),
    /* alle Einträge in Reihenfolge, optional gefiltert */
    list(pred) {
      if (!sorted) sorted = [...items.values()].sort((a, b) => (a.order - b.order) || (a._seq - b._seq));
      return pred ? sorted.filter(pred) : sorted;
    },
    get size() { return items.size; },
    ver: 1
  };
  return R;
}

/* Eine Erweiterung aufrufen, ohne dass ihr Fehler den Rest mitreißt */
export function safely(what, fn, fallback) {
  try { return fn(); }
  catch (e) { console.error(what + ":", e); return fallback; }
}
