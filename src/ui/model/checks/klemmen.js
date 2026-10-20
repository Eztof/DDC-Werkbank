import { CHECKS } from "../../core/ext.js";
import { fmtNum, norm } from "../../core/util.js";
import { edgeLabel, isOutputKind, nodeTitle, valText } from "../model.js";

/* =========================================================================
   Prüfung – Klemmen: Fühler, Korrekturen, Aufschaltungen, unverknüpfte Ein-/Ausgänge, Klartexte
   ========================================================================= */
CHECKS.add({
  id: "klemmen", label: "Klemmen und Fühler", cat: "Klemmen", order: 90,
  run(C, add) {
    const corrs = [];
    for (const p of C.pins) {
      if (p.kind === "frei") continue;
      const users = p.consumers.map(e => nodeTitle(C, C.nodes.get(e.to))).slice(0, 3).join(" · ");
      if (p.kind === "AE" && p.value.invalid) {
        if (p.consumers.length) add("err", "Fühler", `${p.klemme}: Fühler ungültig, wird aber verwendet`, `„${p.name || p.paraText}“ liefert keinen gültigen Wert. Verwendet von: ${users}`, { pin: p.uid });
        else add("info", "Fühler", `${p.klemme}: Fühlereingang ohne gültigen Wert`, `„${p.name || p.paraText || "ohne Text"}“ – nicht im Programm verwendet.`, { pin: p.uid });
      }
      if (p.corr && p.corr.num) {
        corrs.push(p);
        if (Math.abs(p.corr.num) >= 2) add("warn", "Fühler", `${p.klemme}: große Fühlerkorrektur ${p.corr.num > 0 ? "+" : ""}${fmtNum(p.corr.num)} K`,
          `„${p.name}“ – Fühler oder Einbauort prüfen.`, { pin: p.uid });
      }
      if (!isOutputKind(p.kind) && p.sources.length)
        add("warn", "Klemmen", `${p.klemme}: Eingang aufgeschaltet`, `„${p.name || p.paraText}“ wird per Verknüpfung von ${p.sources.map(e => edgeLabel(C, e)).join(", ")} überschrieben – der Messwert der Klemme wirkt nicht.`, { pin: p.uid });
      if (!isOutputKind(p.kind) && p.value.deleted && p.consumers.length)
        add("warn", "Fühler", `${p.klemme}: Eingangswert gelöscht, wird aber verwendet`, `„${p.name || p.paraText}“`, { pin: p.uid });
      if (p.reserve) continue;
      if (isOutputKind(p.kind) && !p.sources.length) {
        const fixed = p.value.stored && !p.value.stored.deleted && p.value.stored.text !== "";
        const bac = p.bacnet.some(b => /FB_(AO|BO|AV|BV)/.test(b.fb));
        if (fixed && C.format !== "DDC3000") add("info", "Klemmen", `${p.klemme}: Ausgang mit Festwert ${valText(p.value.stored)}`, `„${p.name}“ – keine Verknüpfung, fester Wert.`, { pin: p.uid });
        else if (bac) add("info", "Klemmen", `${p.klemme}: Ausgang nur über BACnet`, `„${p.name}“ – im Programm nicht angesteuert.`, { pin: p.uid });
        else add("warn", "Klemmen", `${p.klemme}: Ausgang belegt, aber nicht angesteuert`, `„${p.name || p.paraText}“ hat keine Quelle im Programm.`, { pin: p.uid });
      }
      if (!isOutputKind(p.kind) && !p.consumers.length) {
        const bac = p.bacnet.some(b => b.fb !== "FB_TR");
        add("info", "Klemmen", `${p.klemme}: Eingang ${bac ? "nur auf BACnet" : "im Programm nicht verwendet"}`, `„${p.name || p.paraText}“`, { pin: p.uid });
      }
      if (p.name && p.paraText) {
        const a = norm(p.name), b = norm(p.paraText);
        if (!(a.startsWith(b) || b.startsWith(a)))
          add("warn", "Bezeichnung", `${p.klemme}: Klartext uneinheitlich`, `Klemme: „${p.name}“ · Wert: „${p.paraText}“ – Bedienung/GLT zeigt ggf. den falschen Text.`, { pin: p.uid });
      }
    }
    if (corrs.length) add("info", "Fühler", `${corrs.length} Fühler mit Korrekturwert`, corrs.map(p => `${p.klemme} ${p.corr.num > 0 ? "+" : ""}${fmtNum(p.corr.num)}`).join(" · "), null);
  }
});
