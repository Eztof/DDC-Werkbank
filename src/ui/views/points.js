import { openNode, openPin } from "../core/nav.js";
import { vstate } from "../core/state.js";
import { liveInfo, livePinText } from "../core/live.js";
import { VIEWS } from "../core/views.js";
import { $, $$, copyText, csv, download, fmtNum, h, natCmp, norm, safeName, trunc, unitLabel } from "../core/util.js";
import { KIND_INFO, TYPE_NAMES, describeTransform, edgeLabel, isInvertedEdge, isOutputKind, nodePlace, nodeTitle, portLabel, pv, stateTextsOf, vNum, valText } from "../model/model.js";
import { foVal } from "../model/d4pml.js";
import { SEV, SEV_LABEL } from "../model/findings.js";
import { btn, emptyState, icon, kindTag, pageHead, renderAll, searchBox, selectEl, sevIcon, stationSub, toast } from "../shell/shell.js";
import { findingRow } from "./findings-sched.js";
import { WDOC, wtxt } from "../wartung/wtgml.js";
import { artForPin, artName, jumpToArt } from "../wartung/view.js";
import { artResult, docPinMap, lkIspKey, pinExternal } from "../wartung/link.js";

/* =========================================================================
   Ansicht: Datenpunkte (Klemmen)
   ========================================================================= */
export function pinValue(p) {
  const v = p.value.eff || p.value.stored;
  if (!v) return "";
  return valText(v);
}
function pinSignal(C, p) {
  const s = p.sources.map(e => edgeLabel(C, e));
  return { src: s, users: p.consumers.length };
}
function pinBac(p) { return p.bacnet.filter(b => b.fb !== "FB_TR").map(b => b.fb.replace(/^FB_/, "") + " " + b.inst).join(", "); }
export function pinCorrText(p) {
  if (!p.corr || !p.corr.num) return "";
  return (p.corr.num > 0 ? "+" : "") + fmtNum(p.corr.num) + " " + (p.corr.unitTxt || (p.kind === "AE" ? "K" : unitLabel(p.corr.unit)));
}

VIEWS.points = {
  needsC: true,
  render(root, C, opts) {
    const S = vstate("points", C, () => ({ q: "", kinds: new Set(["AE", "AA", "BE", "BA"]), mod: null, flag: "", sort: { k: "klemme", dir: 1 }, sel: null }));
    if (opts.pin) { S.sel = opts.pin; const p = C.pins.find(x => x.uid === opts.pin); if (p) { if (!S.kinds.has(p.kind)) S.kinds.add(p.kind); if (S.mod && S.mod !== p.module) S.mod = null; S.q = ""; } }
    if (opts.mod) { S.mod = opts.mod; }
    const hasVals = C.pins.some(p => p.value.eff || p.value.stored);
    const hasBac = C.pins.some(p => p.bacnet.length);
    const live = liveInfo(C.cid);              // Live-Werte aus dem Online-Reiter, falls gelesen
    let DM = new Map();                       // Klemme → Eintrag in der Wartungsdoku

    root.appendChild(pageHead("Datenpunkte", stationSub(C), [
      btn("CSV exportieren", "download", () => exportPinsCsv(C, filtered())),
      btn("Liste kopieren", "copy", () => copyText(filtered().map(p => [p.klemme, p.kind, p.name, pinValue(p)].join("\t")).join("\n")).then(() => toast("Liste kopiert.", "ok")))]));
    const body = h("div", { class: "page-body flush" });
    root.appendChild(body);
    const split = h("div", { class: "split" });
    body.appendChild(split);

    /* Modul-Leiste */
    const rail = h("div", { class: "rail" });
    const mods = C.modules.filter(m => m.pinCount);
    const railItem = (key, label, small, cnt) => h("div", { class: "rail-item" + (S.mod === key ? " on" : ""), onclick: () => { S.mod = key; renderAll(); } },
      h("div", { class: "lbl" }, label, small ? h("small", null, small) : null), h("span", { class: "cnt" }, cnt));
    rail.appendChild(h("div", { class: "rail-head" }, C.format === "DDC3000" ? "Kreise" : "Module"));
    rail.appendChild(railItem(null, "Alle", null, C.pins.filter(p => p.kind !== "frei").length));
    for (const m of mods) rail.appendChild(railItem(m.addr, (C.format === "DDC3000" ? (m.addr === "0" ? "Grundgerät" : "Kreis " + m.addr) : "Modul " + m.addr) + " · " + m.type, m.name || null, (m.pinCount - (m.kinds.frei || 0)) + "/" + m.pinCount));
    split.appendChild(rail);

    const center = h("div", { class: "center" });
    split.appendChild(center);
    const cnt = h("span", { class: "muted small" });
    const kc = {}; C.pins.forEach(p => { if (!S.mod || p.module === S.mod) kc[p.kind] = (kc[p.kind] || 0) + 1; });
    const cmd = h("div", { class: "cmdbar" },
      searchBox("Klemme, Bezeichnung, Quelle …", S.q, v => { S.q = v; drawTable(); }, "300px"),
      h("span", { class: "sep" }),
      ...["AE", "AA", "BE", "BA", "frei"].map(k => h("span", { class: "chip" + (S.kinds.has(k) ? " on" : ""), title: (KIND_INFO[k] || {}).name, onclick: e => { S.kinds.has(k) ? S.kinds.delete(k) : S.kinds.add(k); e.currentTarget.classList.toggle("on"); drawTable(); } },
        h("span", { class: "sw-dot", style: { background: `var(--k-${k})` } }), k, h("span", { class: "n" }, kc[k] || 0))),
      h("span", { class: "sep" }),
      selectEl([["", "Alle Datenpunkte"], ["find", "mit Befund"], ["corr", "mit Fühlerkorrektur"], ["invalid", "Wert ungültig / gelöscht"], ["override", "Eingang aufgeschaltet"], ["nouse", "im Programm nicht verwendet"], ["bac", "mit BACnet-Objekt"], ["trend", "mit Trend"], ["alarm", "mit Meldung"], ["att", "mit Funktionen / Anhang"], ...(WDOC.cur ? [["doc", "in der Wartungsdoku"], ["nodoc", "nicht in der Wartungsdoku"]] : [])], S.flag, v => { S.flag = v; drawTable(); }, "sm"),
      h("span", { class: "grow" }), cnt);
    center.appendChild(cmd);
    const wrap = h("div", { class: "grid-wrap" });
    center.appendChild(wrap);
    const drawer = h("div", { class: "drawer", hidden: !S.sel });
    split.appendChild(drawer);

    function filtered() {
      DM = docPinMap(C);
      const q = norm(S.q);
      let list = C.pins.filter(p => S.kinds.has(p.kind) && (!S.mod || p.module === S.mod));
      if (q) list = list.filter(p => norm([p.klemme, p.name, p.paraText, p.kind, p.subType, pinValue(p), p.sources.map(e => edgeLabel(C, e)).join(" "), pinBac(p)].join(" ")).includes(q));
      if (S.flag === "find") list = list.filter(p => p.sev);
      if (S.flag === "corr") list = list.filter(p => p.corr && p.corr.num);
      if (S.flag === "invalid") list = list.filter(p => p.value.invalid || p.value.deleted);
      if (S.flag === "override") list = list.filter(p => !isOutputKind(p.kind) && p.sources.length);
      if (S.flag === "trend") list = list.filter(p => p.trend);
      if (S.flag === "att") list = list.filter(p => p.funcs.length || p.alarms.length || p.bacnet.length || p.invert);
      if (S.flag === "nouse") list = list.filter(p => p.kind !== "frei" && !p.sources.length && !p.consumers.length);
      if (S.flag === "bac") list = list.filter(p => p.bacnet.length);
      if (S.flag === "alarm") list = list.filter(p => p.alarms.length);
      if (S.flag === "doc") list = list.filter(p => DM.has(p.uid));
      if (S.flag === "nodoc") list = list.filter(p => p.kind !== "frei" && !DM.has(p.uid));
      const k = S.sort.k, d = S.sort.dir;
      const key = {
        klemme: p => p.klemme, kind: p => KIND_INFO[p.kind].order, name: p => p.name || p.paraText || "~",
        val: p => { const v = vNum(p.value.eff || p.value.stored); return isNaN(v) ? -1e12 : v; }, corr: p => p.corr ? p.corr.num : 0,
        sev: p => -(SEV[p.sev] || 0), sig: p => p.sources.length + p.consumers.length,
        doc: p => DM.has(p.uid) ? wtxt(DM.get(p.uid).f, "facBezeichnung") : "~~~"
      }[k];
      list.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === "number" ? x - y : natCmp(x, y)) * d || natCmp(a.klemme, b.klemme); });
      return list;
    }
    function th(label, k, cls) {
      return h("th", { class: "sort " + (cls || ""), onclick: () => { if (S.sort.k === k) S.sort.dir *= -1; else S.sort = { k, dir: 1 }; drawTable(); } },
        label, S.sort.k === k ? h("span", { class: "arr" }, S.sort.dir > 0 ? "▲" : "▼") : null);
    }
    function drawTable() {
      const list = filtered();
      cnt.textContent = list.length + " von " + C.pins.length + " Klemmen";
      wrap.innerHTML = "";
      if (!list.length) { wrap.appendChild(emptyState("filter", "Keine Datenpunkte", "Filter oder Suchbegriff anpassen.")); return; }
      const hasDoc = DM.size > 0;
      const t = h("table", { class: "grid" });
      t.appendChild(h("thead", null, h("tr", null, th("Klemme", "klemme"), th("Art", "kind"), th("Bezeichnung", "name"),
        hasVals ? th("Wert", "val", "num") : null, live ? h("th", { class: "num", title: "Live-Wert aus dem Online-Reiter, Stand " + live.stamp }, "Live") : null, th("Korr.", "corr", "num"), th("Signalweg", "sig"), hasBac ? h("th", null, "BACnet") : null, hasDoc ? th("Wartungsdoku", "doc") : null, th("", "sev"))));
      const tb = h("tbody");
      for (const p of list) {
        const sg = pinSignal(C, p);
        const sub = [];
        if (p.paraText && norm(p.paraText) !== norm(p.name) && !norm(p.name).startsWith(norm(p.paraText))) sub.push("Wert-Text: " + p.paraText);
        if (p.sensorType) sub.push("Fühler " + p.sensorType);
        if (p.dfltName) sub.push("ohne Klartext");
        const v = pinValue(p);
        const tr = h("tr", { class: "click" + (S.sel === p.uid ? " on" : "") + (p.kind === "frei" ? " dim" : ""), "data-uid": p.uid, onclick: () => { S.sel = p.uid; $$("tr.on", tb).forEach(x => x.classList.remove("on")); tr.classList.add("on"); drawDrawer(); } },
          h("td", { class: "mono" }, p.klemme),
          h("td", null, kindTag(p.kind)),
          h("td", null, p.name || (p.paraText ? h("span", { class: "muted" }, p.paraText) : h("span", { class: "faint" }, "–")), sub.length ? h("span", { class: "sub" }, sub.join(" · ")) : null),
          hasVals ? h("td", { class: "num nowrap" }, p.value.invalid ? h("span", { class: "pill err" }, "ungültig") : v) : null,
          live ? (() => { const f = livePinText(C, p); return f ? h("td", { class: "num nowrap " + f.cls }, f.t) : h("td"); })() : null,
          h("td", { class: "num nowrap" }, pinCorrText(p)),
          h("td", { class: "small" }, sg.src.length ? h("div", { class: "nowrap mono", title: sg.src.join("\n") }, "◄ " + trunc(sg.src[0], 34) + (sg.src.length > 1 ? " +" + (sg.src.length - 1) : "")) : null,
            sg.users ? h("div", { class: "muted" }, "► " + sg.users + (sg.users === 1 ? " Verbraucher" : " Verbraucher")) : null,
            !sg.src.length && !sg.users && p.kind !== "frei" ? (() => { const ex = pinExternal(p); return ex.length ? h("span", { class: "muted", title: ex.join("\n") }, "nur " + (ex.some(x => x.startsWith("BACnet")) ? "BACnet" : ex.join(" / "))) : h("span", { class: "faint" }, "nicht verknüpft"); })() : null),
          hasBac ? h("td", { class: "small mono" }, pinBac(p)) : null,
          hasDoc ? h("td", { class: "small nowrap" }, (() => {
            const hit = DM.get(p.uid);
            if (!hit) return p.kind !== "frei" ? h("span", { class: "faint" }, "–") : null;
            const fb = wtxt(hit.f, "facBezeichnung"), r = artResult(hit.a);
            return [h("a", { class: "klink", title: lkIspKey(hit.isp) + " › " + fb + " › " + artName(hit.a) + (hit.st === "sicher" ? "\n(erkannt, noch nicht ins Info-Feld eingetragen)" : ""), onclick: e => { e.stopPropagation(); jumpToArt(hit); } }, icon("doc"), trunc(fb, 26)),
              " ", h("span", { class: "pill " + r.c }, r.t)];
          })()) : null,
          h("td", null, p.sev ? sevIcon(p.sev) : null));
        tb.appendChild(tr);
      }
      t.appendChild(tb);
      wrap.appendChild(t);
      const on = $("tr.on", tb);
      if (on && opts.pin) { on.scrollIntoView({ block: "center" }); if (opts.flash) { on.classList.add("flash"); opts.flash = false; } }
    }
    function drawDrawer() {
      const p = C.pins.find(x => x.uid === S.sel);
      drawer.innerHTML = "";
      if (!p) { drawer.hidden = true; return; }
      drawer.hidden = false;
      drawer.appendChild(pinDetail(C, p, () => { S.sel = null; drawer.hidden = true; $$("tr.on", wrap).forEach(x => x.classList.remove("on")); }));
    }
    drawTable();
    drawDrawer();
  }
};

function pinDetail(C, p, onClose) {
  const n = C.nodes.get(p.nodeId);
  const frag = h("div");
  frag.appendChild(h("div", { class: "drawer-head" },
    h("div", { class: "t" }, kindTag(p.kind), h("span", { class: "mono" }, p.klemme)),
    h("div", { class: "s" }, p.name || p.paraText || "ohne Bezeichnung"),
    h("div", { class: "row", style: { marginTop: "10px" } },
      btn(isOutputKind(p.kind) ? "Wirkkette: woher?" : "Wirkkette: wohin?", "flow", () => openNode(C.cid, p.nodeId, isOutputKind(p.kind) ? "up" : "down"), "accent sm"),
      btn("Im Programm", "jump", () => openNode(C.cid, p.nodeId), "sm"),
      (() => { const hit = artForPin(C, p); return hit ? btn("In der Wartungsdoku", "doc", () => jumpToArt(hit), "sm", "Zum Eintrag dieses Datenpunkts in der verknüpften Wartungsdoku") : null; })(),
      btn(null, "copy", () => copyText(pinText(C, p)).then(() => toast("Details kopiert.", "ok")), "sm", "Details kopieren")),
    onClose ? btn(null, "close", onClose, "subtle x", "Schließen") : null));
  const b = h("div", { class: "drawer-body" });
  frag.appendChild(b);
  const sec = (title, rows) => { if (!rows.length) return; b.appendChild(h("h4", null, title)); b.appendChild(h("div", { class: "dlist" }, rows)); };
  const kv = (k, v, cls) => h("div", { class: cls || "" }, h("span", { class: "k" }, k), h("span", { class: "v" }, v));

  const rows = [];
  rows.push(kv("Art", (KIND_INFO[p.kind] || {}).name + (p.subType ? " · " + p.subType : "")));
  if (p.module) rows.push(kv(C.format === "DDC3000" ? "Kreis" : "Modul", p.module + (p.moduleType ? " · " + p.moduleType : "")));
  if (p.paraText && p.paraText !== p.name) rows.push(kv("Text am Wert", p.paraText));
  if (p.sensorType) rows.push(kv("Fühlertyp", p.sensorType));
  if (p.declaredKind && p.declaredKind !== p.kind && p.kind !== "frei") rows.push(kv("Deklariert", p.declaredKind));
  if (p.invert) rows.push(kv("Invertierung", "aktiv (F014)"));
  if (p.trend) rows.push(kv("Trend", "BACnet Trend-Log aktiv"));
  if (p.dfltName) rows.push(kv("Klartext", h("span", { class: "pill warn" }, "Standardtext – kein Klartext vergeben")));
  sec("Allgemein", rows);

  const vr = [];
  if (p.value.stored) vr.push(kv("Gespeichert", valText(p.value.stored) + (p.value.stored.counter ? "  · Zähler " + p.value.stored.counter : "")));
  if (p.value.eff && p.value.eff !== p.value.stored) vr.push(kv("Wirksam", valText(p.value.eff)));
  if (p.value.invalid) vr.push(kv("Status", h("span", { class: "pill err" }, "ungültig (Fühlerbruch/-kurzschluss oder nicht angeschlossen)")));
  if (p.value.deleted) vr.push(kv("Status", h("span", { class: "pill warn" }, "Wert gelöscht")));
  if (p.corr && p.corr.num) vr.push(kv("Korrektur", pinCorrText(p)));
  sec("Wert", vr);

  if (p.sources.length) sec("Quelle (wird angesteuert von)", p.sources.map(e => edgeRow(C, e, "from")));
  if (p.consumers.length) sec("Verwendet von (" + p.consumers.length + ")", p.consumers.map(e => edgeRow(C, e, "to")));
  if (p.bacnet.length) sec("BACnet", p.bacnet.map(x => kv(x.blabel, h("span", null, h("span", { class: "mono" }, x.inst || "–"), x.cov ? h("small", null, "COV-Inkrement " + x.cov) : null, x.text ? h("small", null, x.text) : null))));
  if (p.alarms.length) sec("Meldungen", p.alarms.map(fo => kv("FSelMO", [foVal(fo, "1"), foVal(fo, "102") ? "Prio " + foVal(fo, "102") : "", foVal(fo, "6")].filter(Boolean).join(" · ") || fo.addr)));
  if (p.funcs.length) sec("Funktionen", p.funcs.filter(f => !/^FB_/.test(f.type) || f.type === "FB_TR").map(f => kv(f.type, h("span", null, f.label, f.paras.length ? h("small", null, f.paras.join(" · ")) : null))));
  const fs = C.findings.filter(f => f.ref && (f.ref.pin === p.uid || f.ref.node === p.nodeId));
  if (fs.length) { b.appendChild(h("h4", null, "Befunde")); const c = h("div", { class: "card tight" }); fs.forEach(f => c.appendChild(findingRow(C, f, true))); b.appendChild(c); }
  if (n && n.paras.length && C.format !== "DDC3000") {
    b.appendChild(h("h4", null, "Rohdaten"));
    b.appendChild(h("div", { class: "formula small" }, (n.subObjs || []).map(s => s.addr + " (" + s.type + "): " + s.paras.map(pp => pp.addr + (pv(pp) ? "=" + valText(pv(pp)) : "")).join(", ")).join("\n") || "–"));
  }
  return frag;
}
function edgeRow(C, e, dir) {
  const id = dir === "from" ? e.from : e.to;
  const n = C.nodes.get(id);
  const port = dir === "from" ? (e.fromRest ? "/" + e.fromRest : "") : " · " + portLabel(n ? n.type : "", e.toPara);
  const tr = isInvertedEdge(e) ? h("span", { class: "inv-tag" }, " invertiert") : e.transform ? h("span", { class: "small muted" }, " [" + describeTransform(e.transform, stateTextsOf(C.nodes.get(e.from), e.fromRest)) + "]") : null;
  return h("div", { class: "click", onclick: () => { if (n && n.pin) openPin(C.cid, n.pin.uid); else openNode(C.cid, id); } },
    h("span", { class: "k mono" }, (n ? n.addr : id) + (dir === "from" ? port : "")),
    h("span", { class: "v" }, n ? (n.name || TYPE_NAMES[n.type] || n.type) : "?", dir === "to" ? h("span", { class: "muted small" }, port) : null, tr,
      h("small", null, n ? nodePlace(C, n) + (n.ghost ? " · nicht in der Sicherung" : "") : ""), e.raw && dir === "from" ? h("span", { class: "raw" }, e.raw) : null));
}
function pinText(C, p) {
  const L = [p.klemme + "  " + p.kind + "  " + (p.name || p.paraText || "")];
  const v = pinValue(p); if (v) L.push("Wert: " + v + (p.value.invalid ? " (ungültig)" : ""));
  if (p.corr && p.corr.num) L.push("Korrektur: " + pinCorrText(p));
  p.sources.forEach(e => L.push("Quelle: " + edgeLabel(C, e) + " " + (C.nodes.get(e.from) || {}).name));
  p.consumers.forEach(e => L.push("Verwendet von: " + nodeTitle(C, C.nodes.get(e.to))));
  p.bacnet.forEach(b => L.push("BACnet: " + b.blabel + " " + b.inst));
  return L.join("\r\n");
}
function exportPinsCsv(C, list) {
  const rows = [["Zentrale", "Modul", "Modultyp", "Klemme", "Art", "Bezeichnung", "Text am Wert", "Wert", "ungültig", "Korrektur", "Quelle", "Verwendet von", "BACnet", "Befund"]];
  for (const p of list) rows.push([C.meta.centralAddr, p.module, p.moduleType, p.klemme, p.kind, p.name, p.paraText, pinValue(p), p.value.invalid ? "ja" : "", pinCorrText(p),
    p.sources.map(e => edgeLabel(C, e)).join(", "), p.consumers.map(e => (C.nodes.get(e.to) || {}).addr).join(", "), pinBac(p), p.sev ? SEV_LABEL[p.sev] : ""]);
  download(safeName(C.meta.name) + "_Datenpunkte.csv", csv(rows), "text/csv;charset=utf-8");
}

