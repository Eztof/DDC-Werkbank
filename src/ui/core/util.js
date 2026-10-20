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
export const natCmp = (a, b) => String(a).localeCompare(String(b), "de", { numeric: true });
export const trunc = (v, n) => { v = String(v ?? ""); return v.length > n ? v.slice(0, n - 1) + "…" : v; };
export const uniq = a => [...new Set(a)];
export const norm = v => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();

export function fmtNum(v, dec) {
  const f = parseFloat(v);
  if (isNaN(f)) return String(v ?? "");
  if (dec == null) dec = Math.abs(f) >= 1000 || Number.isInteger(f) ? 0 : (Math.abs(f) < 10 ? 2 : 1);
  return f.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: dec });
}
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
  set(k, v) { try { localStorage.setItem("ddcwb." + k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- Einheiten (BACnet-Engineering-Units, wie von K&P verwendet) ---------- */
const UNITS = {
  "2": "mA", "3": "A", "4": "Ω", "5": "V", "19": "kWh", "27": "Hz", "29": "% rF", "30": "mm", "31": "m",
  "47": "W", "48": "kW", "53": "Pa", "54": "kPa", "55": "bar", "62": "°C", "63": "K", "64": "°F",
  "70": "d", "71": "h", "72": "min", "73": "s", "80": "m³", "82": "l", "87": "l/s", "88": "l/min",
  "95": "", "96": "ppm", "98": "%", "104": "1/min", "135": "m³/h"
};
export const unitLabel = u => (u == null || u === "") ? "" : (Object.prototype.hasOwnProperty.call(UNITS, u) ? UNITS[u] : "[" + u + "]");

