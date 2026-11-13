import { APP } from "../core/state.js";
import { h, store } from "../core/util.js";
import { btn, icon, renderAll } from "../shell/shell.js";
import { wdSvc, wdSvcOpen } from "./wtgml.js";

/* =========================================================================
   Wartungsdoku über die Werkbank-.exe öffnen: kleiner Dateiauswähler in der
   Seite (Orte, Ordner, .wtgml-Dateien). Die .exe liest die gewählte Datei
   und schreibt jede Änderung direkt hinein – ohne den Dateidialog und ohne
   den Dateizugriff des Browsers (siehe wtgml.js, service/dateien.js).
   ========================================================================= */
const B = { dir: store.get("wdSvcDir", ""), orte: null, list: null, err: "", busy: false, el: null };
const fmtDate = ms => ms ? new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " kB";
const baseName = p => String(p).split(/[\\/]/).filter(Boolean).pop() || p;

async function open(pfad) {
  APP.wdBrowse = false;
  if (!(await wdSvcOpen(pfad))) { APP.wdBrowse = true; renderAll(); }
}
async function load(dir) {
  B.busy = true; B.err = ""; paint();
  try {
    if (!B.orte) { const o = await wdSvc("orte"); B.orte = (o && o.orte) || []; }
    dir = String(dir || B.dir || (B.orte[0] && B.orte[0].pfad) || "").trim().replace(/^"(.*)"$/, "$1");   // „Als Pfad kopieren“ setzt Anführungszeichen
    if (dir) {
      const r = await wdSvc("liste?pfad=" + encodeURIComponent(dir));
      if (r && r.ok) {
        B.list = r; B.dir = r.pfad; store.set("wdSvcDir", r.pfad);
        if (r.datei) { B.busy = false; return open(r.datei); }      // Pfad einer Datei eingefügt → gleich öffnen
      } else B.err = (r && r.err) || "keine Antwort der Werkbank-.exe";
    }
  } catch (e) { B.err = e.message; }
  B.busy = false; paint();
}
const join = name => B.list.pfad + (B.list.pfad.endsWith(B.list.sep) ? "" : B.list.sep) + name;

function paint() {
  const el = B.el; if (!el || !document.body.contains(el)) return;
  el.innerHTML = "";
  el.appendChild(h("div", { class: "row" }, h("h3", { class: "grow", style: { margin: 0 } }, icon("folder"), "Wartungsdoku über die Werkbank-.exe öffnen"),
    btn(null, "close", () => { APP.wdBrowse = false; renderAll(); }, "subtle", "Schließen")));
  el.appendChild(h("div", { class: "muted small", style: { margin: "4px 0 10px" } },
    "Die .exe liest die Datei und schreibt jede Änderung direkt hinein – unabhängig vom Dateidialog des Browsers."));
  if (B.orte && B.orte.length) el.appendChild(h("div", { class: "row wdsvc-orte" }, B.orte.map(o =>
    h("button", { class: "btn sm" + (B.list && B.list.pfad === o.pfad ? " on" : ""), title: o.pfad, onclick: () => load(o.pfad) }, o.name))));
  const recent = store.get("wdSvcRecent", []);
  if (recent.length) el.appendChild(h("div", { class: "row small wdsvc-recent" }, h("span", { class: "muted" }, "Zuletzt:"),
    recent.map(p => h("a", { href: "#", title: p, onclick: e => { e.preventDefault(); open(p); } }, baseName(p)))));
  const inp = h("input", { class: "in grow", type: "text", spellcheck: false, placeholder: "Ordner oder Datei, z. B. C:\\Wartung (Pfad einfügen und Enter)", value: B.dir || "" });
  inp.addEventListener("keydown", e => { if (e.key === "Enter") load(inp.value); });
  el.appendChild(h("div", { class: "row", style: { marginTop: "10px" } },
    btn(null, "up", () => load(B.list.eltern), "", "Eine Ebene höher"), inp, btn("Anzeigen", "search", () => load(inp.value))));
  if (!(B.list && B.list.eltern)) el.querySelector("button[title='Eine Ebene höher']").disabled = true;
  if (B.err) el.appendChild(h("div", { class: "infobar err", style: { marginTop: "10px" } }, h("span", { class: "i" }, icon("error")), h("div", null, B.err)));
  if (B.busy && !B.list) { el.appendChild(h("div", { class: "muted small", style: { marginTop: "10px" } }, "Lese …")); return; }
  if (!B.list) return;
  const L = h("div", { class: "wdsvc-list" + (B.busy ? " busy" : "") });
  for (const d of B.list.dateien) L.appendChild(h("div", { class: "wdsvc-it file", title: "Öffnen und verknüpfen", onclick: () => open(join(d.name)) },
    icon("doc"), h("span", { class: "nm" }, d.name), h("span", { class: "muted small" }, fmtDate(d.mtime)), h("span", { class: "muted small sz" }, fmtSize(d.size))));
  for (const d of B.list.ordner) L.appendChild(h("div", { class: "wdsvc-it", onclick: () => load(join(d.name)) }, icon("folder"), h("span", { class: "nm" }, d.name)));
  if (!B.list.dateien.length && !B.list.ordner.length) L.appendChild(h("div", { class: "muted small", style: { padding: "10px" } }, "Dieser Ordner ist leer."));
  else if (!B.list.dateien.length) L.insertBefore(h("div", { class: "muted small", style: { padding: "6px 10px" } }, "Hier liegt keine .wtgml-Datei – Unterordner:"), L.firstChild);
  el.appendChild(L);
}

/* Karte für die Ansicht „Wartungsdoku“ */
export function wdSvcPanel() {
  B.el = h("div", { class: "card wdsvc" });
  setTimeout(() => { paint(); if (!B.list && !B.busy) load(""); }, 0);
  return B.el;
}
