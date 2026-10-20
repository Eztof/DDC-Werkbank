import { CHECKS } from "../../core/ext.js";
import { edgeLabel, edgesIn, edgesOut, nodeTitle, pv, valText } from "../model.js";
import { paraOf } from "../d4pml.js";

/* =========================================================================
   Prüfung – Logik: offene Formeleingänge, Verweise ins Leere
   ========================================================================= */
CHECKS.add({
  id: "logik", label: "Formeln und Verweise", cat: "Logik", order: 100,
  run(C, add) {
    for (const n of C.nodes.values()) {
      if (n.ghost) continue;
      if (n.type === "M" && n.formula) {
        const used = new Set([...n.formula.matchAll(/\be([1-4])\b/g)].map(m => m[1]));
        const ins = edgesIn(C, n.id);
        const conn = new Set(ins.map(e => e.toPara));
        for (const u of used) if (!conn.has(u)) {
          const p = paraOf(n, u);
          if (p && pv(p) && C.format !== "DDC3000") add("info", "Logik", `${nodeTitle(C, n)}: e${u} ohne Verknüpfung`, `Formel „${n.formula}“ nutzt e${u}; der Eingang hat nur den festen Wert ${valText(pv(p))}.`, { node: n.id });
          else add("warn", "Logik", `${nodeTitle(C, n)}: e${u} in Formel, aber nicht verknüpft`, `Formel „${n.formula}“ – e${u} wirkt als 0${/NOT\s*\(?\s*e/.test(n.formula) ? " (unter NOT als 1)" : ""}.`, { node: n.id });
        }
        for (const c of conn) if (/^[1-4]$/.test(c) && !used.has(c)) add("info", "Logik", `${nodeTitle(C, n)}: e${c} verknüpft, aber nicht in der Formel`, `Formel „${n.formula}“ ignoriert Eingang e${c} (${ins.filter(e => e.toPara === c).map(e => edgeLabel(C, e)).join(", ")}).`, { node: n.id });
      }
    }
    /* Verweise ins Leere */
    for (const n of C.nodes.values()) {
      if (!n.ghost) continue;
      const users = edgesOut(C, n.id);
      if (!users.length) continue;
      const who = users.slice(0, 3).map(e => nodeTitle(C, C.nodes.get(e.to))).join(" · ");
      if (n.foreign) add("info", "Verknüpfung", `Signal von fremder Zentrale: ${n.id}`, "Verwendet von: " + who, { node: n.id });
      else if (C.format === "DDC3000") add("warn", "Verknüpfung", `Verweis auf nicht definierten Parameter ${n.kreis ? "Kreis " + n.kreis + " " : ""}${n.addr}`, "Verwendet von: " + who, { node: n.id });
      else if (n.ghostGroupMissing) add("warn", "Verknüpfung", `Verweis auf Gruppe, die nicht in der Sicherung steht: ${n.id}`, "Verwendet von: " + who + ". Objekt fehlt oder läuft mit Werksstandard – Funktion prüfen.", { node: n.id });
      else add("info", "Verknüpfung", `Verweis auf Objekt ohne eigene Parameter: ${n.id}`, "Werksstandard. Verwendet von: " + who, { node: n.id });
    }
  }
});
