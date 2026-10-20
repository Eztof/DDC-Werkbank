import { CHECKS } from "../../core/ext.js";
import { edgesIn, edgesOut, nodePlace, pe, pv, stateTextsOf, valText, vBool, vNum } from "../model.js";
import { paraOf } from "../d4pml.js";

/* =========================================================================
   Prüfung – Handeingriffe: Handschalter an Aggregaten/Pumpen, Schalter, Handwerte an Stellgeräten
   ========================================================================= */
function stateName(node, st, paraAddr) {
  const t = stateTextsOf(node, paraAddr || "h");
  if (t && t[String(st)] != null) return t[String(st)].trim();
  return { "9": "Auto", "0": "Aus", "1": "Ein", "2": "Stufe 2" }[String(st)] || String(st);
}

CHECKS.add({
  id: "hand", label: "Handschalter und Handwerte", cat: "Handeingriff", order: 10, formats: ["D4PML"],
  run(C, add) {
    const N = C.nodes;
    const handFed = new Set();
    /* --- Handeingriffe an Aggregaten/Pumpen --- */
    for (const n of N.values()) {
      if (n.ghost || (n.type !== "H601" && n.type !== "H901")) continue;
      const hpAddr = n.type === "H601" ? "10" : "5";
      const hp = paraOf(n, hpAddr); if (!hp) continue;
      const st = vNum(pe(hp));
      const e = edgesIn(C, n.id).find(x => x.toPara === hpAddr);
      const sn = e ? N.get(e.from) : null;
      if (sn) handFed.add(sn.id);
      if (isNaN(st) || st === 9) continue;
      const req = vBool(pe(paraOf(n, "1")));
      const place = nodePlace(C, n);
      const stxt = stateName(sn, st);
      const ref = { node: sn ? sn.id : n.id };
      if (st === 0 && req) add("err", "Handeingriff", place + ": Hand AUS blockiert Anforderung",
        `Die Automatik fordert EIN (${n.type} Para 1), der Handschalter steht auf „${stxt}“. ${n.type === "H901" ? "Die Pumpe" : "Das Aggregat"} bleibt aus.`, ref);
      else if (st === 0) add("warn", "Handeingriff", place + ": Handschalter AUS", `Von Hand abgeschaltet (${n.type}). Aktuell keine Anforderung der Automatik.`, ref);
      else if (st === 1) add("warn", "Handeingriff", place + ": Hand EIN (Dauerbetrieb)", req ? "Automatik fordert ebenfalls EIN." : "Automatik fordert AUS – läuft trotzdem.", ref);
      else add("warn", "Handeingriff", place + ": Handschalter „" + stxt + "“", "Schalter nicht auf Automatik.", ref);
    }
    for (const n of N.values()) {
      if (n.ghost || n.type !== "S_01" || handFed.has(n.id)) continue;
      const hp = paraOf(n, "h"); const v = pv(hp); if (!v) continue;
      const st = vNum(pe(hp));
      const isSwitch = v.handPlant || (hp.stateTexts && hp.stateTexts["9"] != null);
      if (!isSwitch || isNaN(st) || st === 9) continue;
      const users = edgesOut(C, n.id).length;
      add("warn", "Handeingriff", nodePlace(C, n) + ": Handschalter „" + stateName(n, st) + "“",
        "Schalter " + n.addr + " steht nicht auf Auto" + (users ? ` und wirkt auf ${users} Verknüpfung(en).` : "."), { node: n.id });
    }
    for (const n of N.values()) {
      if (n.ghost || (n.type !== "H613" && n.type !== "H614")) continue;
      const v = pv(paraOf(n, "10"));
      if (v && !v.deleted && v.text !== "") add("warn", "Handeingriff", nodePlace(C, n) + ": Handwert am Stellgerät aktiv",
        `${n.type} Para 10 = ${valText(v)} – überschreibt die Regelung.`, { node: n.id });
    }
  }
});
