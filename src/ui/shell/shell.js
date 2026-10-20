import { NAV, VIEWS } from "../core/views.js";
import { $, $$, SVGNS, h, natCmp, norm, store, trunc } from "../core/util.js";
import { collectInputs, entriesFromDrop } from "../core/load.js";
import { KIND_INFO, TYPE_NAMES, nodePlace } from "../model/model.js";
import { parseD4PML } from "../model/d4pml.js";
import { parseDDC3000 } from "../model/ddc3000.js";
import { SEV_LABEL, runFindings } from "../model/findings.js";
import { activeFindings, isIgnored, pref, refreshSev, setPref } from "../core/persist.js";
import { WDOC, addTemplate } from "../wartung/wtgml.js";

/* =========================================================================
   Oberfläche: Symbole, Zustand, Fenster-Gerüst, Navigation, Laden
   ========================================================================= */
const ICONS = {
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
  overview: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  table: "M4 5h16v14H4zM4 9.5h16M4 14h16M9.5 9.5V19",
  flow: "M5 5h5v4H5zM14 15h5v4h-5zM14 5h5v4h-5zM10 7h4M16.5 9v6M7.5 9v8h6.5",
  alert: "M12 4 3 19.5h18zM12 10v4.5M12 17v.5",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2",
  doc: "M7 3.5h7l4.5 4.5v12.5H7zM14 3.5V8h4.5M9.5 12.5h6M9.5 15.5h6M9.5 9.5h2",
  compare: "M8 4v16M16 4v16M4 8h4M4 12h4M16 9h4M16 15h4",
  folder: "M3.5 6.5h6l2 2h9v10.5h-17z",
  file: "M6.5 3.5h7.5l4 4v13h-11.5zM14 3.5v4h4",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  moon: "M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z",
  theme: "M12 3.5a8.5 8.5 0 1 0 0 17zM12 3.5a8.5 8.5 0 0 1 0 17",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.3 15.3 20 20",
  chev: "M9 5l7 7-7 7",
  chevd: "M5 9l7 7 7-7",
  close: "M6 6l12 12M18 6 6 18",
  copy: "M8.5 8.5h11v11h-11zM5.5 15.5h-1v-11h11v1",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14",
  filter: "M4 5.5h16l-6 7v6l-4 1.5v-7.5z",
  menu: "M4 7h16M4 12h16M4 17h16",
  jump: "M13.5 5.5H19v5.5M19 5.5l-8 8M17 14v5H5V7h5",
  info: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 11v5.5M12 7.5v.5",
  error: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9 9l6 6M15 9l-6 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  plus: "M12 5v14M5 12h14",
  trash: "M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 10.5v6M13.5 10.5v6",
  up: "M12 19V5M6.5 10.5 12 5l5.5 5.5",
  down: "M12 5v14M6.5 13.5 12 19l5.5-5.5",
  eye: "M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  eyeoff: "M4 4l16 16M10 6c.6-.3 1.3-.5 2-.5 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.5 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-1",
  zin: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.3 15.3 20 20M10.5 8v5M8 10.5h5",
  zout: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.3 15.3 20 20M8 10.5h5",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  left: "M19 12H5M10.5 6.5 5 12l5.5 5.5",
  right: "M5 12h14M13.5 6.5 19 12l-5.5 5.5",
  print: "M7 9V3.5h10V9M7 17H4.5V9h15v8H17M7 14h10v6.5H7z",
  cpu: "M7 7h10v10H7zM9.5 9.5h5v5h-5zM10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5",
  pin: "M12 3.5v4M8 7.5h8l-1 6H9zM12 13.5v7M9 17h6",
  bell: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20a2 2 0 0 0 4 0",
  hand: "M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10V5.5a1.5 1.5 0 0 1 3 0V14a6.5 6.5 0 0 1-6.5 6.5 5.5 5.5 0 0 1-4.6-2.5L3.8 14.4a1.5 1.5 0 0 1 2.4-1.8L8 15",
  gate: "M4 12h5M15 12h5M9 8v8M15 8l-6 4",
  stop: "M8.3 3.5h7.4l5.3 5.3v7.4l-5.3 5.3H8.3L3 16.2V8.8zM8 12h8",
  target: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.5v1",
  swap: "M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4",
  lock: "M6.5 10.5h11v10h-11zM8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5",
  bacnet: "M4 6h16v5H4zM4 13h16v5H4zM7 8.5h.5M7 15.5h.5",
  cal: "M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5V7M15.5 3.5V7",
  hours: "M12 3.5a8.5 8.5 0 1 0 8.5 8.5M12 7.5V12h4.5M16 3.5h4.5V8",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5",
  wrench: "M14.5 4a4.5 4.5 0 0 0-4.2 6.1L4 16.5 7.5 20l6.4-6.3A4.5 4.5 0 0 0 20 9.5l-3 3-3-3 3-3a4.5 4.5 0 0 0-2.5-2.5z",
  sliders: "M5 4v16M12 4v16M19 4v16M3 9h4M10 15h4M17 7h4",
  key: "M15 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11.5 12.5 4 20M7 17l2.5 2.5M9.5 14.5 12 17",
  station: "M5 3.5h14v17H5zM8 7h8M8 10h8M8 14h3M8 17h3M14.5 14.5h2v3h-2z",
  air: "M3.5 8.5h11a2.5 2.5 0 1 0-2.5-2.5M3.5 12h15a2.5 2.5 0 1 1-2.5 2.5M3.5 15.5h7"
};
export function icon(name, cls) {
  const sv = document.createElementNS(SVGNS, "svg");
  sv.setAttribute("viewBox", "0 0 24 24"); sv.setAttribute("class", "i" + (cls ? " " + cls : ""));
  sv.setAttribute("fill", "none"); sv.setAttribute("stroke", "currentColor"); sv.setAttribute("stroke-width", "1.5");
  sv.setAttribute("stroke-linecap", "round"); sv.setAttribute("stroke-linejoin", "round"); sv.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", ICONS[name] || ICONS.info); sv.appendChild(p);
  return sv;
}
export function logoSvg(cls) {
  const d = h("span", { html: `<svg class="${cls || "logo"}" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b88d8"/><stop offset="1" stop-color="#005fb8"/></linearGradient></defs><rect x="4" y="4" width="40" height="40" rx="9" fill="url(#lg1)"/><path d="M13 16h9v6h-9zM26 26h9v6h-9zM22 19h6v10" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><circle cx="35" cy="16" r="3.2" fill="#9fd8ff"/></svg>` });
  return d.firstChild;
}

/* ---------- Zustand ---------- */
export const APP = {
  centrals: [], cur: null, templates: [], view: "start", opts: {}, vs: {}, wd: {}, cmp: {},
  theme: store.get("theme", "system"), collapsed: store.get("navCollapsed", false)
};
export const curC = () => APP.centrals.find(c => c.cid === APP.cur) || null;
export const byCid = cid => APP.centrals.find(c => c.cid === cid) || null;
export function vstate(view, C, init) {
  const k = view + ":" + (C ? C.cid : "-");
  if (!APP.vs[k]) APP.vs[k] = init();
  return APP.vs[k];
}

/* ---------- Farbschema ---------- */
function applyTheme(mode) {
  APP.theme = mode; store.set("theme", mode);
  const r = document.documentElement;
  if (mode === "system") r.removeAttribute("data-theme"); else r.setAttribute("data-theme", mode);
  const b = $("#btnTheme"); if (b) { b.innerHTML = ""; b.appendChild(icon(isDark() ? "moon" : "sun")); }
}
const isDark = () => APP.theme === "dark" || (APP.theme === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);

/* ---------- Toast, Flyout, Tooltip ---------- */
export function toast(msg, kind, ms) {
  let box = $(".toasts"); if (!box) { box = h("div", { class: "toasts" }); document.body.appendChild(box); }
  const ic = { ok: "check", err: "error", warn: "alert", inf: "info" }[kind || "inf"];
  const t = h("div", { class: "toast " + (kind || "inf") }, icon(ic), h("div", null, msg));
  box.appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .25s"; t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, ms || 3800);
}
export function flyout(anchor, items) {
  closeFlyout();
  const f = h("div", { class: "flyout" });
  for (const it of items) {
    if (!it) continue;
    if (it === "-") { if (f.lastChild && !f.lastChild.classList.contains("sep")) f.appendChild(h("div", { class: "sep" })); continue; }
    if (it.head) { f.appendChild(h("div", { class: "fhead" }, it.head)); continue; }
    f.appendChild(h("div", { class: "mi" + (it.on ? " on" : ""), onclick: () => { closeFlyout(); it.run(); } },
      h("span", { class: "chkm" }, it.on ? icon("check") : (it.icon ? icon(it.icon) : null)), it.label));
  }
  document.body.appendChild(f);
  const r = anchor.getBoundingClientRect();
  const fw = f.offsetWidth, fh = f.offsetHeight;
  f.style.top = (r.bottom + 4 + fh > window.innerHeight - 8 ? Math.max(8, r.top - fh - 4) : r.bottom + 4) + "px";
  f.style.left = Math.max(8, Math.min(window.innerWidth - fw - 8, r.right - fw)) + "px";
  setTimeout(() => document.addEventListener("mousedown", flyOutside, true), 0);
}
function flyOutside(e) { const f = $(".flyout"); if (f && !f.contains(e.target)) closeFlyout(); }
function closeFlyout() { const f = $(".flyout"); if (f) f.remove(); document.removeEventListener("mousedown", flyOutside, true); }
const TIP = { el: null };
export function showTip(ev, html) {
  if (!TIP.el) { TIP.el = h("div", { class: "tip" }); document.body.appendChild(TIP.el); }
  TIP.el.innerHTML = html; TIP.el.style.display = "block";
  const w = TIP.el.offsetWidth, ht = TIP.el.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
  if (y + ht > window.innerHeight - 8) y = ev.clientY - ht - 14;
  TIP.el.style.left = x + "px"; TIP.el.style.top = y + "px";
}
export function hideTip() { if (TIP.el) TIP.el.style.display = "none"; }

/* ---------- Kleine Bausteine ---------- */
export const kindTag = k => h("span", { class: "kind " + k, title: (KIND_INFO[k] || {}).name || k }, k === "frei" ? "frei" : k);
export const sevIcon = s => h("span", { class: "sev " + s, title: SEV_LABEL[s] }, icon(s === "err" ? "close" : s === "warn" ? "alert" : "info"));
export function btn(label, ico, onclick, cls, title) {
  return h("button", { class: "btn" + (cls ? " " + cls : "") + (!label ? " icon" : ""), onclick, title: title || (label ? null : "") }, ico ? icon(ico) : null, label || null);
}
export function chk(label, checked, onchange, cls) {
  const i = h("input", { type: "checkbox", checked });
  i.addEventListener("change", () => onchange(i.checked));
  return h("label", { class: cls || "chk" }, i, label);
}
export function searchBox(ph, val, oninput, width) {
  const i = h("input", { type: "search", placeholder: ph, value: val || "" });
  let t = null;
  i.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => oninput(i.value), 120); });
  return h("div", { class: "tbox", style: { width: width || "260px" } }, icon("search"), i);
}
export function selectEl(options, value, onchange, cls) {
  const s = h("select", { class: "in " + (cls || "") });
  for (const [v, t] of options) s.appendChild(h("option", { value: v }, t));
  s.value = value;
  s.addEventListener("change", () => onchange(s.value));
  return s;
}
export function kbar(kinds, total) {
  const b = h("div", { class: "kbar", title: Object.entries(kinds).map(([k, n]) => k + " " + n).join(" · ") });
  const sum = total || Object.values(kinds).reduce((a, n) => a + n, 0) || 1;
  for (const k of ["AE", "AA", "BE", "BA", "frei"]) if (kinds[k]) b.appendChild(h("span", { class: k, style: { width: (kinds[k] / sum * 100) + "%" } }));
  return b;
}
export function emptyState(ico, title, text, extra) {
  return h("div", { class: "empty" }, icon(ico), h("div", { style: { fontWeight: 600, color: "var(--text)" } }, title), text ? h("div", { class: "small", style: { marginTop: "4px" } }, text) : null, extra || null);
}
export function findingsCount(C) {
  const c = { err: 0, warn: 0, info: 0, ign: 0 };
  if (C) for (const f of C.findings) { if (isIgnored(C, f)) c.ign++; else c[f.sev]++; }
  return c;
}

/* ---------- Ansichten-Registry ---------- */

export function buildShell() {
  document.body.innerHTML = "";
  const app = h("div", { id: "app" });
  /* Titelleiste */
  const tb = h("header", { class: "titlebar" },
    h("button", { class: "btn subtle icon", title: "Navigation ein-/ausklappen", onclick: () => { APP.collapsed = !APP.collapsed; store.set("navCollapsed", APP.collapsed); $(".main").classList.toggle("collapsed", APP.collapsed); } }, icon("menu")),
    h("div", { class: "tb-brand" }, logoSvg(), h("b", null, "DDC-Werkbank"), h("span", null, "Kieback&Peter · DDC3000 · DDC4000 · BMR")),
    h("div", { class: "tb-mid" }, h("div", { id: "tbStation" }), h("div", { id: "tbSearch" })),
    h("div", { class: "tb-right" },
      h("button", { class: "btn subtle", title: "Sicherungen oder WTGML-Vorlage öffnen (Strg+O)", onclick: () => $("#fileIn").click() }, icon("folder"), h("span", { class: "nowrap" }, "Öffnen")),
      h("button", { class: "btn subtle icon", id: "btnTheme", title: "Farbschema", onclick: e => flyout(e.currentTarget, [
        { label: "Hell", icon: "sun", on: APP.theme === "light", run: () => applyTheme("light") },
        { label: "Dunkel", icon: "moon", on: APP.theme === "dark", run: () => applyTheme("dark") },
        { label: "Wie Windows", icon: "theme", on: APP.theme === "system", run: () => applyTheme("system") }]) })
    )
  );
  const nav = h("nav", { class: "nav", id: "nav" });
  const content = h("main", { class: "content", id: "content" });
  app.appendChild(tb);
  app.appendChild(h("div", { class: "main" + (APP.collapsed ? " collapsed" : "") }, nav, content));
  document.body.appendChild(app);
  document.body.appendChild(h("input", { type: "file", id: "fileIn", multiple: true, hidden: true, accept: ".xml,.d4pml,.wwf,.wtgml,.zip,.rtf,.txt" }));
  document.body.appendChild(h("input", { type: "file", id: "dirIn", multiple: true, hidden: true, webkitdirectory: true }));
  document.body.appendChild(h("div", { class: "drop-overlay" }, h("div", { class: "box" }, icon("upload"), "Loslassen zum Laden")));
  $("#fileIn").addEventListener("change", e => { loadFiles([...e.target.files]); e.target.value = ""; });
  $("#dirIn").addEventListener("change", e => { loadFiles([...e.target.files]); e.target.value = ""; });

  /* Ziehen & Ablegen überall */
  let depth = 0;
  window.addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; document.body.classList.add("dropping"); });
  window.addEventListener("dragover", e => { if (!hasFiles(e)) return; e.preventDefault(); });
  window.addEventListener("dragleave", e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove("dropping"); });
  window.addEventListener("drop", async e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; document.body.classList.remove("dropping");
    const items = e.dataTransfer.items;
    /* Dateigriffe sofort holen – nur während des Ereignisses möglich (Edge/Chrome) */
    const hp = items ? [...items].map(it => it.kind === "file" && it.getAsFileSystemHandle ? it.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null)) : [];
    const files = items && items.length && items[0].webkitGetAsEntry ? await entriesFromDrop(items) : [...e.dataTransfer.files];
    const handles = new Map();
    for (const hd of await Promise.all(hp)) if (hd && hd.kind === "file") handles.set(hd.name, hd);
    loadFiles(files, handles);
  });
  window.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { e.preventDefault(); $("#fileIn").click(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); const i = $("#tbSearch input"); if (i) i.focus(); }
    if (e.key === "Escape") { closeFlyout(); hideTip(); }
  });
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(APP.theme));
  applyTheme(APP.theme);
  renderAll();
}
const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");

function renderNav() {
  const nav = $("#nav"); nav.innerHTML = "";
  const C = curC();
  for (const it of NAV) {
    if (it === "-") { nav.appendChild(h("div", { class: "nav-sep" })); continue; }
    const [id, label, ico] = it;
    const needs = id !== "start" && id !== "wartung" && id !== "compare" && id !== "online";
    const b = h("button", { class: "nav-item" + (APP.view === id ? " on" : ""), disabled: needs && !C, title: label, onclick: () => go(id) },
      icon(ico), h("span", { class: "lbl" }, label));
    if (id === "findings" && C) {
      const fc = findingsCount(C);
      if (fc.err) b.appendChild(h("span", { class: "badge err", title: fc.err + " Fehler" }, fc.err));
      if (fc.warn) b.appendChild(h("span", { class: "badge warn", title: fc.warn + " Warnungen" }, fc.warn));
      if (fc.err) b.appendChild(h("span", { class: "dot" }));
    }
    if (id === "wartung" && WDOC.cur) b.appendChild(h("span", { class: "badge " + (WDOC.cur.dirty ? "warn" : "soft"), title: WDOC.cur.name + (WDOC.cur.dirty ? " – ungespeichert" : "") }, WDOC.cur.writable ? "verknüpft" : "WTGML"));
    nav.appendChild(b);
  }
  nav.appendChild(h("div", { class: "nav-foot" },
    h("div", { class: "nav-sep" }),
    h("div", { class: "nav-head", title: "Alle Daten bleiben auf diesem Rechner." }, h("span", { style: { display: "inline-flex", gap: "6px", alignItems: "center" } }, icon("lock"), "Offline · keine Datenübertragung"))));
}

function renderTitle() {
  const st = $("#tbStation"); st.innerHTML = "";
  if (APP.centrals.length) {
    const opts = APP.centrals.map(c => [c.cid, stationLabel(c)]);
    const s = selectEl(opts, APP.cur, v => { APP.cur = v; if (APP.view === "start") APP.view = "overview"; renderAll(); }, "tb-station");
    s.title = "Geladene Sicherung wählen";
    st.appendChild(s);
  }
  const sb = $("#tbSearch"); sb.innerHTML = "";
  if (curC()) sb.appendChild(globalSearch());
}

const SCROLL_SEL = ".page-body, .rail, .center, .grid-wrap, .drawer, .wd-main";
export function renderAll() {
  renderTitle(); renderNav();
  $(".main").classList.toggle("compact", APP.view === "program");
  const content = $("#content");
  /* Scrollpositionen je Ansicht merken (auch beim Wechsel in eine andere Ansicht und zurück) */
  if (!APP._scroll) APP._scroll = {};
  if (APP._lastKey && $("#content")) APP._scroll[APP._lastKey] = $$(SCROLL_SEL, content).map(el => [el.scrollTop, el.scrollLeft]);
  const jump = Object.keys(APP.opts || {}).length > 0;
  content.innerHTML = ""; hideTip();
  const V = VIEWS[APP.view] || VIEWS.start;
  const C = curC();
  if (V.needsC && !C) { APP.view = "start"; return renderAll(); }
  try { V.render(content, C, APP.opts || {}); }
  catch (e) {
    console.error(e);
    content.appendChild(h("div", { class: "page-body" }, h("div", { class: "infobar err", style: { marginTop: "24px" } }, icon("error"),
      h("div", null, h("b", null, "Diese Ansicht konnte nicht aufgebaut werden. "), String(e && e.message || e)))));
  }
  const key = viewKey();
  const pos = !jump && APP._scroll[key];
  if (pos) $$(SCROLL_SEL, content).forEach((el, i) => { if (pos[i] && !el.dataset.noRestore) { el.scrollTop = pos[i][0]; el.scrollLeft = pos[i][1]; } });
  APP._lastKey = key;
  APP._lastView = APP.view;
  APP.opts = {};
}
/* Schlüssel für die gemerkte Scrollposition: Ansicht + Zentrale bzw. Reiter der Wartungsdoku */
function viewKey() {
  if (APP.view === "wartung") return "wartung|" + (APP.wdTab || "") + "|" + (WDOC.cur ? WDOC.cur.name : "");
  return APP.view + "|" + (APP.cur || "");
}
export function go(view, opts) { APP.view = view; APP.opts = opts || {}; renderAll(); }
export function pageHead(title, sub, acts) {
  return h("div", { class: "page-head" },
    h("div", { class: "grow" }, h("h1", null, title), sub ? h("div", { class: "sub" }, sub) : null),
    acts ? h("div", { class: "acts" }, acts) : null);
}
export function stationLabel(c) {
  const m = c.meta, t = c.format === "DDC3000" ? "DDC3000" : m.stationType;
  const base = [m.name, t && !m.name.includes(t) ? t : "", m.centralAddr && !m.name.includes("Z" + m.centralAddr) ? "Z" + m.centralAddr : ""].filter(Boolean).join(" · ");
  const same = APP.centrals.filter(x => x !== c && x.meta.name === m.name && x.meta.centralAddr === m.centralAddr);
  if (!same.length) return base;
  const nr = "Nr. " + (APP.centrals.indexOf(c) + 1);
  if (m.stamp && !same.some(x => x.meta.stamp === m.stamp)) return base + " · " + m.stamp;
  if (c.filePath && !same.some(x => x.filePath === c.filePath) && c.filePath.includes("/")) return base + " · " + c.filePath.split("/").slice(0, -1).join("/");
  return base + " · " + nr;
}
export function stationSub(C) {
  if (!C) return "";
  const m = C.meta;
  const t = C.format === "DDC3000" ? "DDC3000 " + (m.stationType || "") : m.stationType;
  return [m.name, t && !m.name.includes(m.stationType) ? t : (C.format === "DDC3000" ? "DDC3000" : ""), m.centralAddr ? "Zentrale " + m.centralAddr : "", m.stamp ? "Stand " + m.stamp : ""].filter(Boolean).join("  ·  ");
}

/* ---------- Sprungziele ---------- */
export function openPin(cid, uid) { if (cid) APP.cur = cid; go("points", { pin: uid }); }
export function openNode(cid, nid, chain) { if (cid) APP.cur = cid; go("program", { node: nid, chain: chain || null }); }
export function openRef(C, ref) {
  if (!ref) return;
  if (ref.pin) return openPin(C.cid, ref.pin);
  const n = C.nodes.get(ref.node);
  if (n && n.pin) return openPin(C.cid, n.pin.uid);
  if (ref.node) return openNode(C.cid, ref.node);
}

/* ---------- Laden ---------- */
let LOADING = false;
async function loadFiles(files, handles) {
  if (!files || !files.length || LOADING) return;
  LOADING = true;
  toast("Lese " + files.length + " Datei(en) …", "inf", 1500);
  try {
    const found = await collectInputs(files);
    if (!found.length) { toast("Keine Sicherung und keine WTGML-Vorlage erkannt. Erwartet: datasave.xml, *.d4pml, *.wwf, *.wtgml oder ZIP/Ordner damit.", "warn", 7000); return; }
    const added = [], bad = [];
    let tplAdded = 0;
    for (const f of found) {
      try {
        if (f.kind === "wtgml") { if (addTemplate(f.text, f.name, handles && handles.get(f.name))) tplAdded++; continue; }
        const C = f.kind === "ddc3000" ? parseDDC3000(f.text, f.label, f.name) : parseD4PML(f.text, f.label, f.name);
        C.filePath = f.path;
        C.hash = textHash(f.text);
        runFindings(C);
        refreshSev(C);
        const dupe = APP.centrals.find(x => x.hash === C.hash);
        if (dupe) { bad.push(f.name + ": bereits geladen"); continue; }
        APP.centrals.push(C); added.push(C);
      } catch (e) { console.error(e); bad.push(f.name + ": " + e.message); }
    }
    APP.centrals.sort((a, b) => (parseInt(a.meta.centralAddr, 10) || 0) - (parseInt(b.meta.centralAddr, 10) || 0) || natCmp(a.meta.name, b.meta.name));
    if (added.length) {
      APP.cur = added[0].cid;
      toast(added.length === 1 ? `„${added[0].meta.name}“ geladen – ${added[0].pins.filter(p => p.kind !== "frei").length} belegte Klemmen, ${activeFindings(added[0]).filter(f => f.sev !== "info").length} Befunde.`
        : `${added.length} Sicherungen geladen.`, "ok");
      if (APP.view === "start") APP.view = "overview";
    }
    if (tplAdded) { toast("Wartungsdoku geöffnet: " + WDOC.cur.name + (WDOC.cur.handle ? " – zum direkten Speichern im Tab „Wartungsdoku“ verknüpfen." : ""), "ok", 6000); APP.wdTab = "doc"; if (!added.length) APP.view = "wartung"; }
    if (bad.length) toast(bad.join(" · "), "warn", 8000);
    renderAll();
  } catch (e) { console.error(e); toast("Fehler beim Laden: " + e.message, "err", 8000); }
  finally { LOADING = false; }
}
export function removeCentral(cid) {
  APP.centrals = APP.centrals.filter(c => c.cid !== cid);
  for (const k of Object.keys(APP.vs)) if (k.endsWith(":" + cid)) delete APP.vs[k];
  delete APP.wd[cid];
  if (APP.cur === cid) APP.cur = APP.centrals.length ? APP.centrals[0].cid : null;
  renderAll();
}

function textHash(t) { let h1 = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h1 ^= t.charCodeAt(i); h1 = Math.imul(h1, 16777619); } return t.length + ":" + (h1 >>> 0).toString(16); }

/* ---------- Globale Suche (Strg+K) – aktuelle Zentrale oder alle ---------- */
function searchIndex(C) {
  if (C._sidx) return C._sidx;
  return (C._sidx = {
    pins: C.pins.map(p => [p, norm(p.klemme + " " + p.name + " " + p.paraText)]),
    nodes: [...C.nodes.values()].filter(n => !n.isPin && n.type !== "SYS").map(n => [n, norm(n.addr + " " + n.name + " " + n.type + " " + (TYPE_NAMES[n.type] || "") + " " + (n.formula || "") + " " + nodePlace(C, n))])
  });
}
function globalSearch() {
  const inp = h("input", { type: "search", placeholder: "Klemme, Baustein, Text suchen …" });
  let scope = pref("searchScope", "cur");
  const scLabel = () => scope === "all" ? "Alle Zentralen" : "Diese Zentrale";
  const sc = h("button", { class: "scope" + (scope === "all" ? " all" : ""), title: "Suchbereich: nur die gewählte Zentrale oder alle geladenen Zentralen", onmousedown: e => {
    e.preventDefault(); scope = scope === "all" ? "cur" : "all"; setPref("searchScope", scope);
    sc.textContent = scLabel(); sc.classList.toggle("all", scope === "all"); inp.focus(); run();
  } }, scLabel());
  const wrap = h("div", { class: "tbox tb-search" }, icon("search"), inp, sc, h("span", { class: "kbd" }, "Strg+K"));
  let pop = null, items = [], idx = 0;
  const close = () => { if (pop) pop.remove(); pop = null; };
  const run = () => {
    const q = norm(inp.value);
    close();
    if (q.length < 2) return;
    const cur = curC();
    const cs = scope === "all" ? [cur, ...APP.centrals.filter(c => c !== cur)].filter(Boolean) : [cur];
    const many = cs.length > 1, cap = many ? 5 : 60;
    const res = [];
    let more = 0, hitSt = 0;
    for (const C of cs) {
      const pre = many ? C.meta.name + " · " : "";
      const X = searchIndex(C);
      const G = { Klemmen: [], Programm: [], Befunde: [] };
      for (const [p, hay] of X.pins) if (hay.includes(q)) G.Klemmen.push({ a: p.klemme, n: p.name || p.paraText || "–", w: p.kind, go: () => openPin(C.cid, p.uid) });
      for (const [n, hay] of X.nodes) if (hay.includes(q)) G.Programm.push({ a: n.addr, n: (n.name || TYPE_NAMES[n.type] || n.type), w: nodePlace(C, n), go: () => openNode(C.cid, n.id) });
      for (const f of C.findings) if (norm(f.title + " " + f.detail).includes(q)) G.Befunde.push({ a: SEV_LABEL[f.sev], n: f.title, w: f.cat + (isIgnored(C, f) ? " · abgehakt" : ""), go: () => { APP.cur = C.cid; go("findings", { focus: f.id }); } });
      let cut = 0, tot = 0;
      for (const [g, list] of Object.entries(G)) { tot += list.length; for (const r of list.slice(0, cap)) res.push(Object.assign(r, { g: pre + g })); cut += Math.max(0, list.length - cap); }
      if (tot) hitSt++;
      if (cut && many) res.push({ g: pre + "mehr", more: true, a: "", n: "Alle " + tot + " Treffer in " + C.meta.name + " zeigen", w: "", go: () => { APP._searchQ = inp.value; scope = "cur"; setPref("searchScope", "cur"); APP.cur = C.cid; if (APP.view === "start") APP.view = "overview"; renderAll(); } });
      else more += cut;
    }
    items = res.slice(0, many ? 300 : 60); more += res.filter(r => !r.more).length - items.filter(r => !r.more).length;
    idx = 0;
    pop = h("div", { class: "search-pop" });
    if (!items.length) pop.appendChild(h("div", { class: "it" }, h("span", { class: "muted" }, "Keine Treffer" + (scope === "all" ? " in " + cs.length + " Zentralen" : " in dieser Zentrale – „Alle Zentralen“ probieren?"))));
    else if (many) pop.appendChild(h("div", { class: "hd sum" }, "Treffer in " + hitSt + " von " + cs.length + " Zentralen"));
    let lastG = null;
    items.forEach((r, i) => {
      if (r.g !== lastG && !r.more) { pop.appendChild(h("div", { class: "hd" }, r.g)); }
      lastG = r.g;
      r.el = h("div", { class: "it" + (r.more ? " more" : "") + (i === 0 ? " on" : ""), onmousedown: e => { e.preventDefault(); close(); if (!r.more) inp.value = ""; r.go(); } },
        h("span", { class: "a" }, r.more ? icon("right") : r.a), h("span", { class: "n" }, r.n), h("span", { class: "w" }, trunc(r.w, 40)));
      pop.appendChild(r.el);
    });
    if (more > 0) pop.appendChild(h("div", { class: "hd" }, "… " + more + " weitere – Suche verfeinern"));
    wrap.appendChild(pop);
  };
  let t = null;
  inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 100); });
  inp.addEventListener("focus", () => { if (inp.value) run(); });
  inp.addEventListener("blur", () => setTimeout(close, 150));
  if (APP._searchQ) { inp.value = APP._searchQ; APP._searchQ = null; setTimeout(() => { inp.focus(); run(); }, 0); }
  inp.addEventListener("keydown", e => {
    if (!pop || !items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[idx].el.classList.remove("on");
      idx = (idx + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      items[idx].el.classList.add("on"); items[idx].el.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") { e.preventDefault(); const r = items[idx]; close(); if (!r.more) { inp.value = ""; inp.blur(); } r.go(); }
    else if (e.key === "Escape") { close(); inp.blur(); }
  });
  return wrap;
}

