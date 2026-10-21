import { go, openNode, openPin } from "../core/nav.js";
import { APP, curC, vstate } from "../core/state.js";
import { on } from "../core/events.js";
import { liveAddrText, liveConnected, liveInfo, liveOfAddr, livePinText, wantLive } from "../core/live.js";
import { paraAddr, pinAddr, restAddr } from "../core/addr.js";
import { SEARCH, VIEWS } from "../core/ext.js";
import { copyText, esc, h, natCmp, norm, s, trunc, uniq } from "../core/util.js";
import { FB_TYPES, FUNC_NAMES, KIND_INFO, TYPE_NAMES, describeTransform, dictFor, edgeLabel, edgesIn, edgesOut, isInvertedEdge, isOutputKind, nodePlace, nodeTitle, pe, portLabel, pv, roleFromText, roleOf, stateTextsOf, valText } from "../model/model.js";
import { foVal, paraOf, schedText } from "../model/d4pml.js";
import { SEV } from "../model/findings.js";
import { btn, chk, emptyState, hideTip, icon, kindTag, pageHead, renderAll, sevIcon, showTip, stationSub, toast } from "../shell/shell.js";
import { pinValue } from "./points.js";
import { findingRow, weekGrid } from "./findings-sched.js";

/* =========================================================================
   Ansicht: Programm (Plan) & Wirkkette
   ========================================================================= */
/* ---------- Live-Werte ----------
   Ist eine Live-Quelle verbunden (K&P direkt, BACnet), zeigen Plan, Wirkkette,
   Diagnose und Details deren Werte (markiert), sonst die Werte der Sicherung.
   Angezeigte Adressen werden bei der Quelle angefordert; neue Werte → neu zeichnen. */
const WANTQ = { cid: null, set: new Set(), t: null };
function queueWant(cid, a) {
  if (!a) return;
  if (WANTQ.cid !== cid) { WANTQ.cid = cid; WANTQ.set = new Set(); }
  WANTQ.set.add(a);
  if (!WANTQ.t) WANTQ.t = setTimeout(() => { WANTQ.t = null; const l = [...WANTQ.set]; WANTQ.set = new Set(); wantLive(WANTQ.cid, l); }, 0);
}
/* Live-Text zu einer Adresse ({ t, cls, ok }) oder null */
function lvAddr(C, a) {
  if (!a) return null;
  if (liveConnected(C.cid)) queueWant(C.cid, a);
  const o = liveOfAddr(C.cid, a);
  return o ? liveAddrText(o) : null;
}
const lvPara = (C, n, sub, para) => lvAddr(C, paraAddr(n, sub, para));
/* Klemme: Wert je Baustein (BACnet oder K&P-Klemmenliste), sonst über die Adresse */
function lvPin(C, p) {
  const byAddr = lvAddr(C, pinAddr(C, p));
  return livePinText(C, p) || byAddr;
}
/* Live-Werte neu zeichnen – nicht während Ziehen oder Tippen */
let liveRedraw = null, pointerDown = false;
window.addEventListener("pointerdown", () => { pointerDown = true; }, true);
window.addEventListener("pointerup", () => { pointerDown = false; }, true);
function redrawSoon(ms) {
  clearTimeout(liveRedraw);
  liveRedraw = setTimeout(() => {
    if (APP.view !== "program") return;
    const ae = document.activeElement, content = document.getElementById("content");
    if (pointerDown || (ae && content && content.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) return redrawSoon(1000);
    renderAll();
  }, ms == null ? 150 : ms);
}
on("live", ({ cid }) => { const C = curC(); if (APP.view === "program" && C && C.cid === cid) redrawSoon(); });

const PG = { NODE_W: 216, HEAD: 34, PORT_H: 16, GX: 70, GY: 18, GPAD: 18, GHEAD: 34, COLGAP: 110, GROWGAP: 40,
             CW: 360, CHEAD: 38, CROW: 15, CGX: 96, CGY: 20 };

function isSysNode(n) { return String(n.type).startsWith("SY_") || n.type === "SYS"; }
function groupLabel(C, g) {
  if (g.isPinGroup) return C.format === "DDC3000" ? "Klemmen Grundgerät" : "Klemmen Modul " + g.mod;
  if (C.format === "DDC3000") return g.groupName ? g.plantName + " · " + g.groupName : g.plantName;
  return g.groupName || ("Gruppe " + g.group);
}
export function groupIsSystem(C, g) { return g.groupType === "GR_System" || (g.nodes.length && g.nodes.every(id => isSysNode(C.nodes.get(id)))); }

/* Baum: Anlagen › Gruppen */
function programTree(C) {
  const plants = new Map();
  for (const g of C.groups.values()) {
    if (!g.nodes.length) continue;
    let pk, pl, kind;
    if (g.foreign) { pk = "foreign"; pl = "Fremde Zentralen"; kind = 4; }
    else if (g.isPinGroup) { pk = "pins"; pl = "Klemmen"; kind = 1; }
    else if (groupIsSystem(C, g)) { pk = "sys"; pl = "System"; kind = 3; }
    else if (C.format === "DDC3000") { pk = g.key === "0/logik" ? "d3logik" : "d3:" + g.key; pl = g.key === "0/logik" ? "Grundgerät" : g.plantName; kind = 2; }
    else { pk = g.mod + "/" + g.plant; pl = (g.plantName || "Anlage " + g.plant) + (g.mod !== "000" ? " · Modul " + g.mod : ""); kind = 2; }
    if (!plants.has(pk)) plants.set(pk, { key: pk, label: pl, kind, groups: [] });
    plants.get(pk).groups.push(g);
  }
  const list = [...plants.values()];
  list.forEach(p => p.groups.sort((a, b) => natCmp(a.key, b.key)));
  list.sort((a, b) => a.kind - b.kind || natCmp(a.groups[0].key, b.groups[0].key));
  return list;
}

function defaultVis(C) {
  const tree = programTree(C);
  const real = tree.filter(p => p.kind === 2);
  const total = real.reduce((s, p) => s + p.groups.reduce((t, g) => t + g.nodes.length, 0), 0);
  if (total <= 140) return new Set(real.flatMap(p => p.groups.map(g => g.key)));
  return new Set(real.length ? real[0].groups.map(g => g.key) : []);
}

VIEWS.add({
  id: "program", label: "Programm & Wirkkette", icon: "flow", group: 1, order: 130,
  needsC: true,
  compact: true,
  render(root, C, opts) {
    const S = vstate("program", C, () => ({ vis: defaultVis(C), sel: null, mode: "plan", chain: null, view: null, cview: null, labels: false, orphans: false, withPins: true,
      open: new Set(programTree(C).filter(p => p.kind === 2).slice(0, 3).map(p => p.key)), tab: "detail", allRows: false, pos: new Map(), q: "" }));
    let center = null;
    if (opts.node && C.nodes.has(opts.node)) {
      const n = C.nodes.get(opts.node);
      S.sel = n.id; center = n.id;
      if (opts.chain) { S.mode = "chain"; S.chain = { target: n.id, dir: opts.chain }; S.cview = null; S.tab = "diag"; }
      else {
        S.mode = "plan";
        if (!S.vis.has(n.gKey) && !(n.isPin && opts.add)) { if (opts.add) S.vis.add(n.gKey); else S.vis = new Set([n.gKey]); S.view = null; }
        const pk = programTree(C).find(p => p.groups.some(g => g.key === n.gKey)); if (pk) S.open.add(pk.key);
      }
    }
    root.appendChild(pageHead("Programm & Wirkkette", stationSub(C), [
      h("div", { class: "seg" },
        h("button", { class: S.mode === "plan" ? "on" : "", onclick: () => { S.mode = "plan"; renderAll(); } }, icon("flow"), "Plan"),
        h("button", { class: S.mode === "chain" ? "on" : "", onclick: () => { if (!S.chain) { if (!S.sel) return toast("Erst einen Baustein auswählen – dann zeigt die Wirkkette, wovon er abhängt oder worauf er wirkt.", "inf"); S.chain = { target: S.sel, dir: "up" }; } S.mode = "chain"; S.tab = "diag"; renderAll(); } }, icon("target"), "Wirkkette"))]));
    const body = h("div", { class: "page-body flush" });
    root.appendChild(body);
    const split = h("div", { class: "split" });
    body.appendChild(split);

    /* ---- Baum ---- */
    const rail = h("div", { class: "rail", style: { width: "260px", padding: "0" } });
    split.appendChild(rail);
    const treeBox = h("div", { class: "tree" });
    const tq = h("input", { type: "search", placeholder: "Gruppe filtern …", value: S.q });
    tq.addEventListener("input", () => { S.q = tq.value; drawTree(); });
    rail.appendChild(h("div", { style: { padding: "10px 10px 4px", position: "sticky", top: 0, background: "var(--layer)", zIndex: 2 } },
      h("div", { class: "tbox", style: { width: "100%" } }, icon("search"), tq),
      h("div", { class: "row", style: { marginTop: "8px", gap: "4px" } },
        btn("Alle", null, () => { S.vis = new Set(programTree(C).filter(p => p.kind === 2).flatMap(p => p.groups.map(g => g.key))); S.view = null; S.mode = "plan"; renderAll(); }, "sm", "Alle Anlagen zeigen (ohne System)"),
        btn("Keine", null, () => { S.vis = new Set(); S.mode = "plan"; renderAll(); }, "sm"),
        h("span", { class: "grow" }),
        h("span", { class: "small muted" }, S.vis.size + " sichtbar"))));
    rail.appendChild(treeBox);
    function drawTree() {
      treeBox.innerHTML = "";
      const q = norm(S.q);
      for (const P of programTree(C)) {
        const gs = P.groups.filter(g => !q || norm(P.label + " " + groupLabel(C, g) + " " + g.key).includes(q));
        if (!gs.length) continue;
        const open = S.open.has(P.key) || !!q;
        const allVis = gs.every(g => S.vis.has(g.key)), anyVis = gs.some(g => S.vis.has(g.key));
        const pSev = maxSev(gs.flatMap(g => g.nodes.map(id => C.nodeSev.get(id))));
        const row = h("div", { class: "tree-row" + (open ? " open" : "") },
          h("span", { class: "tw", onclick: e => { e.stopPropagation(); open ? S.open.delete(P.key) : S.open.add(P.key); drawTree(); } }, icon("chev")),
          h("span", { class: "lbl", style: { fontWeight: 600 }, title: P.label, onclick: () => { S.vis = new Set(gs.map(g => g.key)); S.mode = "plan"; S.view = null; S.open.add(P.key); renderAll(); } }, P.label),
          pSev ? h("span", { class: "sevdot " + pSev }) : null,
          h("span", { class: "cnt" }, gs.reduce((s, g) => s + g.nodes.length, 0)),
          h("span", { class: "vis" + (anyVis ? " on" : ""), title: allVis ? "ausblenden" : "einblenden", onclick: e => { e.stopPropagation(); gs.forEach(g => allVis ? S.vis.delete(g.key) : S.vis.add(g.key)); S.mode = "plan"; S.view = null; renderAll(); } }, icon(anyVis ? "eye" : "eyeoff")));
        treeBox.appendChild(row);
        if (!open) continue;
        const kidsBox = h("div", { class: "tree-kids" });
        for (const g of gs) {
          const vis = S.vis.has(g.key);
          const gSev = maxSev(g.nodes.map(id => C.nodeSev.get(id)));
          kidsBox.appendChild(h("div", { class: "tree-row" + (vis && S.vis.size === 1 ? " on" : ""), title: g.key },
            h("span", { class: "lbl", onclick: () => { S.vis = new Set([g.key]); S.mode = "plan"; S.view = null; renderAll(); } }, groupLabel(C, g), g.ghostGroup ? h("span", { class: "faint" }, " (fehlt)") : null),
            gSev ? h("span", { class: "sevdot " + gSev }) : null,
            h("span", { class: "cnt" }, g.nodes.length),
            h("span", { class: "vis" + (vis ? " on" : ""), onclick: e => { e.stopPropagation(); vis ? S.vis.delete(g.key) : S.vis.add(g.key); S.mode = "plan"; S.view = null; renderAll(); } }, icon(vis ? "eye" : "eyeoff"))));
        }
        treeBox.appendChild(kidsBox);
      }
    }
    drawTree();

    /* ---- Leinwand ---- */
    const mid = h("div", { class: "center" });
    split.appendChild(mid);
    const canvas = h("div", { class: "canvas" });
    mid.appendChild(canvas);
    const svg = s("svg", { class: "stage" });
    canvas.appendChild(svg);
    const defs = s("defs", null, svg);
    const mk = (id, cls) => { const m = s("marker", { id, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, defs); s("path", { d: "M0,1 L9,5 L0,9 z", class: cls }, m); };
    mk("ahN", "ah");
    const world = s("g", null, svg);
    const panel = h("div", { class: "drawer", style: { width: "400px", position: "relative" } });
    split.appendChild(panel);

    const viewKey = S.mode === "chain" ? "cview" : "view";
    const V = { x: 0, y: 0, k: 1 };
    const apply = () => { world.setAttribute("transform", `translate(${V.x},${V.y}) scale(${V.k})`); S[viewKey] = { x: V.x, y: V.y, k: V.k }; };
    let L = null;   // aktuelles Layout {boxes: Map, w, h}

    /* Zoom & Pan */
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const k = Math.min(2.5, Math.max(0.08, V.k * f));
      V.x = mx - (mx - V.x) * k / V.k; V.y = my - (my - V.y) * k / V.k; V.k = k; apply();
    }, { passive: false });
    let pan = null;
    canvas.addEventListener("mousedown", e => {
      if (e.button !== 0 || e.target.closest(".nd,.card-c,.ehit,.overlay-tl,.zoom")) return;
      pan = { sx: e.clientX, sy: e.clientY, ox: V.x, oy: V.y, moved: false }; canvas.classList.add("panning");
    });
    const onMove = e => {
      if (!pan) return;
      const dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
      V.x = pan.ox + dx; V.y = pan.oy + dy; apply();
    };
    const onUp = () => { if (pan && !pan.moved && S.mode === "plan" && S.sel) { S.sel = null; highlight(); drawPanel(); } pan = null; canvas.classList.remove("panning"); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    const cleanup = new MutationObserver(() => { if (!document.body.contains(canvas)) { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); cleanup.disconnect(); } });
    cleanup.observe(document.body, { childList: true, subtree: true });

    function fit() {
      if (!L) return;
      const r = canvas.getBoundingClientRect();
      const kFit = Math.min((r.width - 60) / Math.max(L.w, 1), (r.height - 100) / Math.max(L.h, 1));
      const k = Math.min(1.1, Math.max(0.55, kFit));
      V.k = k;
      V.x = L.w * k <= r.width - 40 ? (r.width - L.w * k) / 2 : 24;
      V.y = L.h * k <= r.height - 90 ? Math.max(70, (r.height - L.h * k) / 2 + 24) : 76;
      apply();
    }
    function centerOn(id) {
      const b = L && L.boxes.get(id); if (!b) return;
      const r = canvas.getBoundingClientRect();
      if (V.k < 0.6) V.k = 0.85;
      V.x = r.width / 2 - (b.x + b.w / 2) * V.k; V.y = r.height / 2 - (b.y + Math.min(b.h, 200) / 2) * V.k; apply();
    }
    canvas.appendChild(h("div", { class: "zoom" },
      btn(null, "zin", () => { zoomBy(1.25); }, "subtle sm", "Vergrößern"),
      btn(null, "zout", () => { zoomBy(0.8); }, "subtle sm", "Verkleinern"),
      btn(null, "fit", fit, "subtle sm", "Alles einpassen")));
    function zoomBy(f) { const r = canvas.getBoundingClientRect(); const k = Math.min(2.5, Math.max(0.08, V.k * f)); V.x = r.width / 2 - (r.width / 2 - V.x) * k / V.k; V.y = r.height / 2 - (r.height / 2 - V.y) * k / V.k; V.k = k; apply(); }

    /* ================= PLAN ================= */
    function buildPlan() {
      world.innerHTML = "";
      const vis = new Set();
      for (const gk of S.vis) { const g = C.groups.get(gk); if (g) g.nodes.forEach(id => vis.add(id)); }
      for (const id of [...vis]) {
        const n = C.nodes.get(id);
        if (!n) { vis.delete(id); continue; }
        const g = C.groups.get(n.gKey);
        if (isSysNode(n) && !(g && groupIsSystem(C, g))) vis.delete(id);
        else if (n.isPin && n.pin && n.pin.kind === "frei" && !edgesIn(C, id).length && !edgesOut(C, id).length) vis.delete(id);
        else if (S.orphans && !edgesIn(C, id).length && !edgesOut(C, id).length) vis.delete(id);
      }
      if (S.withPins) {
        const extra = [];
        for (const id of vis) {
          for (const e of edgesIn(C, id)) { const n = C.nodes.get(e.from); if (n && n.isPin && !vis.has(n.id)) extra.push(n.id); }
          for (const e of edgesOut(C, id)) { const n = C.nodes.get(e.to); if (n && n.isPin && !vis.has(n.id)) extra.push(n.id); }
        }
        extra.forEach(id => vis.add(id));
      }
      if (!vis.size) { L = null; return false; }
      /* Gruppen ordnen */
      const gNodes = new Map();
      for (const id of vis) { const n = C.nodes.get(id); if (!gNodes.has(n.gKey)) gNodes.set(n.gKey, []); gNodes.get(n.gKey).push(n); }
      const gKeys = [...gNodes.keys()];
      const deps = new Map(gKeys.map(k => [k, new Set()]));
      for (const id of vis) for (const e of edgesIn(C, id)) {
        if (!vis.has(e.from)) continue;
        const a = C.nodes.get(e.from).gKey, b = C.nodes.get(id).gKey;
        if (a !== b) deps.get(b).add(a);
      }
      const isPinG = k => { const g = C.groups.get(k); return g && g.isPinGroup; };
      const outputsOnly = k => gNodes.get(k).every(n => n.pin && isOutputKind(n.pin.kind));
      const rank = new Map(gKeys.map(k => [k, isPinG(k) ? 0 : 1]));
      for (let it = 0; it < 14; it++) {
        let ch = false;
        for (const k of gKeys) {
          if (isPinG(k)) continue;
          let r = 1;
          for (const d of deps.get(k)) if (d !== k && !(isPinG(d) && outputsOnly(d))) r = Math.max(r, (rank.get(d) || 0) + 1);
          r = Math.min(r, 8);
          if (r !== rank.get(k)) { rank.set(k, r); ch = true; }
        }
        if (!ch) break;
      }
      /* Klemmen-Gruppen: Eingänge links, Ausgänge rechts */
      const maxR = Math.max(1, ...gKeys.map(k => rank.get(k)));
      const finalGroups = [];
      for (const k of gKeys) {
        if (isPinG(k)) {
          const ins = gNodes.get(k).filter(n => !(n.pin && isOutputKind(n.pin.kind)));
          const outs = gNodes.get(k).filter(n => n.pin && isOutputKind(n.pin.kind));
          if (ins.length) finalGroups.push({ key: k, sub: "in", nodes: ins, rank: 0 });
          if (outs.length) finalGroups.push({ key: k, sub: "out", nodes: outs, rank: maxR + 1 });
        } else finalGroups.push({ key: k, sub: "", nodes: gNodes.get(k), rank: rank.get(k) });
      }
      /* Knoten innerhalb der Gruppe in Spalten */
      const boxes = new Map();
      const lay = [];
      for (const G of finalGroups) {
        const ids = new Set(G.nodes.map(n => n.id));
        const lr = new Map(G.nodes.map(n => [n.id, 0]));
        for (let it = 0; it < 10; it++) {
          let ch = false;
          for (const n of G.nodes) {
            let r = 0;
            for (const e of edgesIn(C, n.id)) if (ids.has(e.from) && e.from !== n.id) r = Math.max(r, lr.get(e.from) + 1);
            r = Math.min(r, 5);
            if (r !== lr.get(n.id)) { lr.set(n.id, r); ch = true; }
          }
          if (!ch) break;
        }
        const cols = [];
        for (const n of G.nodes) { const r = lr.get(n.id); (cols[r] = cols[r] || []).push(n); }
        const colsF = cols.filter(Boolean);
        colsF.forEach(col => col.sort((a, b) => natCmp(a.addr, b.addr)));
        /* Pin-Spalten umbrechen, wenn sehr lang */
        const finalCols = [];
        const MAXC = G.sub ? 18 : 12;
        for (const col of colsF) { if (col.length > MAXC) { const k = Math.ceil(col.length / MAXC); const per = Math.ceil(col.length / k); for (let i = 0; i < col.length; i += per) finalCols.push(col.slice(i, i + per)); } else finalCols.push(col); }
        let gx = PG.GPAD, gh = 0;
        for (const col of finalCols) {
          let y = PG.GHEAD;
          for (const n of col) {
            const b = nodeBox(n, vis);
            b.rx = gx; b.ry = y; y += b.h + PG.GY;
            boxes.set(n.id, b);
          }
          gh = Math.max(gh, y);
          gx += PG.NODE_W + PG.GX;
        }
        G.w = Math.max(240, gx - PG.GX + PG.GPAD); G.h = gh + PG.GPAD - PG.GY + 4; G.cols = finalCols;
        lay.push(G);
      }
      /* Gruppen in Spalten nach Rang */
      const byRank = new Map();
      for (const G of lay) { if (!byRank.has(G.rank)) byRank.set(G.rank, []); byRank.get(G.rank).push(G); }
      const ranks = [...byRank.keys()].sort((a, b) => a - b);
      let x = 0, H = 0;
      for (const r of ranks) {
        const list = byRank.get(r).sort((a, b) => natCmp(a.key, b.key));
        let y = 0, w = 0;
        for (const G of list) { G.x = x; G.y = y; y += G.h + PG.GROWGAP; w = Math.max(w, G.w); }
        H = Math.max(H, y); x += w + PG.COLGAP;
      }
      for (const G of lay) for (const col of G.cols) for (const n of col) { const b = boxes.get(n.id); b.x = G.x + b.rx; b.y = G.y + b.ry; const p = S.pos.get(n.id); if (p) { b.x = p.x; b.y = p.y; } }
      L = { boxes, groups: lay, w: Math.max(400, x - PG.COLGAP), h: Math.max(200, H - PG.GROWGAP), vis };
      drawPlan();
      return true;
    }
    function nodeBox(n, vis) {
      const inc = edgesIn(C, n.id);
      const ports = [], seen = new Set();
      for (const e of inc) {
        const k = (e.toSub ? e.toSub + "/" : "") + e.toPara;
        if (seen.has(k)) { const pp = ports.find(x => x.key === k); pp.edges.push(e); continue; }
        seen.add(k); ports.push({ key: k, para: e.toPara, sub: e.toSub || "", edges: [e] });
      }
      ports.sort((a, b) => natCmp(a.para, b.para));
      const nameH = n.name ? 16 : 0, fH = n.formula ? 16 : 0;
      const top = PG.HEAD + nameH + fH;
      ports.forEach((p, i) => { p.y = top + i * PG.PORT_H + PG.PORT_H / 2 + 2; });
      const hgt = Math.max(46, top + ports.length * PG.PORT_H + 8);
      return { id: n.id, w: PG.NODE_W, h: hgt, ports, outY: 17, nameH, fH };
    }
    function edgeD(a, b, y2) {
      const x1 = a.x + a.w, y1 = a.y + a.outY, x2 = b.x;
      const dx = Math.max(Math.abs(x2 - x1) * 0.45, 46);
      return `M ${x1},${y1} C ${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    }
    let edgeEls = [], nodeEls = new Map();
    function drawPlan() {
      world.innerHTML = ""; edgeEls = []; nodeEls = new Map();
      const gl = s("g", null, world), el = s("g", null, world), nl = s("g", null, world);
      for (const G of L.groups) {
        const g = C.groups.get(G.key);
        s("rect", { x: G.x, y: G.y, width: G.w, height: G.h, rx: 8, class: "g-frame" + (g.isPinGroup ? " pins" : "") }, gl);
        const t = s("text", { x: G.x + 12, y: G.y + 21, class: "g-title" }, gl);
        t.textContent = trunc(groupLabel(C, g) + (G.sub === "in" ? " · Eingänge" : G.sub === "out" ? " · Ausgänge" : ""), Math.floor(G.w / 7));
        if (C.format !== "DDC3000" && !g.isPinGroup) { const st = s("text", { x: G.x + G.w - 12, y: G.y + 21, class: "g-sub", "text-anchor": "end" }, gl); st.textContent = (g.plantName ? trunc(g.plantName, 30) + " · " : "") + g.key; }
      }
      for (const n of L.vis) {
        for (const e of edgesIn(C, n)) {
          const a = L.boxes.get(e.from), b = L.boxes.get(e.to);
          if (!a || !b) continue;
          const port = b.ports.find(p => p.para === e.toPara && p.sub === (e.toSub || ""));
          const y2 = b.y + (port ? port.y : b.h / 2);
          const d = edgeD(a, b, y2);
          const tn = C.nodes.get(e.to);
          const role = roleOf(tn.type, e.toPara, (tn.paras.find(p => p.addr === e.toPara) || { texts: [] }).texts[0]);
          const cls = "e" + (isInvertedEdge(e) ? " inv" : role === "release" ? " gate" : role === "block" ? " blk" : "");
          const p = s("path", { d, class: cls, "marker-end": "url(#ahN)" }, el);
          const hit = s("path", { d, class: "ehit" }, el);
          hit.addEventListener("mousemove", ev => showTip(ev, edgeTipHtml(e)));
          hit.addEventListener("mouseleave", hideTip);
          hit.addEventListener("click", () => selectNode(e.from === S.sel ? e.to : e.from, true));
          edgeEls.push({ e, p, hit });
          if (S.labels && (e.fromRest || e.transform)) {
            const t = s("text", { x: b.x - 6, y: y2 - 3, class: "elbl", "text-anchor": "end" }, el);
            t.textContent = trunc((e.fromRest ? "/" + e.fromRest : "") + (isInvertedEdge(e) ? " INV" : ""), 22);
          }
        }
      }
      for (const [id, b] of L.boxes) {
        const n = C.nodes.get(id);
        const g = drawNode(n, b, nl);
        nodeEls.set(id, g);
      }
      highlight();
    }
    function drawNode(n, b, parent) {
      const pin = n.pin;
      const g = s("g", { class: "nd" + (n.isPin ? " pin " + (pin ? pin.kind : "") : "") + (n.ghost ? " ghost" : ""), transform: `translate(${b.x},${b.y})`, "data-id": n.id }, parent);
      s("rect", { class: "b", width: b.w, height: b.h, rx: 6 }, g);
      const hd = s("rect", { class: "hd", width: b.w - 2, height: PG.HEAD - 4, x: 1, y: 1, rx: 5 }, g);
      void hd;
      const ad = s("text", { x: 10, y: 15, class: "ad" }, g); ad.textContent = trunc(n.addr + (n.ghost ? " ⌁" : ""), 18);
      const ty = s("text", { x: 10, y: 28, class: "ty" }, g);
      ty.textContent = trunc(n.isPin && pin ? (KIND_INFO[pin.kind] || {}).name + (pin.subType && C.format !== "DDC3000" ? " · " + pin.subType : "") : (TYPE_NAMES[n.type] || n.type), 34);
      if (n.isPin && pin) {
        const lv = lvPin(C, pin);
        const v = lv ? lv.t : pin.value.invalid ? "ungültig" : pinValue(pin);
        if (v) { const tv = s("text", { x: b.w - 10, y: 15, class: "pv" + (lv ? " lv" + (lv.ok === false ? " bad" : "") : pin.value.invalid ? " bad" : ""), "text-anchor": "end" }, g); tv.textContent = trunc(v, 14); }
      }
      let y = PG.HEAD;
      if (n.name) { const t = s("text", { x: 10, y: y + 10, class: "nm" }, g); t.textContent = trunc(n.name, 32); y += 16; }
      if (n.formula) { const t = s("text", { x: 10, y: y + 10, class: "fx" }, g); t.textContent = trunc(n.formula, 34); y += 16; }
      for (const p of b.ports) {
        s("circle", { cx: 0, cy: p.y, r: 3.2, class: "port" }, g);
        const ext = p.edges.filter(e => !L.boxes.has(e.from));
        const t = s("text", { x: 10, y: p.y + 4, class: "pt" + (ext.length ? " ext" : "") }, g);
        const lbl = portLabel(n.type, p.para) + (p.sub && C.format !== "DDC3000" ? " [" + p.sub.replace(/\.\d+$/, "") + "]" : "");
        t.textContent = trunc(lbl + (ext.length ? " ◄ " + (C.nodes.get(ext[0].from) || {}).addr + (ext.length > 1 ? " +" + (ext.length - 1) : "") : ""), 34);
        if (ext.length) {
          t.style.cursor = "pointer";
          t.addEventListener("click", ev => { ev.stopPropagation(); focusNode(ext[0].from); });
          t.addEventListener("mousemove", ev => showTip(ev, ext.map(e => edgeTipHtml(e)).join("<hr style='border:0;border-top:1px solid var(--stroke)'>")));
          t.addEventListener("mouseleave", hideTip);
        }
      }
      if (edgesOut(C, n.id).length) s("circle", { cx: b.w, cy: b.outY, r: 3.4, class: "out port" }, g);
      const sev = C.nodeSev.get(n.id);
      if (sev) s("circle", { cx: b.w - 2, cy: 2, r: 5, class: "sevmark " + sev }, g);
      /* Ziehen / Klicken */
      let drag = null;
      g.addEventListener("mousedown", ev => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        drag = { sx: ev.clientX, sy: ev.clientY, ox: b.x, oy: b.y, moved: false };
        const mv = m => {
          const dx = (m.clientX - drag.sx) / V.k, dy = (m.clientY - drag.sy) / V.k;
          if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4 / V.k) return;
          drag.moved = true; b.x = drag.ox + dx; b.y = drag.oy + dy;
          g.setAttribute("transform", `translate(${b.x},${b.y})`);
          redrawEdges();
        };
        const up = () => {
          window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up);
          if (drag.moved) S.pos.set(n.id, { x: b.x, y: b.y }); else selectNode(n.id, false);
          drag = null;
        };
        window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
      });
      g.addEventListener("dblclick", ev => { ev.stopPropagation(); startChain(n.id, n.pin && !isOutputKind(n.pin.kind) ? "down" : "up"); });
      return g;
    }
    function redrawEdges() {
      for (const x of edgeEls) {
        const a = L.boxes.get(x.e.from), b = L.boxes.get(x.e.to);
        const port = b.ports.find(p => p.para === x.e.toPara && p.sub === (x.e.toSub || ""));
        const d = edgeD(a, b, b.y + (port ? port.y : b.h / 2));
        x.p.setAttribute("d", d); x.hit.setAttribute("d", d);
      }
    }
    function highlight() {
      if (S.mode !== "plan") return;
      const sel = S.sel && L && L.boxes.has(S.sel) ? S.sel : null;
      const near = new Set();
      if (sel) { near.add(sel); edgesIn(C, sel).forEach(e => near.add(e.from)); edgesOut(C, sel).forEach(e => near.add(e.to)); }
      for (const [id, g] of nodeEls) {
        g.classList.toggle("sel", id === sel);
        g.classList.toggle("dim", !!sel && !near.has(id));
      }
      for (const x of edgeEls) {
        x.p.classList.remove("up", "down", "dim");
        if (!sel) continue;
        if (x.e.to === sel) x.p.classList.add("up");
        else if (x.e.from === sel) x.p.classList.add("down");
        else x.p.classList.add("dim");
      }
    }
    function selectNode(id, centerIt) {
      S.sel = id;
      if (S.mode === "plan") highlight(); else markChain();
      drawPanel();
      if (centerIt) centerOn(id);
    }
    function focusNode(id) {
      const n = C.nodes.get(id); if (!n) return;
      if (S.mode === "chain") {
        if (L && L.boxes.has(id)) return selectNode(id, true);
        S.sel = id; S.mode = "plan";
      }
      if (L && L.boxes.has(id)) return selectNode(id, true);
      if (n.isPin) { S.sel = id; highlight(); drawPanel(); return; }
      go("program", { node: id, add: true });
    }
    function startChain(id, dir) { S.chain = { target: id, dir }; S.sel = id; S.mode = "chain"; S.cview = null; S.tab = "diag"; renderAll(); }

    /* ================= WIRKKETTE ================= */
    let CH = null;
    function buildChainLayout() {
      world.innerHTML = "";
      if (!S.chain || !C.nodes.has(S.chain.target)) { L = null; return false; }
      CH = buildChain(C, S.chain.target, S.chain.dir, 10, 140);
      const boxes = new Map();
      const maxL = CH.levels.length - 1;
      const colH = [];
      CH.levels.forEach((ids, lvl) => {
        let y = 50;
        for (const id of ids) {
          const n = C.nodes.get(id);
          const rows = cardRows(C, n, S.allRows, CH);
          const nameH = n.name ? 16 : 0, fH = n.formula ? 16 : 0;
          const hgt = PG.CHEAD + nameH + fH + rows.length * PG.CROW + 10;
          const x = (S.chain.dir === "up" ? (maxL - lvl) : lvl) * (PG.CW + PG.CGX);
          boxes.set(id, { id, rows, x, y, w: PG.CW, h: hgt, lvl, nameH, fH, outY: 17 });
          y += hgt + PG.CGY;
        }
        colH.push(y);
      });
      const H = Math.max(...colH);
      CH.levels.forEach((ids, lvl) => { const off = (H - colH[lvl]) / 2; ids.forEach(id => boxes.get(id).y += off); });
      L = { boxes, w: (maxL + 1) * (PG.CW + PG.CGX) - PG.CGX, h: H, vis: new Set(boxes.keys()) };
      drawChain(maxL);
      return true;
    }
    function rowY(b, ri) { return b.y + PG.CHEAD + b.nameH + b.fH + ri * PG.CROW + PG.CROW / 2 + 2; }
    function drawChain(maxL) {
      const ll = s("g", null, world), el = s("g", null, world), nl = s("g", null, world);
      edgeEls = []; nodeEls = new Map();
      for (let lvl = 0; lvl <= maxL; lvl++) {
        const x = (S.chain.dir === "up" ? (maxL - lvl) : lvl) * (PG.CW + PG.CGX);
        const t = s("text", { x, y: 26, class: "lvl" }, ll);
        t.textContent = lvl === 0 ? "★ ZIEL" : (S.chain.dir === "up" ? "QUELLEN · STUFE " : "WIRKUNG · STUFE ") + lvl;
      }
      for (const e of CH.edges) {
        const a = L.boxes.get(e.from), b = L.boxes.get(e.to);
        if (!a || !b) continue;
        const ri = b.rows.findIndex(r => !r.isOut && r.addr === e.toPara && (r.sub || "") === (e.toSub || ""));
        const y2 = ri >= 0 ? rowY(b, ri) : b.y + b.h / 2;
        const role = ri >= 0 ? b.rows[ri].role : "";
        const cls = "e" + (isInvertedEdge(e) ? " inv" : role === "release" ? " gate" : role === "block" ? " blk" : e.to === S.chain.target || e.from === S.chain.target ? " hot" : "");
        const d = edgeD(a, b, y2);
        const p = s("path", { d, class: cls, "marker-end": "url(#ahN)" }, el);
        const hit = s("path", { d, class: "ehit" }, el);
        hit.addEventListener("mousemove", ev => showTip(ev, edgeTipHtml(e)));
        hit.addEventListener("mouseleave", hideTip);
        edgeEls.push({ e, p, hit });
      }
      for (const [id, b] of L.boxes) {
        const n = C.nodes.get(id);
        const g = s("g", { class: "card-c nd" + (id === S.chain.target ? " target" : "") + (n.ghost ? " ghost" : "") + (n.isPin && n.pin ? " pin " + n.pin.kind : ""), transform: `translate(${b.x},${b.y})` }, nl);
        s("rect", { class: "b", width: b.w, height: b.h, rx: 6 }, g);
        s("rect", { class: "hd", width: b.w - 2, height: PG.CHEAD - 6, x: 1, y: 1, rx: 5 }, g);
        const ad = s("text", { x: 10, y: 16, class: "ad" }, g); ad.textContent = trunc(n.addr + (n.ghost ? " ⌁" : ""), 18);
        const ty = s("text", { x: b.w - 10, y: 16, class: "ty", "text-anchor": "end" }, g);
        ty.textContent = trunc((n.isPin && n.pin ? (KIND_INFO[n.pin.kind] || {}).name : (TYPE_NAMES[n.type] || n.type)), 30);
        const pl = s("text", { x: 10, y: 29, class: "ty" }, g); pl.textContent = trunc(nodePlace(C, n), 56);
        let y = PG.CHEAD;
        if (n.name) { const t = s("text", { x: 10, y: y + 10, class: "nm" }, g); t.textContent = trunc(n.name, 52); y += 16; }
        if (n.formula) { const t = s("text", { x: 10, y: y + 10, class: "fx" }, g); t.textContent = trunc(n.formula, 52); y += 16; }
        b.rows.forEach((r, i) => {
          const yy = rowY(b, i) - b.y;
          if (r.hot) s("rect", { x: 2, y: yy - PG.CROW / 2, width: b.w - 4, height: PG.CROW, class: "rowhl" }, g);
          const rr = s("text", { x: 10, y: yy + 3.5, class: "rr role-" + (r.role || "x") }, g); rr.textContent = ROLE_MARK[r.role] || "·";
          const lt = s("text", { x: 22, y: yy + 3.5, class: "rl" }, g);
          lt.textContent = trunc((r.isOut ? "▸ " : "") + r.addr + "  " + (r.label || ""), r.val ? 38 : 56);
          if (r.val) { const vt = s("text", { x: b.w - 10, y: yy + 3.5, class: "rv" + (r.live ? " lv" : ""), "text-anchor": "end" }, g); vt.textContent = trunc(r.val, 18); }
          if (!r.isOut) s("circle", { cx: 0, cy: yy, r: 2.6, class: "port" }, g);
        });
        if (edgesOut(C, id).length) s("circle", { cx: b.w, cy: b.outY, r: 3.4, class: "out port" }, g);
        const sev = C.nodeSev.get(id);
        if (sev) s("circle", { cx: b.w - 2, cy: 2, r: 5, class: "sevmark " + sev }, g);
        g.addEventListener("click", () => selectNode(id, false));
        g.addEventListener("dblclick", () => startChain(id, S.chain.dir));
        nodeEls.set(id, g);
      }
      markChain();
    }
    function markChain() { for (const [id, g] of nodeEls) g.classList.toggle("sel", id === S.sel && id !== (S.chain && S.chain.target)); }

    /* ---- Überlagerungen ---- */
    const ov = h("div", { class: "overlay-tl" });
    canvas.appendChild(ov);
    let ok;
    if (S.mode === "chain") {
      ok = buildChainLayout();
      if (ok) {
        const t = C.nodes.get(S.chain.target);
        ov.appendChild(h("div", { class: "chainbar" },
          btn(null, "left", () => { S.mode = "plan"; renderAll(); }, "subtle sm", "Zurück zum Plan"),
          h("div", null, h("b", null, "Wirkkette " + (S.chain.dir === "up" ? "← Ursachen" : "→ Wirkung") + ": " + t.addr), " ", h("span", { class: "m" }, trunc(t.name || TYPE_NAMES[t.type] || "", 40) + " · " + CH.nodes.size + " Bausteine · " + CH.edges.length + " Verknüpfungen" + (CH.cut ? " · gekürzt" : ""))),
          h("div", { class: "seg" },
            h("button", { class: S.chain.dir === "up" ? "on" : "", title: "Was beeinflusst diesen Baustein?", onclick: () => startChain(S.chain.target, "up") }, icon("left"), "Ursachen"),
            h("button", { class: S.chain.dir === "down" ? "on" : "", title: "Worauf wirkt dieser Baustein?", onclick: () => startChain(S.chain.target, "down") }, "Wirkung", icon("right"))),
          chk("alle Parameter", S.allRows, v => { S.allRows = v; renderAll(); })));
      }
    } else {
      ok = buildPlan();
      ov.appendChild(h("div", { class: "chainbar" },
        h("span", { class: "m" }, L ? L.vis.size + " Bausteine · Doppelklick öffnet die Wirkkette" : ""),
        chk("Klemmen einblenden", S.withPins, v => { S.withPins = v; S.view = null; renderAll(); }),
        chk("Ausgang-Beschriftung", S.labels, v => { S.labels = v; renderAll(); }),
        chk("Unverknüpfte ausblenden", S.orphans, v => { S.orphans = v; S.view = null; renderAll(); })));
    }
    if (!ok) canvas.appendChild(h("div", { style: { position: "absolute", inset: "70px 0 0 0" } }, emptyState("flow", S.mode === "chain" ? "Keine Wirkkette" : "Nichts eingeblendet", S.mode === "chain" ? "Baustein im Plan auswählen und „Wirkkette“ wählen." : "Links eine Anlage oder Gruppe anklicken.")));
    canvas.appendChild(h("div", { class: "note" }, h("span", null, "Ziehen = verschieben · Mausrad = zoomen · Linie: ", h("span", { style: { color: "var(--e-inv)" } }, "rot gestrichelt = invertiert"), " · ", h("span", { style: { color: "var(--e-gate)" } }, "grün = Freigabe"))));

    /* ---- Seitenleiste ---- */
    function drawPanel() {
      panel.innerHTML = "";
      const id = S.sel;
      const showDiag = S.mode === "chain" && CH;
      if (showDiag) {
        panel.appendChild(h("div", { class: "pivot", style: { padding: "0 12px" } },
          h("button", { class: S.tab === "diag" ? "on" : "", onclick: () => { S.tab = "diag"; drawPanel(); } }, icon("wrench"), "Diagnose"),
          h("button", { class: S.tab === "detail" ? "on" : "", onclick: () => { S.tab = "detail"; drawPanel(); } }, icon("info"), "Details")));
        if (S.tab === "diag") { panel.appendChild(checklist(C, CH, x => selectNode(x, true))); return; }
      }
      if (!id || !C.nodes.has(id)) { panel.hidden = !showDiag; if (showDiag) panel.appendChild(h("div", { class: "drawer-body" }, emptyState("flow", "Kein Baustein ausgewählt", "In der Kette einen Baustein anklicken."))); return; }
      panel.hidden = false;
      panel.appendChild(btn(null, "close", () => { S.sel = null; if (S.mode === "plan") highlight(); else markChain(); drawPanel(); }, "subtle sm", "Schließen")).style.cssText = "position:absolute;right:10px;top:" + (showDiag ? "54px" : "10px") + ";z-index:5";
      panel.appendChild(nodeDetail(C, C.nodes.get(id), {
        onJump: x => focusNode(x),
        onChain: (x, dir) => startChain(x, dir)
      }));
    }
    drawPanel();

    /* Ansicht wiederherstellen oder einpassen */
    requestAnimationFrame(() => {
      if (!L) return;
      const saved = S[viewKey];
      const r = canvas.getBoundingClientRect();
      if (S.mode === "chain" && !saved && S.chain) {
        const b = L.boxes.get(S.chain.target);
        V.k = Math.min(1, Math.max(0.85, Math.min((r.width - 60) / L.w, (r.height - 90) / L.h)));
        V.x = L.w * V.k <= r.width - 40 ? (r.width - L.w * V.k) / 2 : (S.chain.dir === "up" ? r.width - (b.x + b.w) * V.k - 40 : 40 - b.x * V.k);
        V.y = L.h * V.k <= r.height - 70 ? Math.max(56, (r.height - L.h * V.k) / 2 + 20) : r.height / 2 - (b.y + Math.min(b.h, 240) / 2) * V.k;
        apply();
      } else if (center && L.boxes.has(center)) { if (saved) Object.assign(V, saved); else fit(); centerOn(center); }
      else if (saved) { Object.assign(V, saved); apply(); }
      else fit();
    });
  }
});

const ROLE_MARK = { release: "▷", block: "⛔", hand: "✋", in: "◂", setpoint: "◎", threshold: "⊣", formula: "ƒ", param: "·", out: "▸", time: "⏱", info: "i" };
function maxSev(list) { let m = null; for (const x of list) if (x && (!m || SEV[x] > SEV[m])) m = x; return m; }
function edgeTipHtml(e) {
  const C = curC();
  const a = C.nodes.get(e.from), b = C.nodes.get(e.to);
  const st = stateTextsOf(a, e.fromRest);
  return `<b>${esc(a ? a.addr : "?")}${e.fromRest ? "/" + esc(e.fromRest) : ""}</b> ${esc(a && a.name ? "· " + a.name : "")}<br>→ <b>${esc(b ? b.addr : "?")}</b> · ${esc(portLabel(b ? b.type : "", e.toPara))}${e.toSub ? " [" + esc(e.toSub) + "]" : ""}` +
    (isInvertedEdge(e) ? `<br><span style="color:var(--err);font-weight:600">invertiert</span>` : e.transform ? `<br>Umformung: ${esc(describeTransform(e.transform, st))}` : "") +
    (e.op ? `<br>Verknüpfung: ${e.op.toUpperCase()}` : "") + (e.raw ? `<br><code>${esc(e.raw)}</code>` : "");
}

/* ---------- Kette aufbauen ---------- */
function buildChain(C, target, dir, maxDepth, maxNodes) {
  const lvlOf = new Map([[target, 0]]);
  const levels = [];
  let cur = [target], d = 0, cut = false;
  while (cur.length && d <= maxDepth) {
    levels.push(cur.slice());
    const next = [];
    for (const id of cur) {
      const list = dir === "up" ? edgesIn(C, id) : edgesOut(C, id);
      for (const e of list) {
        const far = dir === "up" ? e.from : e.to;
        if (lvlOf.has(far)) continue;
        if (lvlOf.size >= maxNodes) { cut = true; continue; }
        const fn = C.nodes.get(far);
        lvlOf.set(far, d + 1);
        if (!(fn && isSysNode(fn) && fn.type !== "SYS")) next.push(far);
      }
    }
    cur = next; d++;
    if (d > maxDepth && cur.length) cut = true;
  }
  const edges = C.edges.filter(e => lvlOf.has(e.from) && lvlOf.has(e.to) && (dir === "up" ? lvlOf.get(e.from) > lvlOf.get(e.to) : lvlOf.get(e.to) > lvlOf.get(e.from)));
  return { target, dir, levels, nodes: lvlOf, edges, cut };
}
function cardRows(C, n, showAll, CH) {
  const inc = edgesIn(C, n.id), outg = edgesOut(C, n.id);
  const all = n.paras.map(p => ({ p, sub: "" }));
  for (const sb of n.subObjs) for (const p of sb.paras) all.push({ p, sub: sb.addr });
  const rows = [];
  const IMPORTANT = new Set(["release", "block", "hand", "setpoint", "threshold", "formula", "out", "time"]);
  for (const { p, sub } of all) {
    const d = dictFor(n.type, p.addr);
    const label = p.texts[0] || (d ? d.n : "");
    const vals = p.values.filter(v => v.type !== "Source");
    const srcs = inc.filter(e => e.toPara === p.addr && (e.toSub || "") === sub);
    const role = d ? d.r : roleFromText(label);
    const v = p.act || vals[0];
    if (!showAll) {
      if (!srcs.length && !IMPORTANT.has(role)) continue;
      if (!srcs.length && !v && !p.schedules.length) continue;
    } else if (!label && !vals.length && !srcs.length && !p.schedules.length) continue;
    if (p.addr === "password") continue;
    const lv = lvPara(C, n, sub, p.addr);
    rows.push({ addr: p.addr, label: label || portLabel(n.type, p.addr), val: lv ? lv.t : v ? (v.deleted ? "–" : valText(v, p.stateTexts)) : "", live: !!lv, sub, role, srcs, hot: CH && srcs.some(e => CH.nodes.has(e.from)) });
  }
  for (const e of inc) if (!rows.some(r => r.addr === e.toPara && (r.sub || "") === (e.toSub || ""))) {
    const srcs = inc.filter(x => x.toPara === e.toPara && (x.toSub || "") === (e.toSub || ""));
    const lv = lvPara(C, n, e.toSub || "", e.toPara);
    rows.push({ addr: e.toPara, label: portLabel(n.type, e.toPara), val: lv ? lv.t : "", live: !!lv, sub: e.toSub || "", role: roleOf(n.type, e.toPara, "") || "in", srcs, hot: CH && srcs.some(x => CH.nodes.has(x.from)) });
  }
  if (n.isPin && n.pin) {
    const lv = lvPin(C, n.pin), v = lv ? lv.t : n.pin.value.invalid ? "ungültig" : pinValue(n.pin);
    if (v && !rows.some(r => r.val)) rows.push({ addr: isOutputKind(n.pin.kind) ? "Y" : "b", label: "Wert", val: v, live: !!lv, role: "info", srcs: [] });
  }
  const outs = new Set();
  for (const e of outg) {
    const k = e.fromRest || "";
    if (!k || outs.has(k) || rows.some(r => r.addr === k)) continue;
    outs.add(k);
    const d = dictFor(n.type, k);
    const p = n.paras.find(x => x.addr === k);
    const lv = lvAddr(C, restAddr(n, k));
    rows.push({ addr: k, label: (p && p.texts[0]) || (d ? d.n : ""), val: lv ? lv.t : p && pe(p) ? valText(pe(p), p.stateTexts) : "", live: !!lv, isOut: true, role: d ? d.r : "out", srcs: [] });
  }
  const order = { release: 0, block: 1, hand: 2, in: 3, setpoint: 4, threshold: 5, formula: 6, param: 7, time: 8, info: 9, "": 10, out: 11 };
  rows.sort((a, b) => (order[a.role] ?? 10) - (order[b.role] ?? 10) || natCmp(a.addr, b.addr));
  return rows;
}

/* ---------- Diagnose-Liste zur Kette ---------- */
function checklist(C, CH, onJump) {
  const items = [];
  const add = (prio, ic, html, why, jump) => items.push({ prio, ic, html, why, jump });
  const nb = id => { const n = C.nodes.get(id); return `<b>${esc(n.addr)}</b>${n.name ? " · " + esc(n.name) : ""}`; };
  for (const id of CH.nodes.keys()) {
    const n = C.nodes.get(id);
    const inc = edgesIn(C, id);
    const all = n.paras.map(p => ({ p, sub: "" }));
    for (const sb of n.subObjs) for (const p of sb.paras) all.push({ p, sub: sb.addr });
    for (const { p, sub } of all) {
      const d = dictFor(n.type, p.addr);
      const label = p.texts[0] || (d ? d.n : "");
      const role = d ? d.r : roleFromText(label);
      const src = inc.find(e => e.toPara === p.addr && (e.toSub || "") === sub);
      const v = pe(p);
      if (role === "hand") {
        const sn = src ? C.nodes.get(src.from) : null;
        const hp = sn ? paraOf(sn, src.fromRest || "h") : p;
        const hv = hp ? pe(hp) : null;
        const rawSt = hp && hp.stateTexts && Object.keys(hp.stateTexts).length ? hp.stateTexts : null;
        const isSel = !!((hv && hv.handPlant) || (rawSt && rawSt["9"] != null) || (!sn && (n.type === "H601" || n.type === "H901")));
        const off = !hv || hv.deleted || hv.text === "";
        const state = off ? "off" : isSel ? (hv.text === "9" ? "auto" : "active") : (n.type === "H613" || n.type === "H614") ? "active" : "plain";
        const hl = sn ? lvAddr(C, restAddr(sn, src.fromRest || "h")) : lvPara(C, n, sub, p.addr);
        const st = hl ? hl.t : off ? "nicht gesetzt" : valText(hv, rawSt || (isSel ? { "9": "Auto", "0": "Aus", "1": "Ein" } : null));
        add(state === "active" ? 1 : 4, "hand", `${nb(id)} · ${esc(label)} <code>${esc(p.addr)}</code> = <b${hl ? ' class="lv"' : ""}>${esc(st)}</b>`,
          { off: "Kein Handwert aktiv – die Regelung arbeitet.", auto: "Handebene steht auf Automatik.", active: "Handübersteuerung aktiv – hat Vorrang vor der Regelung. Auf Automatik prüfen.", plain: "Schalter ohne Automatik-Stellung – Stellung vor Ort prüfen." }[state], src ? src.from : id);
      }
      if (role === "release" && src) add(2, "gate", `${nb(id)} · ${esc(label)} ◄ ${esc(edgeLabel(C, src))}`, "Fehlt diese Freigabe, bleibt der Ausgang aus – unabhängig vom Bedarf.", src.from);
      if (role === "block" && src) add(2, "stop", `${nb(id)} · ${esc(label)} ◄ ${esc(edgeLabel(C, src))}`, "Sperre/Zwangsstellung – zwingt den Ausgang unabhängig vom Sollwert.", src.from);
      const lvS = (role === "setpoint" && !src) || p.addr === "5101" ? lvPara(C, n, sub, p.addr) : null;
      const code = (fb) => lvS ? `<code class="lv">${esc(lvS.t)}</code>` : `<code>${esc(fb)}</code>`;
      if (role === "setpoint" && (v || lvS) && !src) add(3, "target", `${nb(id)} · ${esc(label)} = ${code(v ? valText(v, p.stateTexts) : "")}`, lvS ? "Sollwert live aus der Zentrale. Eine Kompensation kann den wirksamen Sollwert verschieben." : "Sollwert laut Sicherung. Eine Kompensation kann den wirksamen Sollwert verschieben.", id);
      if (p.addr === "5101" && (v || lvS)) add(3, "target", `${nb(id)} · wirksamer Sollwert = ${code(v ? valText(v) : "")}`, "Liegt der Istwert darunter, ist ein geschlossenes Ventil richtig.", id);
    }
    if (n.formula && /\bm\b|\(m\)/.test(n.formula)) add(2, "lock", `${nb(id)} · Formel mit Selbsthaltung`, "„" + esc(n.formula) + "“ – bleibt stehen bis zur Rücksetzung/Quittierung.", id);
    if (n.formula && /NOT/.test(n.formula)) add(3, "swap", `${nb(id)} · Formel „${esc(n.formula)}“`, "Enthält eine Negation – Vorzeichen der Eingänge beachten.", id);
    if (n.isPin && n.pin) {
      const p = n.pin;
      const users = edgesOut(C, id).filter(e => CH.nodes.has(e.to)).map(e => C.nodes.get(e.to).addr);
      const lv = lvPin(C, p);
      const pvx = lv ? ' = <code class="lv">' + esc(lv.t) + "</code>" : pinValue(p) ? " = <code>" + esc(p.value.invalid ? "ungültig" : pinValue(p)) + "</code>" : "";
      add(p.value.invalid ? 1 : 4, "pin", `<b>${esc(p.klemme)}</b> · ${esc(p.name || p.kind)}${pvx}${users.length ? " → " + esc(uniq(users).join(", ")) : ""}`,
        p.value.invalid ? (isOutputKind(p.kind) ? "Ausgang meldet einen ungültigen Wert – Modul und Klemme prüfen." : "Fühler liefert keinen gültigen Wert – Anschluss und Fühler prüfen.") : isOutputKind(p.kind) ? "Hardware-Ausgang: Signal am Gerät messen." : "Hardware-Eingang: Messwert/Kontakt vor Ort gegenprüfen.", id);
    }
    if (n.type === "S118" || n.type === "N") add(3, "clock", `${nb(id)} · Zeitprogramm`, "Außerhalb der Nutzzeit gibt es keine Freigabe.", id);
    if (n.type === "S066") {
      const gw = pv(paraOf(n, "8610")), hy = pv(paraOf(n, "8612"));
      const lg = lvPara(C, n, "", "8610"), lh = lvPara(C, n, "", "8612");
      const cd = (l, x) => l ? `<code class="lv">${esc(l.t)}</code>` : `<code>${esc(valText(x))}</code>`;
      if (gw || lg) add(5, "sliders", `${nb(id)} · Grenzwert ${cd(lg, gw)}${hy || lh ? " / Hysterese " + cd(lh, hy) : ""}`, "Schaltschwelle in der Kette.", id);
    }
  }
  for (const e of CH.edges) if (isInvertedEdge(e)) add(3, "swap", `${nb(e.from)} → <b>${esc(C.nodes.get(e.to).addr)}</b> <code>invertiert</code>`, "Signal wird auf dem Weg umgekehrt.", e.from);
  const fs = C.findings.filter(f => f.sev !== "info" && f.ref && (CH.nodes.has(f.ref.node) || (f.ref.pin && CH.nodes.has(f.ref.pin)) || (f.ref.nodes || []).some(x => CH.nodes.has(x))));
  const box = h("div", { class: "drawer-body checklist" });
  box.appendChild(h("div", { class: "small muted", style: { margin: "12px 0 0" } }, CH.dir === "up" ? "Was kann diesen Baustein blockieren oder verstellen?" : "Worauf wirkt dieses Signal?"));
  const seen = new Set();
  const list = items.filter(it => { if (seen.has(it.html)) return false; seen.add(it.html); return true; }).sort((a, b) => a.prio - b.prio);
  const SEC = { 1: "Zuerst prüfen", 2: "Freigaben, Sperren, Selbsthaltung", 3: "Sollwerte, Zeit, Vorzeichen", 4: "Hardware und Handebenen", 5: "Schaltschwellen" };
  let last = null;
  for (const it of list) {
    if (it.prio !== last) { box.appendChild(h("div", { class: "sec" }, SEC[it.prio])); last = it.prio; }
    box.appendChild(h("div", { class: "it", onclick: () => onJump(it.jump) }, h("span", { class: "ic p" + it.prio }, icon(it.ic)), h("span", null, h("span", { html: it.html }), h("span", { class: "why" }, it.why))));
  }
  if (!list.length) box.appendChild(h("div", { class: "muted small", style: { marginTop: "12px" } }, "Keine Freigaben, Sperren oder Handebenen in dieser Kette."));
  if (fs.length) {
    box.appendChild(h("div", { class: "sec" }, "Befunde an Bausteinen dieser Kette"));
    for (const f of fs) box.appendChild(h("div", { class: "it", onclick: () => go("findings", { focus: f.id }) }, sevIcon(f.sev), h("span", null, f.title)));
  }
  box.appendChild(h("div", { class: "infobar inf", style: { marginTop: "16px" } }, icon("info"), h("div", { class: "small" }, liveNote(C))));
  return box;
}

function liveNote(C) {
  const L = liveInfo(C.cid);
  if (L || liveConnected(C.cid)) return h("span", null, h("span", { class: "lv" }, "Hervorgehobene Werte sind live"),
    " (" + (L ? L.label + (L.ip ? " · " + L.ip : "") + (L.stamp ? " · Stand " + L.stamp : "") : "verbunden") + "). Übrige Werte stammen aus der Sicherung. Mit ° markierte Bedeutungen sind aus der Dateistruktur abgeleitet.");
  return "Die Sicherung ist ein Parameter-Abbild, keine Live-Ansicht. Werte zeigen den Stand beim Sichern. Für Live-Werte im Reiter „K&P direkt“ oder „Online“ verbinden. Mit ° markierte Bedeutungen sind aus der Dateistruktur abgeleitet.";
}

/* ---------- Detailansicht eines Bausteins ---------- */
function nodeDetail(C, n, cb) {
  const frag = h("div");
  const pin = n.pin;
  frag.appendChild(h("div", { class: "drawer-head" },
    h("div", { class: "t" }, pin ? kindTag(pin.kind) : null, h("span", { class: "mono" }, n.addr), n.ghost ? h("span", { class: "pill warn" }, "nicht in der Sicherung") : null),
    h("div", { class: "s" }, (n.name ? n.name + " · " : "") + (TYPE_NAMES[n.type] || n.type)),
    h("div", { class: "s small" }, nodePlace(C, n) + (C.format !== "DDC3000" ? " · " + n.gKey : "")),
    h("div", { class: "row", style: { marginTop: "10px" } },
      btn("Ursachen", "left", () => cb.onChain(n.id, "up"), "sm", "Wirkkette: was wirkt auf diesen Baustein?"),
      btn("Wirkung", "right", () => cb.onChain(n.id, "down"), "sm", "Wirkkette: worauf wirkt dieser Baustein?"),
      pin ? btn("Klemme", "pin", () => openPin(C.cid, pin.uid), "sm") : null,
      btn(null, "copy", () => copyText(nodeText(C, n)).then(() => toast("Details kopiert.", "ok")), "sm", "Details kopieren"))));
  const b = h("div", { class: "drawer-body" });
  frag.appendChild(b);
  const fs = C.findings.filter(f => f.ref && (f.ref.node === n.id || (pin && f.ref.pin === pin.uid) || (f.ref.nodes || []).includes(n.id)));
  if (fs.length) { b.appendChild(h("h4", null, "Befunde")); const c = h("div", { class: "card tight" }); fs.forEach(f => c.appendChild(findingRow(C, f, true))); b.appendChild(c); }
  if (n.formula) { b.appendChild(h("h4", null, "Verknüpfungsformel")); b.appendChild(h("div", { class: "formula" }, n.formula)); }
  const inc = edgesIn(C, n.id);
  if (inc.length) {
    b.appendChild(h("h4", null, "Eingänge (" + inc.length + ")"));
    b.appendChild(h("div", { class: "dlist" }, inc.map(e => {
      const a = C.nodes.get(e.from);
      const tr = isInvertedEdge(e) ? h("span", { class: "inv-tag" }, " invertiert") : e.transform ? h("span", { class: "small muted" }, " [" + describeTransform(e.transform, stateTextsOf(a, e.fromRest)) + "]") : null;
      return h("div", { class: "click", onclick: () => cb.onJump(e.from) },
        h("span", { class: "k" }, portLabel(n.type, e.toPara) + (e.toSub ? " [" + e.toSub + "]" : "")),
        h("span", { class: "v" }, h("span", { class: "mono" }, (a ? a.addr : "?") + (e.fromRest ? "/" + e.fromRest : "")), tr, e.op ? h("span", { class: "small muted" }, " " + e.op.toUpperCase()) : null,
          h("small", null, a ? (a.name || TYPE_NAMES[a.type] || "") + (a.gKey !== n.gKey ? " · " + nodePlace(C, a) : "") + (a.ghost ? " · nicht in der Sicherung" : "") : ""),
          e.raw ? h("span", { class: "raw" }, e.raw) : null));
    })));
  }
  const out = edgesOut(C, n.id);
  if (out.length) {
    b.appendChild(h("h4", null, "Verwendet von (" + out.length + ")"));
    b.appendChild(h("div", { class: "dlist" }, out.map(e => {
      const t = C.nodes.get(e.to);
      return h("div", { class: "click", onclick: () => cb.onJump(e.to) },
        h("span", { class: "k mono" }, e.fromRest ? "/" + e.fromRest : "–"),
        h("span", { class: "v" }, h("span", { class: "mono" }, t.addr), h("span", { class: "muted small" }, " · " + portLabel(t.type, e.toPara)), isInvertedEdge(e) ? h("span", { class: "inv-tag" }, " invertiert") : null,
          h("small", null, (t.name || TYPE_NAMES[t.type] || "") + (t.gKey !== n.gKey ? " · " + nodePlace(C, t) : ""))));
    })));
  }
  const paraRows = (paras, sub) => paras.filter(p => p.addr !== "password" && (p.texts.length || p.values.length || p.act || p.funcObjs.some(f => f.type !== "FSource") || p.schedules.length)).map(p => {
    const d = dictFor(n.type, p.addr);
    const vals = p.values.filter(v => v.type !== "Source");
    const fo = p.funcObjs.filter(f => f.type !== "FSource").map(f => FUNC_NAMES[f.type] || (FB_TYPES[f.type] ? "BACnet " + FB_TYPES[f.type][1] + (foVal(f, "ObjId") ? " " + foVal(f, "ObjId") : "") : f.type));
    const v1 = vals[0], act = p.act, lv = lvPara(C, n, sub || "", p.addr);
    return h("div", null, h("span", { class: "k mono" }, p.addr),
      h("span", { class: "v" }, p.texts[0] || (d ? d.n + (d.inf ? "°" : "") : h("span", { class: "faint" }, "–")),
        v1 ? h("small", null, "Wert: " + valText(v1, p.stateTexts) + (v1.invalid ? " (ungültig)" : "") + (v1.deleted ? " (gelöscht – nicht aktiv)" : "") + (act && act.text !== v1.text ? " · wirksam: " + valText(act, p.stateTexts) : "")) : act ? h("small", null, "wirksam: " + valText(act, p.stateTexts)) : null,
        lv ? h("small", null, h("span", { class: "lv" }, "Live: " + lv.t)) : null,
        p.range ? h("small", null, "Bereich " + p.range) : null,
        fo.length ? h("small", null, fo.join(" · ")) : null,
        p.schedules.length ? h("small", { class: "mono" }, schedText(p.schedules[0])) : null));
  });
  const pr = paraRows(n.paras);
  if (pr.length) { b.appendChild(h("h4", null, "Parameter")); b.appendChild(h("div", { class: "dlist" }, pr)); }
  for (const sub of n.subObjs) {
    const r = paraRows(sub.paras, sub.addr);
    if (r.length) { b.appendChild(h("h4", null, "Unterobjekt " + sub.addr + " (" + sub.type + ")")); b.appendChild(h("div", { class: "dlist" }, r)); }
    for (const sc of sub.schedules) { b.appendChild(h("h4", null, "Zeitprogramm " + sub.addr)); b.appendChild(weekGrid(sc, null)); }
  }
  for (const sc of n.schedules) { b.appendChild(h("h4", null, "Zeitprogramm")); b.appendChild(weekGrid(sc, null)); }
  if (n.calendar.length) { b.appendChild(h("h4", null, "Kalender")); b.appendChild(h("div", { class: "formula small" }, n.calendar.join("\n"))); }
  if (n.images.length) { b.appendChild(h("h4", null, "Anlagenbilder")); b.appendChild(h("div", { class: "row" }, n.images.map(i => h("span", { class: "pill" }, i)))); }
  if (!pr.length && !inc.length && !out.length && !n.formula) b.appendChild(h("div", { class: "muted small", style: { marginTop: "14px" } }, n.ghost ? "Dieser Baustein wird nur referenziert – er steht nicht in der Sicherung (Werksstandard oder fehlende Gruppe)." : "Keine abweichenden Parameter – der Baustein läuft mit Werkseinstellungen."));
  return frag;
}
function nodeText(C, n) {
  const L = [n.addr + (n.name ? "  " + n.name : "") + "  (" + (TYPE_NAMES[n.type] || n.type) + ")", "Ort: " + nodePlace(C, n)];
  if (n.formula) L.push("Formel: " + n.formula);
  edgesIn(C, n.id).forEach(e => L.push("◄ " + portLabel(n.type, e.toPara) + ": " + edgeLabel(C, e) + " " + ((C.nodes.get(e.from) || {}).name || "")));
  edgesOut(C, n.id).forEach(e => L.push("► " + nodeTitle(C, C.nodes.get(e.to)) + " · " + portLabel(C.nodes.get(e.to).type, e.toPara)));
  return L.join("\r\n");
}


/* ---------- Globale Suche: Programmbausteine ---------- */
SEARCH.add({
  id: "programm", label: "Programm", order: 20,
  index: C => [...C.nodes.values()].filter(n => !n.isPin && n.type !== "SYS").map(n => [n, norm(n.addr + " " + n.name + " " + n.type + " " + (TYPE_NAMES[n.type] || "") + " " + (n.formula || "") + " " + nodePlace(C, n))]),
  hit: (C, n) => ({ a: n.addr, n: n.name || TYPE_NAMES[n.type] || n.type, w: nodePlace(C, n), go: () => openNode(C.cid, n.id) })
});
