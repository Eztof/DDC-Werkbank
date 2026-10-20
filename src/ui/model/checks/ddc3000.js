import { CHECKS } from "../../core/ext.js";
import { edgeLabel, KIND_INFO } from "../model.js";

/* =========================================================================
   Prüfung – DDC3000: Klartexte, Meldequellen, unbenutzte Wochenprogramme
   ========================================================================= */
CHECKS.add({
  id: "ddc3000", label: "DDC3000-Besonderheiten", cat: "Bezeichnung", order: 80, formats: ["DDC3000"],
  run(C, add) {
    for (const p of C.pins) {
      if (p.dfltName && (p.sources.length || p.consumers.length))
        add("warn", "Bezeichnung", `${p.klemme}: ${KIND_INFO[p.kind].name} verknüpft, aber ohne Klartext`,
          p.sources.length ? "Quelle: " + p.sources.map(e => edgeLabel(C, e)).join(", ") : "Verwendet von " + p.consumers.length + " Verknüpfung(en).", { pin: p.uid });
    }
    for (const a of C.alarms) if (!a.src) add("info", "Meldung", a.name + ": keine Meldequelle", "Meldeziel " + (a.ziel || "–"), { node: a.nodeId });
    for (const s of C.schedules) if (!s.consumers.length) {
      const used = C.edges.some(e => e.from === s.nodeId);
      if (!used) add("info", "Zeitprogramm", s.name + " (" + s.nodeId.split(":")[1] + ") wird nicht verwendet", "Kein Kreis und keine Verknüpfung greift auf dieses Wochenprogramm zu.", { node: s.nodeId });
    }
  }
});
