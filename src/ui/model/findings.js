import { fmtNum, natCmp, norm, uniq } from "../core/util.js";
import { KIND_INFO, edgeLabel, edgesIn, edgesOut, isOutputKind, nodePlace, nodeTitle, pe, pv, stateTextsOf, vBool, vNum, valText } from "./model.js";
import { WD, paraOf } from "./d4pml.js";

/* =========================================================================
   Befunde: automatische Prüfungen auf das Modell
   ========================================================================= */
export const SEV = { err: 3, warn: 2, info: 1 };
export const SEV_LABEL = { err: "Fehler", warn: "Warnung", info: "Hinweis" };

export function runFindings(C) {
  const F = [];
  const add = (sev, cat, title, detail, ref) => F.push({ sev, cat, title, detail: detail || "", ref: ref || null });
  if (C.format === "DDC3000") findingsD3(C, add); else findingsD4(C, add);
  findingsPins(C, add);
  findingsLogic(C, add);
  F.sort((a, b) => SEV[b.sev] - SEV[a.sev] || natCmp(a.cat, b.cat) || natCmp(a.title, b.title));
  F.forEach((f, i) => f.id = i);
  C.findings = F;
  C.nodeSev = new Map();
  for (const f of F) {
    const id = f.ref && (f.ref.node || f.ref.pin);
    if (id && SEV[f.sev] > (SEV[C.nodeSev.get(id)] || 0)) C.nodeSev.set(id, f.sev);
  }
  for (const p of C.pins) p.sev = C.nodeSev.get(p.nodeId) || null;
  return F;
}

function stateName(node, st, paraAddr) {
  const t = stateTextsOf(node, paraAddr || "h");
  if (t && t[String(st)] != null) return t[String(st)].trim();
  return { "9": "Auto", "0": "Aus", "1": "Ein", "2": "Stufe 2" }[String(st)] || String(st);
}

function findingsD4(C, add) {
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
  /* --- Meldungen --- */
  for (const m of C.messages.filter(x => x.active))
    add("warn", "Meldung", "Meldung steht an: " + m.text.split("/").filter(Boolean).slice(-3).join(" › "),
      `${m.kind || "Meldung"} kommend ${m.comeTxt || "–"} · Quelle ${m.path}`, m.nodeId && C.nodes.has(m.nodeId) ? { node: m.nodeId } : null);
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
  /* --- Sicherheit / System --- */
  const pw = C.users.filter(u => u.password);
  if (pw.length) add("warn", "Sicherheit", `${pw.length} Bedienerpasswörter im Klartext in der Sicherung`,
    "Die Sicherungsdatei enthält die Passwörter der Bedienebenen unverschlüsselt. Vor Weitergabe an Dritte beachten.", null);
  if (C.meta.battery > 0 && C.meta.battery < 2.8) add("warn", "System", `Pufferbatterie ${fmtNum(C.meta.battery)} V`, "Spannung niedrig – Batteriewechsel einplanen.", null);
  for (const s of C.system.filter(x => x.warn)) add("warn", "System", s.k + ": " + s.v, s.group, null);
  /* --- Wartungszähler --- */
  for (const n of N.values()) {
    if (n.type !== "S066" || n.ghost || !/wartung/i.test(n.name + " " + ((paraOf(n, "2") || {}).texts || []).join(" "))) continue;
    const ist = pe(paraOf(n, "4839")), gw = pv(paraOf(n, "8610")), out = vBool(pv(paraOf(n, "2")));
    if (ist && gw) add(out ? "warn" : "info", "Wartung", `Wartungszähler: ${fmtNum(ist.text, 0)} von ${fmtNum(gw.text, 0)}`,
      out ? "Wartung empfohlen – Schwelle erreicht." : `Noch ${fmtNum(parseFloat(gw.text) - parseFloat(ist.text), 0)} bis zur Wartungsempfehlung (${nodePlace(C, n)}).`, { node: n.id });
  }
  /* --- 3-Punkt-Ausgänge Auf/Zu konsistent? --- */
  const maps = [];
  for (const n of N.values()) {
    if (n.type !== "H613" || n.ghost) continue;
    const m = {};
    for (const e of edgesOut(C, n.id)) {
      const t = N.get(e.to); if (!t || !t.pin) continue;
      const nm = t.pin.name + " " + t.pin.paraText;
      const w = /\bauf\b/i.test(t.pin.name) ? "auf" : /\bzu\b/i.test(t.pin.name) ? "zu" : null;
      if (w) m[e.fromRest] = { w, pin: t.pin };
      void nm;
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

function findingsD3(C, add) {
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

function findingsPins(C, add) {
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

function findingsLogic(C, add) {
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

