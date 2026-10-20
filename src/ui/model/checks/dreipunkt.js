import { CHECKS } from "../../core/ext.js";
import { uniq } from "../../core/util.js";
import { edgesOut, nodePlace } from "../model.js";

/* =========================================================================
   Prüfung – 3-Punkt-Stellantriebe: Auf/Zu-Ausgänge plausibel verdrahtet?
   ========================================================================= */
CHECKS.add({
  id: "dreipunkt", label: "3-Punkt-Stellantriebe Auf/Zu", cat: "Logik", order: 70, formats: ["D4PML"],
  run(C, add) {
    const N = C.nodes;
    /* --- 3-Punkt-Ausgänge Auf/Zu konsistent? --- */
    const maps = [];
    for (const n of N.values()) {
      if (n.type !== "H613" || n.ghost) continue;
      const m = {};
      for (const e of edgesOut(C, n.id)) {
        const t = N.get(e.to); if (!t || !t.pin) continue;
        const w = /\bauf\b/i.test(t.pin.name) ? "auf" : /\bzu\b/i.test(t.pin.name) ? "zu" : null;
        if (w) m[e.fromRest] = { w, pin: t.pin };
      }
      if (m["7"] && m["8"] && m["7"].w === m["8"].w) add("err", "Logik", nodePlace(C, n) + ": beide 3-Punkt-Ausgänge „" + m["7"].w + "“", `${m["7"].pin.klemme} und ${m["8"].pin.klemme} sind gleich benannt.`, { node: n.id });
      if (m["7"] || m["8"]) maps.push({ n, m });
    }
    const sig = x => (x.m["7"] ? x.m["7"].w : "-") + "/" + (x.m["8"] ? x.m["8"].w : "-");
    const kinds = uniq(maps.map(sig).filter(x => !x.includes("-")));
    if (kinds.length > 1) add("warn", "Logik", "3-Punkt-Stellantriebe uneinheitlich verdrahtet",
      maps.map(x => `${nodePlace(C, x.n)}: Ausgang 7 → ${x.m["7"] ? x.m["7"].pin.klemme + " „" + x.m["7"].pin.name + "“" : "–"}, Ausgang 8 → ${x.m["8"] ? x.m["8"].pin.klemme + " „" + x.m["8"].pin.name + "“" : "–"}`).join(" · ") +
      " – bei einem Antrieb sind Auf/Zu vermutlich vertauscht.", { node: maps[0].n.id });
  }
});
