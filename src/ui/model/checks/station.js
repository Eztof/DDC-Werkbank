import { CHECKS } from "../../core/ext.js";
import { fmtNum, uniq } from "../../core/util.js";
import { nodePlace, nodeTitle, pe, pv, vBool } from "../model.js";
import { paraOf, WD } from "../d4pml.js";

/* =========================================================================
   Prüfung – Station: anstehende Meldungen, BACnet, Zeitprogramme, Sicherheit/System, Wartungszähler
   ========================================================================= */
CHECKS.add({
  id: "meldungen", label: "Anstehende Meldungen", cat: "Meldung", order: 20, formats: ["D4PML"],
  run(C, add) {
    /* --- Meldungen --- */
    for (const m of C.messages.filter(x => x.active))
      add("warn", "Meldung", "Meldung steht an: " + m.text.split("/").filter(Boolean).slice(-3).join(" › "),
        `${m.kind || "Meldung"} kommend ${m.comeTxt || "–"} · Quelle ${m.path}`, m.nodeId && C.nodes.has(m.nodeId) ? { node: m.nodeId } : null);
  }
});

CHECKS.add({
  id: "bacnet", label: "BACnet-Instanzen und Objektreferenzen", cat: "BACnet", order: 30, formats: ["D4PML"],
  run(C, add) {
    const N = C.nodes;
    /* --- BACnet --- */
    const seen = new Map();
    for (const b of C.bacnet) {
      if (!b.inst || b.fb === "DEV") continue;
      const k = b.btype + ":" + b.inst;
      if (!seen.has(k)) seen.set(k, []); seen.get(k).push(b);
    }
    for (const [k, list] of seen) if (list.length > 1) {
      add("err", "BACnet", `Doppelte BACnet-Instanz ${list[0].blabel} ${list[0].inst}`,
        list.map(b => nodeTitle(C, C.nodes.get(b.nodeId)) + (b.para ? " /" + b.para : "")).join(" · "), { node: list[0].nodeId });
    }
    const lf = [...N.values()].filter(n => n.loprForeign && n.loprForeign.length);
    if (lf.length) {
      const devs = uniq(lf.flatMap(n => n.loprForeign.map(l => l.dev)));
      const localInst = new Set(C.bacnet.map(b => String(b.inst)));
      const allLocal = lf.every(n => n.loprForeign.every(l => localInst.has(String(l.inst))));
      add("warn", "BACnet", `${lf.length} Zeitprogramm${lf.length > 1 ? "e" : ""} mit Objektreferenz auf Device ${devs.join(", ")} statt ${C.meta.bacnetDevId || "eigener Instanz"}`,
        lf.map(n => nodePlace(C, n) + " → " + n.loprForeign.map(l => l.type + ":" + l.inst).join(", ")).join(" · ") +
        (allLocal ? ". Die Zielobjekte liegen in dieser Station – die Device-Instanz wurde vermutlich nachträglich geändert oder das Programm kopiert. Prüfen, ob die Zeitpläne wirklich schalten."
                  : ". Häufige Ursache: Programm von einer anderen Station kopiert."), { node: lf[0].id, nodes: lf.map(n => n.id) });
    }
  }
});

CHECKS.add({
  id: "zeitprogramme", label: "Zeitprogramme", cat: "Zeitprogramm", order: 40, formats: ["D4PML"],
  run(C, add) {
    /* --- Zeitprogramme: doppelte Schaltzeiten --- */
    for (const s of C.schedules) {
      const bad = [];
      for (const d of s.days || []) {
        const times = d.entries.map(e => e.time);
        const dup = times.filter((t, i) => times.indexOf(t) !== i);
        const unsorted = times.some((t, i) => i && t < times[i - 1]);
        if (dup.length || unsorted) bad.push((WD[d.weekday] || d.weekday) + (dup.length ? " (" + uniq(dup).join(", ") + " doppelt)" : ""));
      }
      if (bad.length) add("warn", "Zeitprogramm", `${s.name}: Schaltzeiten doppelt oder ungeordnet`,
        `Betroffen: ${bad.join(" · ")}. Die Einträge überschneiden sich – wirksam ist die zeitlich letzte Schaltung. Programm am Gerät bereinigen.`, { node: s.nodeId });
      if (!s.consumers.length && C.format !== "DDC3000") add("info", "Zeitprogramm", `${s.name}: Ausgang nicht im Programm verwendet`, "Nur über BACnet oder gar nicht genutzt.", { node: s.nodeId });
    }
  }
});

CHECKS.add({
  id: "system", label: "Sicherheit und Systemwerte", cat: "System", order: 50, formats: ["D4PML"],
  run(C, add) {
    /* --- Sicherheit / System --- */
    const pw = C.users.filter(u => u.password);
    if (pw.length) add("warn", "Sicherheit", `${pw.length} Bedienerpasswörter im Klartext in der Sicherung`,
      "Die Sicherungsdatei enthält die Passwörter der Bedienebenen unverschlüsselt. Vor Weitergabe an Dritte beachten.", null);
    if (C.meta.battery > 0 && C.meta.battery < 2.8) add("warn", "System", `Pufferbatterie ${fmtNum(C.meta.battery)} V`, "Spannung niedrig – Batteriewechsel einplanen.", null);
    for (const s of C.system.filter(x => x.warn)) add("warn", "System", s.k + ": " + s.v, s.group, null);
  }
});

CHECKS.add({
  id: "wartungszaehler", label: "Wartungszähler", cat: "Wartung", order: 60, formats: ["D4PML"],
  run(C, add) {
    const N = C.nodes;
    /* --- Wartungszähler --- */
    for (const n of N.values()) {
      if (n.type !== "S066" || n.ghost || !/wartung/i.test(n.name + " " + ((paraOf(n, "2") || {}).texts || []).join(" "))) continue;
      const ist = pe(paraOf(n, "4839")), gw = pv(paraOf(n, "8610")), out = vBool(pv(paraOf(n, "2")));
      if (ist && gw) add(out ? "warn" : "info", "Wartung", `Wartungszähler: ${fmtNum(ist.text, 0)} von ${fmtNum(gw.text, 0)}`,
        out ? "Wartung empfohlen – Schwelle erreicht." : `Noch ${fmtNum(parseFloat(gw.text) - parseFloat(ist.text), 0)} bis zur Wartungsempfehlung (${nodePlace(C, n)}).`, { node: n.id });
    }
  }
});
