/* =========================================================================
   DDC-Werkbank · Kieback&Peter DDC3000 / DDC4000 / BMR
   Läuft vollständig offline im Browser. Keine Daten verlassen den Rechner.
   ========================================================================= */

/* ---------- DOM-Helfer ---------- */
export const $  = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
export function h(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else if (k === "text") e.textContent = v;
    else if (k === "value") e.value = v;
    else if (k === "checked") e.checked = !!v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  appendKids(e, children);
  return e;
}
function appendKids(e, list) {
  for (const c of list) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendKids(e, c);
    else e.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}
export const SVGNS = "http://www.w3.org/2000/svg";
export function s(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
export const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const xesc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const kids = (n, t) => { const a = []; if (n) for (const c of n.children) if (c.tagName === t) a.push(c); return a; };
export const kid  = (n, t) => { if (n) for (const c of n.children) if (c.tagName === t) return c; return null; };
export const textOf = n => { const t = kid(n, "Text"); return t ? (t.textContent || "").trim() : ""; };
const COLL = new Intl.Collator("de", { numeric: true });   // einmal anlegen – localeCompare mit Optionen ist je Aufruf teuer
export const natCmp = (a, b) => COLL.compare(String(a), String(b));
export const trunc = (v, n) => { v = String(v ?? ""); return v.length > n ? v.slice(0, n - 1) + "…" : v; };
export const uniq = a => [...new Set(a)];
export const norm = v => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();

export function fmtNum(v, dec) {
  const f = parseFloat(v);
  if (isNaN(f)) return String(v ?? "");
  if (dec == null) dec = Math.abs(f) >= 1000 || Number.isInteger(f) ? 0 : (Math.abs(f) < 10 ? 2 : 1);
  let nf = NUMF.get(dec);
  if (!nf) NUMF.set(dec, nf = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: dec }));
  return nf.format(f);
}
const NUMF = new Map();
export function fmtUnix(sec) {
  const n = parseInt(sec, 10);
  if (!n || n < 100000000) return "";
  const d = new Date(n * 1000), p = x => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function nowStamp() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export function download(name, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function csv(rows) {
  const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  return "﻿" + rows.map(r => r.map(q).join(";")).join("\r\n");
}
export function safeName(v) { return String(v || "export").trim().replace(/[^\w.\-äöüÄÖÜß]+/g, "_").replace(/^_+|_+$/g, "") || "export"; }
export function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
  const ta = h("textarea", { style: { position: "fixed", opacity: "0" } }, t);
  document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {}
  ta.remove(); return Promise.resolve();
}
export const store = {
  get(k, d) { try { const v = localStorage.getItem("ddcwb." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) {
    try { localStorage.setItem("ddcwb." + k, JSON.stringify(v)); return true; }
    catch (e) { if (!store._warned) { store._warned = true; console.warn("Browser-Speicher voll oder gesperrt:", e); } return false; }
  }
};

/* ---------- Einheiten (BACnet-Engineering-Units, wie von K&P verwendet) ---------- */
const UNITS = {
  "2": "mA", "3": "A", "4": "Ω", "5": "V", "19": "kWh", "27": "Hz", "29": "% rF", "30": "mm", "31": "m",
  "47": "W", "48": "kW", "53": "Pa", "54": "kPa", "55": "bar", "62": "°C", "63": "K", "64": "°F",
  "70": "d", "71": "h", "72": "min", "73": "s", "80": "m³", "82": "l", "87": "l/s", "88": "l/min",
  "95": "", "96": "ppm", "98": "%", "104": "1/min", "135": "m³/h"
};
export const unitLabel = u => (u == null || u === "") ? "" : (Object.prototype.hasOwnProperty.call(UNITS, u) ? UNITS[u] : "[" + u + "]");


/* ---------- Lange Listen schrittweise aufbauen ----------
   Die ersten Einträge sofort, weitere beim Herunterscrollen – die Oberfläche
   bleibt bedienbar, auch bei Tausenden Zeilen. Vor Strg+F und Drucken wird
   der Rest auf einmal gezeichnet (lazyFillAll).
   opts: first (sofort, Standard 150), step (je Nachschub, 300), until (Index, der sofort da sein muss),
         scroller (scrollendes Element; sonst das nächste umgebende) */
export const LAZY = { all: false };   // true: alles sofort zeichnen
const LAZY_OPEN = new Set();
const SCROLLERS = ".page-body, .grid-wrap, .center, .rail, .drawer, .wd-main";
export function lazyAppend(parent, items, render, opts) {
  const o = opts || {}, step = o.step || 300;
  let i = 0, sc = null, queued = false, tries = 0;
  const more = n => {
    const end = Math.min(items.length, i + n), frag = document.createDocumentFragment();
    for (; i < end; i++) { const el = render(items[i], i); if (el) frag.appendChild(el); }
    parent.appendChild(frag);
  };
  const L = { fill: () => { more(items.length); finish(); } };
  const finish = () => { LAZY_OPEN.delete(L); delete parent.dataset.lazy; if (sc) sc.removeEventListener("scroll", onScroll); };
  const pump = () => {
    queued = false;
    if (!parent.isConnected) { if (sc || ++tries > 3) finish(); else schedule(); return; }   // verworfen – oder noch nicht eingehängt
    if (!sc) { sc = o.scroller || parent.closest(SCROLLERS); if (sc) sc.addEventListener("scroll", onScroll, { passive: true }); }
    const want = sc && sc._wantScroll;
    const need = !sc || want || sc.scrollTop + sc.clientHeight > sc.scrollHeight - 1500;
    if (!need) return;                       // weiter erst beim Scrollen
    more(step);
    if (want) { sc.scrollTop = want[0]; sc.scrollLeft = want[1]; if (sc.scrollTop >= want[0] - 2) sc._wantScroll = null; }
    if (i >= items.length) { if (want) sc._wantScroll = null; finish(); return; }
    schedule();
  };
  const schedule = () => { if (!queued) { queued = true; setTimeout(pump, 0); } };
  const onScroll = () => schedule();
  more(LAZY.all ? items.length : Math.max(o.first || 150, (o.until == null ? -1 : o.until) + 1));
  if (i < items.length) { parent.dataset.lazy = "1"; LAZY_OPEN.add(L); schedule(); }
  return L;
}
/* Alle noch offenen Listen sofort fertig zeichnen */
export function lazyFillAll() {
  for (const L of [...LAZY_OPEN]) L.fill();
}
/* Scrollposition soll wiederhergestellt werden: Listen in diesem Bereich nachladen */
export function lazyKick(sc) { sc.dispatchEvent(new Event("scroll")); }
