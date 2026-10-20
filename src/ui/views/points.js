import { openNode, openPin } from "../core/nav.js";
import { vstate } from "../core/state.js";
import { liveInfo, liveOfPin, livePinText } from "../core/live.js";
import { PIN_ACTIONS, PIN_COLUMNS, PIN_FILTERS, PIN_SECTIONS, SEARCH, VIEWS } from "../core/ext.js";
import { safely } from "../core/registry.js";
import { $, $$, copyText, csv, download, fmtNum, h, lazyAppend, natCmp, norm, safeName, trunc, unitLabel } from "../core/util.js";
import { KIND_INFO, TYPE_NAMES, describeTransform, edgeLabel, isInvertedEdge, isOutputKind, nodePlace, nodeTitle, pinOf, portLabel, pv, stateTextsOf, vNum, valText } from "../model/model.js";
import { foVal } from "../model/d4pml.js";
import { SEV, SEV_LABEL } from "../model/findings.js";
import { btn, emptyState, icon, kindTag, pageHead, renderAll, searchBox, selectEl, sevIcon, stationSub, toast } from "../shell/shell.js";
import { findingRow } from "./findings-sched.js";
import { pinExternal } from "../wartung/link.js";

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

/* Zeichen-Kontext je Tabellenaufbau: Spalten und Filter dürfen in prepare() Daten ablegen */
function pinCtx(C) {
  const ctx = { C, live: liveInfo(C.cid), hasVals: C.pins.some(p => p.value.eff || p.value.stored), hasBac: C.pins.some(p => p.bacnet.length) };
  for (const X of [...PIN_COLUMNS.list(), ...PIN_FILTERS.list()]) if (X.prepare) safely("Datenpunkte " + X.id, () => X.prepare(C, ctx));
  return ctx;
}

VIEWS.add({
  id: "points", label: "Datenpunkte", icon: "table", group: 1, order: 120,
  needsC: true,
  render(root, C, opts) {
    const S = vstate("points", C, () => ({ q: "", kinds: new Set(["AE", "AA", "BE", "BA"]), mod: null, flag: "", sort: { k: "klemme", dir: 1 }, sel: null }));
    if (opts.pin) { S.sel = opts.pin; const p = pinOf(C, opts.pin); if (p) { if (!S.kinds.has(p.kind)) S.kinds.add(p.kind); if (S.mod && S.mod !== p.module) S.mod = null; S.q = ""; } }
    if (opts.mod) { S.mod = opts.mod; }
    let ctx = pinCtx(C);

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
    const flags = PIN_FILTERS.list(F => !F.show || safely("Filter " + F.id, () => F.show(C, ctx), false));
    if (S.flag && !flags.some(F => F.id === S.flag)) S.flag = "";
    const cmd = h("div", { class: "cmdbar" },
      searchBox("Klemme, Bezeichnung, Quelle …", S.q, v => { S.q = v; drawTable(); }, "300px"),
      h("span", { class: "sep" }),
      ...["AE", "AA", "BE", "BA", "frei"].map(k => h("span", { class: "chip" + (S.kinds.has(k) ? " on" : ""), title: (KIND_INFO[k] || {}).name, onclick: e => { S.kinds.has(k) ? S.kinds.delete(k) : S.kinds.add(k); e.currentTarget.classList.toggle("on"); drawTable(); } },
        h("span", { class: "sw-dot", style: { background: `var(--k-${k})` } }), k, h("span", { class: "n" }, kc[k] || 0))),
      h("span", { class: "sep" }),
      selectEl([["", "Alle Datenpunkte"], ...flags.map(F => [F.id, F.label])], S.flag, v => { S.flag = v; drawTable(); }, "sm"),
      h("span", { class: "grow" }), cnt);
    center.appendChild(cmd);
    const wrap = h("div", { class: "grid-wrap" });
    center.appendChild(wrap);
    const drawer = h("div", { class: "drawer", hidden: !S.sel });
    split.appendChild(drawer);

    function filtered() {
      ctx = pinCtx(C);
      const q = norm(S.q);
      let list = C.pins.filter(p => S.kinds.has(p.kind) && (!S.mod || p.module === S.mod));
      if (q) list = list.filter(p => norm([p.klemme, p.name, p.paraText, p.kind, p.subType, pinValue(p), p.sources.map(e => edgeLabel(C, e)).join(" "), pinBac(p)].join(" ")).includes(q));
      const F = S.flag && PIN_FILTERS.get(S.flag);
      if (F) list = list.filter(p => safely("Filter " + F.id, () => F.test(p, ctx, C), false));
      const col = PIN_COLUMNS.get(S.sort.k), d = S.sort.dir;
      const key = col && col.sort ? p => col.sort(p, ctx) : p => p.klemme;
      const keyed = list.map(p => [key(p), p]);
      keyed.sort((a, b) => { const x = a[0], y = b[0]; return (typeof x === "number" && typeof y === "number" ? x - y : natCmp(x, y)) * d || natCmp(a[1].klemme, b[1].klemme); });
      return keyed.map(x => x[1]);
    }
    function th(col) {
      const title = col.title ? safely("Spalte " + col.id, () => col.title(C, ctx), null) : null;
      if (!col.sort) return h("th", { class: col.cls || "", title }, col.label);
      return h("th", { class: "sort " + (col.cls || ""), title, onclick: () => { if (S.sort.k === col.id) S.sort.dir *= -1; else S.sort = { k: col.id, dir: 1 }; drawTable(); } },
        col.label, S.sort.k === col.id ? h("span", { class: "arr" }, S.sort.dir > 0 ? "▲" : "▼") : null);
    }
    function drawTable() {
      const list = filtered();
      cnt.textContent = list.length + " von " + C.pins.length + " Klemmen";
      wrap.innerHTML = "";
      if (!list.length) { wrap.appendChild(emptyState("filter", "Keine Datenpunkte", "Filter oder Suchbegriff anpassen.")); return; }
      const cols = PIN_COLUMNS.list(X => !X.show || safely("Spalte " + X.id, () => X.show(C, ctx), false));
      const t = h("table", { class: "grid" });
      t.appendChild(h("thead", null, h("tr", null, cols.map(th))));
      const tb = h("tbody");
      t.appendChild(tb);
      wrap.appendChild(t);
      const row = p => {
        const tr = h("tr", { class: "click" + (S.sel === p.uid ? " on" : "") + (p.kind === "frei" ? " dim" : ""), "data-uid": p.uid });
        for (const X of cols) {
          const v = safely("Spalte " + X.id, () => X.cell(C, p, ctx), null);
          const isTd = v && typeof v === "object" && "td" in v;
          tr.appendChild(h("td", { class: [X.cls, isTd ? v.cls : ""].filter(Boolean).join(" ") || null }, isTd ? v.td : v));
        }
        return tr;
      };
      /* ein Klick-Handler für alle Zeilen statt einem je Zeile */
      tb.addEventListener("click", e => {
        const tr = e.target.closest("tr[data-uid]"); if (!tr || e.defaultPrevented) return;
        S.sel = tr.dataset.uid; $$("tr.on", tb).forEach(x => x.classList.remove("on")); tr.classList.add("on"); drawDrawer();
      });
      const selIdx = S.sel ? list.findIndex(p => p.uid === S.sel) : -1;
      lazyAppend(tb, list, row, { first: 120, until: selIdx >= 0 ? selIdx + 20 : null, scroller: wrap });
      const on = $("tr.on", tb);
      if (on && opts.pin) { on.scrollIntoView({ block: "center" }); if (opts.flash) { on.classList.add("flash"); opts.flash = false; } }
    }
    function drawDrawer() {
      const p = pinOf(C, S.sel);
      drawer.innerHTML = "";
      if (!p) { drawer.hidden = true; return; }
      drawer.hidden = false;
      drawer.appendChild(pinDetail(C, p, () => { S.sel = null; drawer.hidden = true; $$("tr.on", wrap).forEach(x => x.classList.remove("on")); }));
    }
    drawTable();
    drawDrawer();
  }
});

/* ---------- Spalten der Datenpunkt-Tabelle (weitere: PIN_COLUMNS.add in anderen Modulen) ---------- */
PIN_COLUMNS.add({ id: "klemme", label: "Klemme", order: 10, cls: "mono", sort: p => p.klemme, cell: (C, p) => p.klemme });
PIN_COLUMNS.add({ id: "kind", label: "Art", order: 20, sort: p => KIND_INFO[p.kind].order, cell: (C, p) => kindTag(p.kind) });
PIN_COLUMNS.add({ id: "name", label: "Bezeichnung", order: 30, sort: p => p.name || p.paraText || "~",
  cell(C, p) {
    const sub = [];
    if (p.paraText && norm(p.paraText) !== norm(p.name) && !norm(p.name).startsWith(norm(p.paraText))) sub.push("Wert-Text: " + p.paraText);
    if (p.sensorType) sub.push("Fühler " + p.sensorType);
    if (p.dfltName) sub.push("ohne Klartext");
    return [p.name || (p.paraText ? h("span", { class: "muted" }, p.paraText) : h("span", { class: "faint" }, "–")), sub.length ? h("span", { class: "sub" }, sub.join(" · ")) : null];
  } });
PIN_COLUMNS.add({ id: "val", label: "Wert", order: 40, cls: "num nowrap", show: (C, ctx) => ctx.hasVals,
  sort: p => { const v = vNum(p.value.eff || p.value.stored); return isNaN(v) ? -1e12 : v; },
  cell: (C, p) => p.value.invalid ? h("span", { class: "pill err" }, "ungültig") : pinValue(p) });
PIN_COLUMNS.add({ id: "live", label: "Live", order: 50, cls: "num nowrap", show: (C, ctx) => !!ctx.live,
  title: (C, ctx) => "Live-Wert (" + ctx.live.label + "), Stand " + ctx.live.stamp,
  cell: (C, p) => { const f = livePinText(C, p); return f ? { td: f.t, cls: f.cls } : null; } });
PIN_COLUMNS.add({ id: "corr", label: "Korr.", order: 60, cls: "num nowrap", sort: p => p.corr ? p.corr.num : 0, cell: (C, p) => pinCorrText(p) });
PIN_COLUMNS.add({ id: "sig", label: "Signalweg", order: 70, cls: "small", sort: p => p.sources.length + p.consumers.length,
  cell(C, p) {
    const sg = pinSignal(C, p);
    return [sg.src.length ? h("div", { class: "nowrap mono", title: sg.src.join("\n") }, "◄ " + trunc(sg.src[0], 34) + (sg.src.length > 1 ? " +" + (sg.src.length - 1) : "")) : null,
      sg.users ? h("div", { class: "muted" }, "► " + sg.users + " Verbraucher") : null,
      !sg.src.length && !sg.users && p.kind !== "frei" ? (() => { const ex = pinExternal(p); return ex.length ? h("span", { class: "muted", title: ex.join("\n") }, "nur " + (ex.some(x => x.startsWith("BACnet")) ? "BACnet" : ex.join(" / "))) : h("span", { class: "faint" }, "nicht verknüpft"); })() : null];
  } });
PIN_COLUMNS.add({ id: "bac", label: "BACnet", order: 80, cls: "small mono", show: (C, ctx) => ctx.hasBac, cell: (C, p) => pinBac(p) });
PIN_COLUMNS.add({ id: "sev", label: "", order: 1000, sort: p => -(SEV[p.sev] || 0), cell: (C, p) => p.sev ? sevIcon(p.sev) : null });

/* ---------- Filter (Auswahl „Alle Datenpunkte“) ---------- */
[["find", "mit Befund", p => p.sev], ["corr", "mit Fühlerkorrektur", p => p.corr && p.corr.num], ["invalid", "Wert ungültig / gelöscht", p => p.value.invalid || p.value.deleted],
  ["override", "Eingang aufgeschaltet", p => !isOutputKind(p.kind) && p.sources.length], ["nouse", "im Programm nicht verwendet", p => p.kind !== "frei" && !p.sources.length && !p.consumers.length],
  ["bac", "mit BACnet-Objekt", p => p.bacnet.length], ["trend", "mit Trend", p => p.trend], ["alarm", "mit Meldung", p => p.alarms.length],
  ["att", "mit Funktionen / Anhang", p => p.funcs.length || p.alarms.length || p.bacnet.length || p.invert]]
  .forEach(([id, label, test], i) => PIN_FILTERS.add({ id, label, order: 10 + i * 10, test }));
PIN_FILTERS.add({ id: "live", label: "mit Live-Wert", order: 95, show: (C, ctx) => !!ctx.live, test: (p, ctx, C) => !!liveOfPin(C, p) });

/* ---------- Detailbereich: Live-Wert ---------- */
PIN_SECTIONS.add({ id: "live", order: 15, render(C, p, sec, kv) {
  const f = livePinText(C, p); if (!f) return;
  const L = liveInfo(C.cid);
  sec("Live", [kv("Wert", h("span", { class: f.cls }, f.t)), kv("Quelle", L.label + (L.ip ? " · " + L.ip : "") + " · Stand " + L.stamp)]);
} });

function pinDetail(C, p, onClose) {
  const n = C.nodes.get(p.nodeId);
  const frag = h("div");
  frag.appendChild(h("div", { class: "drawer-head" },
    h("div", { class: "t" }, kindTag(p.kind), h("span", { class: "mono" }, p.klemme)),
    h("div", { class: "s" }, p.name || p.paraText || "ohne Bezeichnung"),
    h("div", { class: "row", style: { marginTop: "10px" } },
      btn(isOutputKind(p.kind) ? "Wirkkette: woher?" : "Wirkkette: wohin?", "flow", () => openNode(C.cid, p.nodeId, isOutputKind(p.kind) ? "up" : "down"), "accent sm"),
      btn("Im Programm", "jump", () => openNode(C.cid, p.nodeId), "sm"),
      PIN_ACTIONS.list().map(A => safely("Knopf " + A.id, () => A.button(C, p), null)),
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
  const extra = (pred) => { for (const X of PIN_SECTIONS.list(pred)) safely("Abschnitt " + X.id, () => X.render(C, p, sec, kv)); };
  extra(X => X.order < 50);

  if (p.sources.length) sec("Quelle (wird angesteuert von)", p.sources.map(e => edgeRow(C, e, "from")));
  if (p.consumers.length) sec("Verwendet von (" + p.consumers.length + ")", p.consumers.map(e => edgeRow(C, e, "to")));
  if (p.bacnet.length) sec("BACnet", p.bacnet.map(x => kv(x.blabel, h("span", null, h("span", { class: "mono" }, x.inst || "–"), x.cov ? h("small", null, "COV-Inkrement " + x.cov) : null, x.text ? h("small", null, x.text) : null))));
  if (p.alarms.length) sec("Meldungen", p.alarms.map(fo => kv("FSelMO", [foVal(fo, "1"), foVal(fo, "102") ? "Prio " + foVal(fo, "102") : "", foVal(fo, "6")].filter(Boolean).join(" · ") || fo.addr)));
  if (p.funcs.length) sec("Funktionen", p.funcs.filter(f => !/^FB_/.test(f.type) || f.type === "FB_TR").map(f => kv(f.type, h("span", null, f.label, f.paras.length ? h("small", null, f.paras.join(" · ")) : null))));
  const fs = C.findings.filter(f => f.ref && (f.ref.pin === p.uid || f.ref.node === p.nodeId));
  if (fs.length) { b.appendChild(h("h4", null, "Befunde")); const c = h("div", { class: "card tight" }); fs.forEach(f => c.appendChild(findingRow(C, f, true))); b.appendChild(c); }
  extra(X => X.order >= 50);
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


/* ---------- Globale Suche: Klemmen ---------- */
SEARCH.add({
  id: "klemmen", label: "Klemmen", order: 10,
  index: C => C.pins.map(p => [p, norm(p.klemme + " " + p.name + " " + p.paraText)]),
  hit: (C, p) => ({ a: p.klemme, n: p.name || p.paraText || "–", w: p.kind, go: () => openPin(C.cid, p.uid) })
});
