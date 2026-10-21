import { go } from "../core/nav.js";
import { APP, byCid } from "../core/state.js";
import { VIEWS, WD_TABS } from "../core/ext.js";
import { safely } from "../core/registry.js";
import { $, $$, download, h, lazyAppend, natCmp, norm, trunc, uniq } from "../core/util.js";
import { decodeBytes } from "../core/load.js";
import { edgesIn, edgesOut, isOutputKind, pinOf } from "../model/model.js";
import { SEV_LABEL } from "../model/findings.js";
import { btn, chk, emptyState, findingsCount, flyout, icon, kindTag, lazySelectEl, pageHead, renderAll, searchBox, selectEl, sevIcon, stationLabel, toast } from "../shell/shell.js";
import { findingWhere, ignButton, ignFilterEl, ignPass, isIgnored, persistWhere, pref, setIgnored, setPref, whereLine } from "../core/persist.js";
import { pinCorrText, pinValue } from "../views/points.js";
import { liveInfo, livePinText } from "../core/live.js";
import { WTG_NS, ispXml, newGid, pinsOfGroup, regroupBy, setKlartext, wdModel } from "./generator.js";
import { assignPlant, plantOfNode } from "./anlagen.js";
import { FS_OK, WDOC, wDate, wDateFromInput, wDateToInput, wPersons, wPrueferDefault, wPrueferOf, wRenumber, wSetPruefer, wSnapshot, wUndo, wdocBauteile, wdocChanged, wdocInfo, wdocInsertIsp, wdocOpen, wdocPickAndLink, wdocSave, wdocStatus, wdocText, wkid, wkids, wset, wtxt } from "./wtgml.js";
import { LK_ON, artRemarkSuggestion, lkCentral, lkGoto, lkLinks, lkSplitTag, pinOnlyExternal, pinUnlinked } from "./link.js";

/* =========================================================================
   Ansicht: Wartungsdoku – Dokument bearbeiten, aus Sicherung übernehmen,
   Befunde als Mängel eintragen
   ========================================================================= */
/* Ergebnis-Werte wie im K&P-Wartungsprogramm */
const W_EXEC = [["", "–  offen"], ["Ja", "Ja"], ["Nein", "Nein"], ["Mangel", "Mangel"], ["nicht möglich", "nicht möglich"], ["nicht beauftragt", "nicht beauftragt"], ["kein Bedarf", "kein Bedarf"]];
const EX_CLASS = { "Ja": "ex-ja", "Mangel": "ex-mangel", "Nein": "ex-nein", "nicht möglich": "ex-nm", "nicht beauftragt": "ex-na", "kein Bedarf": "ex-na" };
const exClass = v => EX_CLASS[v] || (v ? "ex-na" : "");
export const wIsps = D => wdocBauteile(D).flatMap((b, bi) => wkids(b, "Isp").map((isp, ii) => ({ bte: b, bi, isp, ii })));
export const artName = a => (wtxt(a, "artKlartext") || wtxt(a, "artBezeichnung") || wtxt(a, "nummer")).trim();
export function artProp(a, desc) {
  const ic = wkid(a, "installationClass");
  return wkids(ic, "articleProperties").find(p => wtxt(p, "description") === desc) || null;
}
function jobStats(els) {
  const s = { ja: 0, mangel: 0, offen: 0, nein: 0, nm: 0, na: 0, done: 0, total: els.length };
  for (const j of els) {
    const e = wtxt(j, "executed");
    if (e === "Ja") s.ja++; else if (e === "Mangel") s.mangel++; else if (!e) s.offen++;
    else if (e === "Nein") s.nein++; else if (e === "nicht möglich") s.nm++; else s.na++;
  }
  s.done = s.total - s.offen;
  return s;
}
function rowExClass(jobs) {
  const ex = jobs.map(j => wtxt(j, "executed"));
  if (ex.includes("Mangel")) return "ex-mangel";
  if (ex.some(e => e === "Nein")) return "ex-nein";
  if (ex.some(e => e === "nicht möglich")) return "ex-nm";
  if (ex.length && ex.every(e => e === "Ja")) return "ex-ja";
  if (ex.length && ex.every(e => e)) return ex.some(e => e === "Ja") ? "ex-ja" : "ex-na";
  return "";
}
const facJobs = fac => wkids(fac, "Artikel").flatMap(a => wkids(a, "job"));
const ispJobs = isp => wkids(isp, "facility").flatMap(facJobs);
function statPills(s) {
  return [s.mangel ? h("span", { class: "pill err" }, s.mangel + " Mangel") : null, s.nein ? h("span", { class: "pill warn" }, s.nein + " Nein") : null,
    s.nm ? h("span", { class: "pill warn" }, s.nm + " nicht möglich") : null, s.offen ? h("span", { class: "pill" }, s.offen + " offen") : null,
    s.na ? h("span", { class: "pill" }, s.na + " entfällt") : null, s.ja ? h("span", { class: "pill ok" }, s.ja + " Ja") : null];
}
function setExecuted(D, art, job, val) {
  const date = D.date || wDate();
  if (!val) { wset(job, "executed", null); return; }
  wset(job, "executed", val);
  if (!wkid(job, "jobBemerkung")) { const sg = artRemarkSuggestion(art); wset(job, "jobBemerkung", sg ? sg.text : ""); }   // Vorschlag (z. B. „Nicht verknüpft“) geht mit
  if (!wkid(job, "pruefDatum")) wset(job, "pruefDatum", date);
  if (!wkid(art, "pruefDatum")) wset(art, "pruefDatum", date);
  const pid = wPrueferDefault(D);
  if (pid) { const p = wPersons(D).find(x => x.id === pid); if (p) wSetPruefer(art, p); }
}
function facZustandVorschlag(fac) {
  const lines = [];
  for (const a of wkids(fac, "Artikel")) for (const j of wkids(a, "job")) {
    const e = wtxt(j, "executed"), b = wtxt(j, "jobBemerkung").trim();
    if (e === "Mangel") lines.push(artName(a) + (b ? ": " + b : ": Mangel"));
    else if (e === "Nein" || e === "nicht möglich") lines.push(artName(a) + ": " + (b || "Prüfung " + e));
  }
  return "Anlage geprüft." + (lines.length ? "\n" + uniq(lines).join("\n") : " Funktion in Ordnung.");
}
/* ISP-Kommentar (<ispComment><title/><body/></ispComment>) – Gesamtzustand der ISP */
const ispComment = isp => wtxt(wkid(isp, "ispComment"), "body");
function setIspComment(isp, text) {
  let c = wkid(isp, "ispComment");
  if (!c) { c = wset(isp, "ispComment", ""); wset(c, "title", "Wartung"); }
  wset(c, "body", text);
}
function ispKommentarVorschlag(isp) {
  const lines = [];
  for (const f of wkids(isp, "facility")) {
    const s = jobStats(facJobs(f));
    if (s.mangel || s.nein || s.nm) lines.push(wtxt(f, "facBezeichnung").trim() + ": " + [s.mangel ? s.mangel + " Mangel" : "", s.nein ? s.nein + " Nein" : "", s.nm ? s.nm + " nicht möglich" : ""].filter(Boolean).join(", "));
  }
  return "Wartung durchgeführt." + (lines.length ? "\n" + lines.join("\n") : " Alle Anlagen in Ordnung.");
}
/* Bearbeitungsstand für die Leiste: offen (rot) · alles geprüft, Gesamtzustand fehlt (gelb) · fertig (grün) */
function facState(fac) {
  if (jobStats(facJobs(fac)).offen) return "open";
  return wtxt(fac, "facZustand").trim() ? "done" : "zust";
}
function ispState(isp) {
  const st = wkids(isp, "facility").map(facState);
  if (st.includes("open")) return "open";
  return st.includes("zust") || !ispComment(isp).trim() ? "zust" : "done";
}
const ST_TITLE = { open: "Noch nicht alles geprüft", zust: "Alles geprüft – Gesamtzustand fehlt noch", done: "Fertig: alles geprüft, Gesamtzustand eingetragen" };
const zustandBox = (label, value, placeholder, onInput, suggest) => {
  const zt = h("textarea", { class: "in", rows: 3, style: { fontFamily: "var(--font)", fontSize: "13px" }, placeholder }, value);
  zt.addEventListener("input", () => onInput(zt.value));
  return h("div", { class: "wd-zustand", style: { marginTop: "12px" } }, h("div", { class: "row", style: { marginBottom: "4px" } }, h("span", { class: "small muted grow" }, label),
    btn("Aus Prüfergebnissen vorschlagen", "doc", () => { zt.value = suggest(); onInput(zt.value); }, "sm subtle")), zt);
};

VIEWS.add({
  id: "wartung", label: "Wartungsdoku", icon: "doc", group: 2, order: 210,
  badge: () => WDOC.cur ? [{ n: WDOC.cur.writable ? "verknüpft" : "WTGML", cls: WDOC.cur.dirty ? "warn" : "soft", title: WDOC.cur.name + (WDOC.cur.dirty ? " – ungespeichert" : "") }] : null,
  scrollKey: () => "wartung|" + (APP.wdTab || "") + "|" + (WDOC.cur ? WDOC.cur.name : ""),
  render(root, C0, opts) {
    const D = WDOC.cur;
    if (opts.tab) APP.wdTab = opts.tab;
    if (!APP.wdTab) APP.wdTab = D ? "doc" : "gen";
    const inp = h("input", { type: "file", id: "wdIn", accept: ".wtgml,.xml", hidden: true });
    inp.addEventListener("change", async () => {
      const f = inp.files[0]; if (!f) return;
      try { wdocOpen(decodeBytes(new Uint8Array(await f.arrayBuffer())), f.name, null); toast("Geöffnet: " + f.name + " – Speichern lädt eine neue Datei herunter.", "ok"); APP.wdTab = "doc"; }
      catch (e) { toast(e.message, "err", 6000); }
      renderAll();
    });
    root.appendChild(inp);
    const info = D ? wdocInfo(D) : null;
    root.appendChild(pageHead("Wartungsdoku", info ? [info.svc, info.prj, info.cust, info.obj].filter(Boolean).join("  ·  ") : "WTGML-Wartungsdokumentation öffnen, aus der Sicherung füllen und direkt bearbeiten", [
      btn(D ? "Andere öffnen" : "Wartungsdoku öffnen", "folder", () => wdocPickAndLink(), D ? "" : "accent"),
      D ? btn("Speichern", "download", () => wdocSave(D), D.dirty ? "accent" : "", "Strg+S") : null,
      D && D.writable ? btn(null, "copy", () => download(D.name.replace(/\.wtgml$/i, "") + "_kopie.wtgml", wdocText(D), "application/xml;charset=utf-8"), "", "Kopie herunterladen") : null]));
    if (D) root.appendChild(h("div", { style: { padding: "0 32px 10px" } }, h("div", { id: "wdStatus", class: "infobar" })));
    if (!WD_TABS.get(APP.wdTab)) APP.wdTab = D ? "doc" : "gen";
    root.appendChild(h("div", { class: "pivot" }, WD_TABS.list().map(T => {
      const b = D && T.badge ? safely("Reiter " + T.id, () => T.badge(D), null) : null;
      return h("button", { class: APP.wdTab === T.id ? "on" : "", "data-tab": T.id, onclick: () => { APP.wdTab = T.id; renderAll(); } }, icon(T.icon), T.label,
        b && b.n ? h("span", { class: "badge " + (b.cls || "soft"), style: { marginLeft: "6px" }, title: b.title || null }, b.n) : null);
    })));
    const body = h("div", { class: "page-body", style: { paddingTop: "16px" } });
    root.appendChild(body);
    if (D) wdocStatus();
    const T = WD_TABS.get(APP.wdTab);
    if (T.needsDoc && !D) return wdNoDoc(body);
    if (D && T.fill && T.fill(D)) body.classList.add("fill");
    return T.render(body, D);
  }
});

/* ---------- Reiter (Verknüpfung und Zu-/Abluft melden sich in link.js / air.js an) ---------- */
WD_TABS.add({ id: "doc", label: "Dokument", icon: "doc", order: 10, needsDoc: true, fill: () => true, render: (body, D) => wdDocTab(body, D) });
WD_TABS.add({ id: "gen", label: "Aus Sicherung übernehmen", icon: "upload", order: 40, render: (body, D) => wdGenTab(body, D) });
WD_TABS.add({ id: "mangel", label: "Befunde als Mängel", icon: "alert", order: 50, needsDoc: true, render: (body, D) => wdMangelTab(body, D) });

function wdNoDoc(body) {
  body.appendChild(h("div", { class: "card", style: { maxWidth: "860px" } },
    h("div", { class: "station" }, h("div", { class: "ic" }, icon("doc")),
      h("div", null, h("div", { class: "nm" }, "Wartungsdoku verknüpfen"),
        h("div", { class: "meta", style: { fontSize: "13px", marginTop: "4px" } },
          "Die .wtgml-Datei aus dem Wartungsprogramm öffnen – leer oder schon ausgefüllt. Danach schreibt die Werkbank jede Änderung direkt in diese Datei zurück: neue ISP aus der Sicherung, Prüfergebnisse, Bemerkungen, Mängel. Kein Herunterladen, kein Umbenennen."))),
    h("div", { class: "row", style: { marginTop: "14px" } }, btn("Wartungsdoku öffnen", "folder", () => wdocPickAndLink(), "accent")),
    FS_OK() ? null : h("div", { class: "infobar warn", style: { marginTop: "14px" } }, icon("alert"), h("div", { class: "small" }, "Dieser Browser kann Dateien nicht direkt zurückschreiben. In Microsoft Edge oder Google Chrome öffnen – hier wird beim Speichern eine neue Datei heruntergeladen."))));
}

/* ======================= Tab: Dokument ======================= */
function wMoveArts(D, arts, toFac) {
  if (!arts.length || !toFac) return;
  wSnapshot(D);
  const isps = new Set();
  for (const a of arts) { isps.add(a.parentElement.parentElement); toFac.appendChild(a); }
  isps.add(toFac.parentElement);
  isps.forEach(wRenumber);
  D.pick = null; wdocChanged(D);
  toast(arts.length + (arts.length === 1 ? " Datenpunkt" : " Datenpunkte") + " nach „" + wtxt(toFac, "facBezeichnung") + "“ verschoben.", "ok", 2500);
}
function wDeleteArts(D, arts) {
  if (!arts.length) return;
  wSnapshot(D);
  const isps = new Set(arts.map(a => a.parentElement.parentElement));
  arts.forEach(a => a.remove());
  isps.forEach(wRenumber);
  D.pick = null; wdocChanged(D);
  toast(arts.length + (arts.length === 1 ? " Datenpunkt" : " Datenpunkte") + " gelöscht – Strg+Z macht es rückgängig.", "ok", 3500);
}
function wNewFacility(D, isp, name, after) {
  const f = D.doc.createElementNS(WTG_NS, "facility");
  wset(f, "facBezeichnung", name || "Neue Anlage");
  isp.insertBefore(f, after ? after.nextElementSibling : null);
  wRenumber(isp);
  return f;
}
function wdDocTab(body, D) {
  if (!D.date) D.date = wDate();
  const isps = wIsps(D);
  if (!D.sel || !D.doc.contains(D.sel)) D.sel = isps.length ? (wkids(isps[0].isp, "facility")[0] || isps[0].isp) : null;
  D.pick = D.pick && D.sel ? new Set([...D.pick].filter(a => D.sel.localName === "facility" ? a.parentElement === D.sel : a.parentElement && a.parentElement.parentElement === D.sel)) : new Set();
  const persons = wPersons(D);
  const pid = wPrueferDefault(D);
  const split = h("div", { class: "split card tight", style: { minHeight: "420px", alignItems: "stretch" } });
  body.appendChild(split);
  const rail = h("div", { class: "rail", style: { width: "300px" } });
  split.appendChild(rail);
  const main = h("div", { class: "center wd-main", style: { padding: "16px 20px", overflow: "auto" } });
  split.appendChild(main);
  if (D._lastSel !== D.sel) main.dataset.noRestore = "1";
  D._lastSel = D.sel;
  /* Farben der Leiste nachziehen, ohne neu aufzubauen (Eingabe behält den Fokus) */
  const refreshRail = () => { for (const it of rail.children) if (it._wel) { const st = it._wel.localName === "Isp" ? ispState(it._wel) : facState(it._wel); if (!it.classList.contains("st-" + st)) { it.classList.remove("st-open", "st-zust", "st-done"); it.classList.add("st-" + st); it.title = it.title.replace(/^[^\n(]*/, ST_TITLE[st] + " "); } } };
  const changed = () => { wdocChanged(D); refreshRail(); };
  const rerender = () => renderAll();

  /* Kopf der Leiste: Prüfdatum + geprüft durch */
  const dateIn = h("input", { type: "date", class: "in sm", value: wDateToInput(D.date), style: { width: "100%" } });
  dateIn.addEventListener("change", () => { D.date = wDateFromInput(dateIn.value) || wDate(); });
  const prSel = selectEl([["", "– bitte wählen –"], ...persons.map(p => [p.id, p.name + (p.rel && p.rel !== "Mitarbeiter" ? " (" + p.rel + ")" : "")])], pid, v => {
    D.pruefer = v; const p = persons.find(x => x.id === v);
    setPref("wdPruefer", p ? { name: p.name, email: p.email } : null);
    renderAll();
  }, "sm");
  prSel.style.width = "100%";
  rail.appendChild(h("div", { style: { padding: "10px 10px 6px", display: "grid", gridTemplateColumns: "92px 1fr", gap: "6px 8px", alignItems: "center", fontSize: "12px" } },
    h("span", { class: "muted" }, "Prüfdatum"), dateIn,
    h("span", { class: "muted" }, "Geprüft durch"), prSel));
  if (!pid && persons.length) rail.appendChild(h("div", { class: "infobar warn", style: { margin: "4px 8px 8px", padding: "8px 10px" } }, icon("alert"), h("div", { class: "small" }, "Bitte auswählen, wer prüft – wird bei jedem Ergebnis als „geprüft durch“ eingetragen.")));
  if (!persons.length) rail.appendChild(h("div", { class: "small faint", style: { padding: "0 12px 8px" } }, "Im Dokument sind keine Projektbeteiligten hinterlegt."));

  for (const b of wdocBauteile(D)) {
    rail.appendChild(h("div", { class: "rail-head" }, icon("station"), " ", wtxt(b, "bteBezeichnung") || "Einbauort"));
    const ilist = wkids(b, "Isp");
    if (!ilist.length) rail.appendChild(h("div", { class: "small faint", style: { padding: "2px 12px 8px" } }, "Noch keine ISP – im Tab „Aus Sicherung übernehmen“ einfügen."));
    for (const isp of ilist) {
      const s = jobStats(ispJobs(isp)), ist = ispState(isp);
      const iit = h("div", { class: "rail-item st-" + ist + (D.sel === isp ? " on" : ""), title: ST_TITLE[ist] + " (ISP-Kommentar und Gesamtzustand aller Anlagen)", onclick: () => { D.sel = isp; rerender(); } },
        h("div", { class: "lbl" }, h("b", null, wtxt(isp, "ispBezeichnung").trim() || "ISP"), h("small", null, wkids(isp, "facility").length + " Anlagen · " + s.done + "/" + s.total + " bearbeitet")),
        s.mangel ? h("span", { class: "badge err" }, s.mangel) : null);
      iit._wel = isp;
      rail.appendChild(iit);
      for (const fac of wkids(isp, "facility")) {
        const fs = jobStats(facJobs(fac));
        const done = fs.offen === 0 && fs.total > 0;
        const dot = fs.mangel ? "err" : fs.nein || fs.nm ? "warn" : done ? "ok" : "info";
        const fst = facState(fac);
        const it = h("div", { class: "rail-item st-" + fst + (D.sel === fac ? " on" : ""), style: { paddingLeft: "26px" }, title: ST_TITLE[fst] + "\nHierher ziehen, um Datenpunkte in diese Anlage zu verschieben", onclick: () => { D.sel = fac; rerender(); } },
          h("span", { class: "sevdot " + dot, title: fs.done + " von " + fs.total + " Prüfungen bearbeitet" }),
          h("div", { class: "lbl" }, wtxt(fac, "facBezeichnung") || "Anlage"), h("span", { class: "cnt" }, wkids(fac, "Artikel").length));
        it._wel = fac;
        it.addEventListener("dragover", e => { if (D.drag && D.drag.length && D.drag[0].parentElement !== fac && D.drag[0].parentElement.parentElement === isp) { e.preventDefault(); it.classList.add("drop"); } });
        it.addEventListener("dragleave", () => it.classList.remove("drop"));
        it.addEventListener("drop", e => { e.preventDefault(); it.classList.remove("drop"); const arts = D.drag || []; D.drag = null; wMoveArts(D, arts, fac); rerender(); });
        rail.appendChild(it);
      }
    }
  }
  /* gewählte Anlage in der Leiste sichtbar halten (z. B. nach einem Sprung aus den Datenpunkten) */
  requestAnimationFrame(() => {
    const on = rail.querySelector(".rail-item.on"); if (!on || !document.body.contains(rail)) return;
    const r = rail.getBoundingClientRect(), o = on.getBoundingClientRect();
    if (o.top < r.top || o.bottom > r.bottom) rail.scrollTop += o.top - r.top - (rail.clientHeight - on.offsetHeight) / 2;
  });
  if (!D.sel) { main.appendChild(emptyState("doc", "Keine ISP im Dokument", "Im Tab „Aus Sicherung übernehmen“ die Datenpunkte einer Station einfügen.")); return; }
  const undoBtn = D.undo && D.undo.length ? btn("Rückgängig", "left", () => { wUndo(D); rerender(); }, "subtle", "Letzte Änderung an der Struktur zurücknehmen (Strg+Z)") : null;
  const prPerson = persons.find(p => p.id === pid);

  /* ---------- ISP ---------- */
  if (D.sel.localName === "Isp") {
    const isp = D.sel;
    const nm = h("input", { class: "in", value: wtxt(isp, "ispBezeichnung"), style: { width: "360px" } });
    nm.addEventListener("change", () => { wset(isp, "ispBezeichnung", nm.value); changed(); rerender(); });
    const s = jobStats(ispJobs(isp));
    const allArts = wkids(isp, "facility").flatMap(f => wkids(f, "Artikel"));
    const checked = allArts.filter(a => wkids(a, "job").some(j => wtxt(j, "executed")));
    void checked;
    const ispMode = pref("wdIspMode", "anl");
    const modeSeg = h("div", { class: "seg" }, [["anl", "Anlagen"], ["alle", "Alle Datenpunkte"]].map(([k, l]) =>
      h("button", { class: ispMode === k ? "on" : "", title: k === "alle" ? "Alle Datenpunkte der untergeordneten Anlagen in einer Liste" : "Übersicht der Anlagen", onclick: () => { setPref("wdIspMode", k); rerender(); } }, l)));
    main.appendChild(h("div", { class: "row" }, h("h3", { style: { margin: 0 } }, "ISP"), nm, ...statPills(s), modeSeg, h("span", { class: "grow" }), undoBtn,
      btn(null, "trash", () => { if (confirm("ISP „" + wtxt(isp, "ispBezeichnung").trim() + "“ mit allen Anlagen aus der Wartungsdoku löschen?")) { wSnapshot(D); isp.remove(); D.sel = null; changed(); rerender(); } }, "subtle", "ISP löschen")));
    main.appendChild(h("div", { class: "row", style: { marginTop: "12px" } },
      btn("Alle offenen Prüfungen: Ja", "check", () => { for (const a of allArts) for (const j of wkids(a, "job")) if (!wtxt(j, "executed")) setExecuted(D, a, j, "Ja"); changed(); rerender(); }),
      btn("Gesamtzustand ausfüllen", "doc", () => { for (const f of wkids(isp, "facility")) if (!wtxt(f, "facZustand").trim()) wset(f, "facZustand", facZustandVorschlag(f)); changed(); rerender(); }, "", "Leere Gesamtzustände der Anlagen aus den Prüfergebnissen vorschlagen"),
      prPerson ? btn("„Geprüft durch " + prPerson.name + "“ bei allen geprüften Datenpunkten", "check", () => { checked.forEach(a => wSetPruefer(a, prPerson)); changed(); toast(checked.length + " Datenpunkte: geprüft durch " + prPerson.name, "ok"); rerender(); }) : null,
      btn("Anlage hinzufügen", "plus", () => { const name = prompt("Name der neuen Anlage:", "Neue Anlage"); if (name == null) return; wSnapshot(D); D.sel = wNewFacility(D, isp, name.trim() || "Neue Anlage"); changed(); rerender(); })));
    main.appendChild(zustandBox("Gesamtzustand der ISP (ISP-Kommentar)", ispComment(isp), "Kommentar zur ISP, z. B. „Wartung durchgeführt. Alle Anlagen in Ordnung.“",
      v => { setIspComment(isp, v); changed(); }, () => ispKommentarVorschlag(isp)));
    if (ispMode === "alle") {
      wdArtTable(main, D, { isp, arts: allArts, persons, rerender, changed, multi: true });
      return;
    }
    const facs = wkids(isp, "facility");
    const t = h("table", { class: "grid card-t" });
    t.appendChild(h("thead", null, h("tr", null, h("th", null, "Anlage"), h("th", { class: "num" }, "Datenpunkte"), h("th", null, "Prüfungen"), h("th", null, "Gesamtzustand"), h("th", { style: { width: "110px" } }))));
    const tb = h("tbody");
    facs.forEach((f, i) => tb.appendChild(h("tr", null,
      h("td", null, h("a", { onclick: () => { D.sel = f; rerender(); } }, wtxt(f, "facBezeichnung") || "Anlage")), h("td", { class: "num" }, String(wkids(f, "Artikel").length)),
      h("td", null, h("span", { class: "row" }, ...statPills(jobStats(facJobs(f))))), h("td", { class: "small muted" }, trunc(wtxt(f, "facZustand").replace(/\n/g, " · "), 80)),
      h("td", { class: "nowrap" },
        btn(null, "up", () => { wSnapshot(D); isp.insertBefore(f, facs[i - 1]); wRenumber(isp); changed(); rerender(); }, "subtle sm", "nach oben"),
        btn(null, "down", () => { wSnapshot(D); isp.insertBefore(f, facs[i + 1].nextElementSibling); wRenumber(isp); changed(); rerender(); }, "subtle sm", "nach unten"),
        btn(null, "trash", () => { const n = wkids(f, "Artikel").length; if (n && !confirm("Anlage „" + wtxt(f, "facBezeichnung") + "“ mit " + n + " Datenpunkten löschen?")) return; wSnapshot(D); f.remove(); wRenumber(isp); changed(); rerender(); }, "subtle sm", "Anlage löschen")))));
    $$("tr", tb).forEach((tr, i) => { const bs = $$("button", tr); if (i === 0) bs[0].disabled = true; if (i === facs.length - 1) bs[1].disabled = true; });
    t.appendChild(tb);
    main.appendChild(h("div", { class: "card tight", style: { marginTop: "14px" } }, t));
    return;
  }

  /* ---------- Anlage (facility) ---------- */
  const fac = D.sel, isp = fac.parentElement;
  const facs = wkids(isp, "facility");
  const nm = h("input", { class: "in", value: wtxt(fac, "facBezeichnung"), style: { width: "340px", fontWeight: 600 } });
  nm.addEventListener("change", () => { wset(fac, "facBezeichnung", nm.value); changed(); rerender(); });
  const s = jobStats(facJobs(fac));
  const fi = facs.indexOf(fac);
  main.appendChild(h("div", { class: "row" }, nm, ...statPills(s), h("span", { class: "grow" }), undoBtn,
    btn("Alle offenen: Ja", "check", () => { for (const a of wkids(fac, "Artikel")) for (const j of wkids(a, "job")) if (!wtxt(j, "executed")) setExecuted(D, a, j, "Ja"); changed(); rerender(); }, "", "Alle noch offenen Prüfungen dieser Anlage als durchgeführt (Ja) markieren"),
    btn(null, "up", () => { wSnapshot(D); isp.insertBefore(fac, facs[fi - 1]); wRenumber(isp); changed(); rerender(); }, "subtle" + (fi === 0 ? " dis" : ""), "Anlage nach oben"),
    btn(null, "down", () => { wSnapshot(D); isp.insertBefore(fac, facs[fi + 1] ? facs[fi + 1].nextElementSibling : null); wRenumber(isp); changed(); rerender(); }, "subtle" + (fi === facs.length - 1 ? " dis" : ""), "Anlage nach unten"),
    btn(null, "trash", () => { const n = wkids(fac, "Artikel").length; if (n && !confirm("Anlage „" + wtxt(fac, "facBezeichnung") + "“ mit " + n + " Datenpunkten löschen?")) return; wSnapshot(D); fac.remove(); wRenumber(isp); D.sel = isp; changed(); rerender(); }, "subtle", "Anlage löschen")));
  $$(".dis", main).forEach(b => b.disabled = true);
  main.appendChild(zustandBox("Gesamtzustand", wtxt(fac, "facZustand"), "Gesamtzustand, z. B. „Anlage geprüft. Funktion in Ordnung.“",
    v => { wset(fac, "facZustand", v); changed(); }, () => facZustandVorschlag(fac)));

  wdArtTable(main, D, { isp, arts: wkids(fac, "Artikel"), persons, rerender, changed, multi: false });
  main.appendChild(h("div", { class: "small muted", style: { marginTop: "10px" } }, "Datenpunkte verschieben: Zeile links auf eine Anlage ziehen, über ☰ in der Zeile oder mehrere anhaken und „Verschieben nach“ wählen. Strg+Z macht Verschieben und Löschen rückgängig."));
}

/* ---------- Sortierung der Datenpunkte (nur Anzeige; auf Wunsch fest übernehmen) ---------- */
const WD_SORTS = [["doc", "Reihenfolge der Doku"], ["klemme", "Klemme (Modul / Pin)"], ["art", "Art (AE · AA · BE · BA)"], ["name", "Name A–Z"], ["offen", "Offene zuerst"]];
const WD_KIND_ORD = { AE: 0, AA: 1, BE: 2, BA: 3 };
const artKindOf = a => { const nr = wtxt(a, "nummer"); return nr.startsWith("#") ? nr.slice(1) : ""; };
function artKlemmeKey(a, isp) {
  const l = APP.centrals.length ? pinForArt(a, isp) : null;
  if (l && LK_ON.has(l.st)) return "0|" + l.p.klemme + "|" + l.C.meta.name;
  const inf = artProp(a, "Info"), m = /(\d{3}\/[A-Z]+\.\d+)/.exec(inf ? wtxt(inf, "value") : "");
  return m ? "0|" + m[1] : "1|";
}
function wdSortArts(arts, isp, key) {
  const idx = new Map(arts.map((a, i) => [a, i]));
  const K = {
    klemme: a => artKlemmeKey(a, isp),
    art: a => (WD_KIND_ORD[artKindOf(a)] ?? 9) + "|" + artKlemmeKey(a, isp),
    name: a => artName(a).toLowerCase(),
    offen: a => { const st = jobStats(wkids(a, "job")); return String(st.offen ? 0 : st.mangel ? 1 : st.nein || st.nm ? 2 : 3); }
  }[key];
  if (!K) return arts.slice();
  const kv = new Map(arts.map(a => [a, K(a)]));
  return arts.slice().sort((x, y) => natCmp(kv.get(x), kv.get(y)) || idx.get(x) - idx.get(y));
}

/* ---------- Tabelle der Datenpunkte: eine Anlage oder alle Anlagen einer ISP ---------- */
function wdArtTable(main, D, ctx) {
  const { isp, persons, rerender, changed, multi } = ctx;
  const all = ctx.arts;
  const facs = wkids(isp, "facility");
  const facOf = a => a.parentElement;
  const sortKey = WD_SORTS.some(x => x[0] === pref("wdSort", "doc")) ? pref("wdSort", "doc") : "doc";
  const group = multi && pref("wdGroup", true) !== false;

  /* Auswahl-Leiste */
  const pickBar = h("div", { class: "pickbar" });
  const facOpts = list => [["", "Verschieben nach …"], ...facs.filter(f => !list.every(a => facOf(a) === f)).map(f => [String(facs.indexOf(f)), wtxt(f, "facBezeichnung") || "Anlage"]), ["new", "+ neue Anlage …"]];
  const moveTo = (list, v) => {
    if (v === "new") { const name = prompt("Name der neuen Anlage:", "Neue Anlage"); if (name == null) return; const keep = D.sel; wSnapshot(D); const nf = wNewFacility(D, isp, name.trim() || "Neue Anlage", facOf(list[0])); D.undo.pop(); wMoveArts(D, list, nf); D.sel = keep; rerender(); return; }
    const to = facs[parseInt(v, 10)]; if (to) { wMoveArts(D, list, to); rerender(); }
  };
  const drawPick = () => {
    pickBar.innerHTML = "";
    const list = all.filter(a => D.pick.has(a));
    pickBar.hidden = !list.length;
    if (!list.length) return;
    pickBar.appendChild(h("b", null, list.length + " ausgewählt"));
    pickBar.appendChild(selectEl(facOpts(list), "", v => moveTo(list, v), "sm"));
    pickBar.appendChild(btn("Löschen", "trash", () => { if (confirm(list.length + " Datenpunkt(e) aus der Wartungsdoku löschen?")) { wDeleteArts(D, list); rerender(); } }, "sm"));
    pickBar.appendChild(btn("Auswahl aufheben", null, () => { D.pick.clear(); rerender(); }, "sm subtle"));
  };

  /* Sortierung */
  const sortLabel = (WD_SORTS.find(x => x[0] === sortKey) || WD_SORTS[0])[1];
  const applySort = () => {
    if (!confirm("Datenpunkte " + (multi ? "in jeder Anlage " : "") + "nach „" + sortLabel + "“ fest in der Wartungsdoku sortieren?\nSo stehen sie dann auch im Ausdruck. Strg+Z macht es rückgängig.")) return;
    wSnapshot(D);
    for (const f of (multi ? facs : [...new Set(all.map(facOf))])) for (const a of wdSortArts(wkids(f, "Artikel"), isp, sortKey)) f.appendChild(a);
    wRenumber(isp); changed(); setPref("wdSort", "doc");
    toast("Reihenfolge übernommen – „" + sortLabel + "“.", "ok", 2500);
    rerender();
  };
  const grpCb = multi ? h("input", { type: "checkbox", checked: group }) : null;
  if (grpCb) grpCb.addEventListener("change", () => { setPref("wdGroup", grpCb.checked); rerender(); });
  main.appendChild(h("div", { class: "row wd-tools" }, pickBar, h("span", { class: "grow" }),
    multi ? h("label", { class: "chk small", title: "Zwischenüberschrift je Anlage" }, grpCb, " nach Anlage gruppieren") : null,
    h("span", { class: "small muted" }, "Sortieren"),
    selectEl(WD_SORTS, sortKey, v => { setPref("wdSort", v); rerender(); }, "sm"),
    sortKey !== "doc" ? btn("Reihenfolge übernehmen", "check", applySort, "sm subtle", "Die angezeigte Reihenfolge fest in die Wartungsdoku schreiben") : null));

  const tbl = h("table", { class: "grid wdoc", style: { marginTop: "10px" } });
  const allCb = h("input", { type: "checkbox", checked: all.length && all.every(a => D.pick.has(a)) });
  allCb.addEventListener("change", () => { all.forEach(a => allCb.checked ? D.pick.add(a) : D.pick.delete(a)); rerender(); });
  tbl.appendChild(h("thead", null, h("tr", null, h("th", { style: { width: "34px" } }, h("label", { class: "chk" }, allCb)), h("th", { style: { width: "56px" } }, "Art"), h("th", null, "Klartext / Prüfung"),
    h("th", { style: { width: "118px" } }, "Ergebnis"), h("th", null, "Bemerkung"), h("th", { style: { width: "130px" } }, "Prüfdatum"), h("th", { style: { width: "158px" } }, "Geprüft durch"), h("th", { style: { width: "40px" } }))));
  const tb = h("tbody");
  let flashRow = null;
  const prCell = a => {
    const cur = wPrueferOf(a);
    const short = p => { const v = wtxt(p.el, "vorname"), n = wtxt(p.el, "nachname"); return v && n ? v[0] + ". " + n : p.name; };
    const opts = [["", "–"], ...persons.map(p => [p.id, short(p)])];
    if (cur && !persons.some(p => p.id === cur)) { const m = wkid(a, "mitarbeiter"); opts.push([cur, [wtxt(m, "vorname"), wtxt(m, "nachname")].join(" ").trim() || "?"]); }
    const sel = selectEl(opts, cur, v => { if (!v) wSetPruefer(a, null); else { const p = persons.find(x => x.id === v); if (p) wSetPruefer(a, p); } changed(); }, "sm");
    sel.style.width = "100%";
    return h("td", null, sel);
  };
  const rowMenu = a => btn(null, "menu", e => {
    const fac = facOf(a), fa = wkids(fac, "Artikel"), i = fa.indexOf(a);
    flyout(e.currentTarget, [
      { head: "Verschieben nach" },
      ...facs.filter(f => f !== fac).map(f => ({ label: wtxt(f, "facBezeichnung") || "Anlage", icon: "right", run: () => { wMoveArts(D, [a], f); rerender(); } })),
      { label: "neue Anlage …", icon: "plus", run: () => moveTo([a], "new") },
      "-",
      sortKey === "doc" && i > 0 ? { label: "Nach oben", icon: "up", run: () => { wSnapshot(D); fac.insertBefore(a, fa[i - 1]); wRenumber(isp); changed(); rerender(); } } : null,
      sortKey === "doc" && i < fa.length - 1 ? { label: "Nach unten", icon: "down", run: () => { wSnapshot(D); fac.insertBefore(a, fa[i + 1].nextElementSibling); wRenumber(isp); changed(); rerender(); } } : null,
      "-",
      { label: "Datenpunkt löschen", icon: "trash", run: () => { wDeleteArts(D, [a]); rerender(); } }
    ].filter(Boolean));
  }, "subtle sm", "Verschieben, sortieren, löschen");

  const addRow = a => {
    const jobs = wkids(a, "job");
    const nr = wtxt(a, "nummer");
    const infoP = artProp(a, "Info");
    const cb = h("input", { type: "checkbox", checked: D.pick.has(a) });
    cb.addEventListener("change", () => { cb.checked ? D.pick.add(a) : D.pick.delete(a); drawPick(); });
    const kt = h("input", { class: "in sm", value: wtxt(a, "artKlartext") || "", placeholder: wtxt(a, "artBezeichnung"), style: { width: "100%" } });
    kt.addEventListener("change", () => { wset(a, "artKlartext", kt.value); changed(); });
    const link = pinForArt(a, isp);
    const on = link && LK_ON.has(link.st);
    const infoTxt = infoP && wtxt(infoP, "value") ? wtxt(infoP, "value") : "";
    const hasC = APP.centrals.length && /^#/.test(nr) && centralForIsp(isp);
    const unl = on ? pinUnlinked(link.p) : null, ext = on && !unl ? pinOnlyExternal(link.p) : null;
    const head = h("td", null, kt, h("span", { class: "sub artsub" }, h("span", { class: "artsub-l" },
      multi && !group ? [h("span", { class: "facchip", title: "Anlage" }, wtxt(facOf(a), "facBezeichnung") || "Anlage"), " "] : null,
      wtxt(a, "artBezeichnung"),
      on ? [" · ", h("a", { class: "klink", title: "In der Datenpunktliste zeigen" + (APP.centrals.length > 1 ? " (" + stationLabel(link.C) + ")" : "") + (link.st === "sicher" ? " – erkannt, noch nicht ins Info-Feld eingetragen" : ""), onclick: e => { e.stopPropagation(); jumpToPin(link.C, link.p); } }, icon("jump"), (infoTxt && /Klemme/.test(infoTxt) ? infoTxt : "Klemme " + link.p.klemme)),
          link.st === "sicher" ? h("span", { class: "lk-mark", title: "Erkannt, noch nicht eingetragen – im Tab „Verknüpfung“ eintragen" }, "≈") : null,
          unl ? h("span", { class: "nolink", title: unl }, " · nicht verknüpft") : null,
          ext ? h("span", { class: "extlink", title: ext.why }, " · " + ext.text) : null]
        : link ? [" · ", h("a", { class: "klink lk-sug", title: "Vorschlag – im Tab „Verknüpfung“ prüfen", onclick: e => { e.stopPropagation(); lkGoto(D, isp, a); } }, icon("swap"), "Klemme " + link.p.klemme + "?")]
        : hasC && (lkLinks(D, isp).arts.get(a) || {}).st === "keine" ? [infoTxt ? " · " + infoTxt : null, " · ", h("a", { class: "klink lk-sug", title: "Keine Klemme erkannt – im Tab „Verknüpfung“ zuordnen", onclick: e => { e.stopPropagation(); lkGoto(D, isp, a); } }, icon("swap"), "zuordnen")]
        : infoTxt ? " · " + infoTxt : null), on ? artValueChip(link.C, link.p) : null));
    const jobCells = j => {
      const cur = wtxt(j, "executed");
      const ex = h("select", { class: "in sm exsel " + exClass(cur) });
      for (const [v, l] of W_EXEC) ex.appendChild(h("option", { value: v }, l));
      if (cur && !W_EXEC.some(x => x[0] === cur)) ex.appendChild(h("option", { value: cur }, cur));
      ex.value = cur;
      const sgB = !wkid(j, "jobBemerkung") ? artRemarkSuggestion(a) : null;
      const bm = h("input", { class: "in sm" + (sgB ? " sugg" : ""), value: sgB ? sgB.text : wtxt(j, "jobBemerkung"), placeholder: "Bemerkung", style: { width: "100%" },
        title: sgB ? "Vorschlag: " + sgB.why + ". Wird mit dem Ergebnis eingetragen – löschen, wenn nicht gewünscht." : null });
      const dt = h("input", { type: "date", class: "in sm", value: wDateToInput(wtxt(j, "pruefDatum")) });
      ex.addEventListener("change", () => { setExecuted(D, a, j, ex.value); changed(); rerender(); });
      bm.addEventListener("input", () => { if (!wkid(j, "jobBemerkung") && !bm.value && !sgB) return; wset(j, "jobBemerkung", bm.value); bm.classList.remove("sugg"); bm.title = ""; changed(); });
      dt.addEventListener("change", () => { wset(j, "pruefDatum", wDateFromInput(dt.value)); changed(); });
      return [h("td", null, ex), h("td", null, bm), h("td", null, dt)];
    };
    const tag = nr.startsWith("#") ? kindTag(nr.slice(1)) : h("span", { class: "mono small" }, nr);
    let tr;
    if (jobs.length === 1) {
      tr = h("tr", { class: (D.pick.has(a) ? "on " : "") + exClass(wtxt(jobs[0], "executed")) }, h("td", null, h("label", { class: "chk" }, cb)), h("td", { class: "grip-cell", title: "Ziehen: auf eine Anlage links ablegen" }, tag), head, ...jobCells(jobs[0]), prCell(a), h("td", null, rowMenu(a)));
      tb.appendChild(tr);
    } else {
      const js = jobStats(jobs);
      const open = !!(D.openArt && D.openArt.has(a));
      tr = h("tr", { class: (D.pick.has(a) ? "on " : "") + rowExClass(jobs) }, h("td", null, h("label", { class: "chk" }, cb)), h("td", { class: "grip-cell" }, tag), head,
        h("td", { colspan: 3 }, h("span", { class: "row" },
          btn(jobs.length + " Arbeiten", open ? "chevd" : "chev", () => { D.openArt = D.openArt || new Set(); open ? D.openArt.delete(a) : D.openArt.add(a); rerender(); }, "sm subtle"),
          ...statPills(js),
          js.offen ? btn("offene: Ja", "check", () => { for (const j of jobs) if (!wtxt(j, "executed")) setExecuted(D, a, j, "Ja"); changed(); rerender(); }, "sm subtle") : null)),
        prCell(a), h("td", null, rowMenu(a)));
      tb.appendChild(tr);
      if (open) for (const j of jobs) tb.appendChild(h("tr", { class: "subjob " + exClass(wtxt(j, "executed")) }, h("td"), h("td"), h("td", { class: "small", style: { paddingLeft: "22px" } }, wtxt(j, "jobDescription")), ...jobCells(j), h("td"), h("td")));
    }
    tr.draggable = true;
    if (D.flashArt === a) flashRow = tr;
    tr.addEventListener("dragstart", e => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); return; }
      D.drag = D.pick.has(a) ? all.filter(x => D.pick.has(x)) : [a];
      e.dataTransfer.setData("text/plain", artName(a)); e.dataTransfer.effectAllowed = "move";
    });
    tr.addEventListener("dragend", () => { setTimeout(() => { D.drag = null; }, 0); });
  };

  if (group) {
    for (const f of facs) {
      const fa = all.filter(a => facOf(a) === f);
      if (!fa.length) continue;
      const fs = jobStats(facJobs(f));
      tb.appendChild(h("tr", { class: "grp" }, h("td", { colspan: 8 }, h("span", { class: "row" },
        h("a", { class: "grp-name", title: "Nur diese Anlage zeigen", onclick: () => { D.sel = f; rerender(); } }, wtxt(f, "facBezeichnung") || "Anlage"),
        h("span", { class: "muted small" }, fa.length + (fa.length === 1 ? " Datenpunkt" : " Datenpunkte")), ...statPills(fs)))));
      wdSortArts(fa, isp, sortKey).forEach(addRow);
    }
  } else wdSortArts(all, isp, sortKey).forEach(addRow);
  if (!all.length) tb.appendChild(h("tr", null, h("td", { colspan: 8, class: "muted" }, multi ? "Keine Datenpunkte in dieser ISP." : "Keine Datenpunkte in dieser Anlage.")));
  tbl.appendChild(tb);
  main.appendChild(tbl);
  drawPick();
  if (flashRow) { D.flashArt = null; requestAnimationFrame(() => { flashRow.scrollIntoView({ block: "center" }); flashRow.classList.add("flash"); }); }
}

/* ======================= Tab: Aus Sicherung übernehmen ======================= */
function wdGenTab(body, D) {
  if (!APP.centrals.length) {
    body.appendChild(h("div", { class: "card" }, emptyState("upload", "Noch keine Sicherung geladen", "Sicherungen öffnen – danach werden die belegten Klemmen hier zu Anlagen gruppiert.",
      h("div", { class: "row", style: { justifyContent: "center", marginTop: "12px" } }, btn("Dateien öffnen", "file", () => $("#fileIn").click(), "accent"), btn("Ordner öffnen", "folder", () => $("#dirIn").click())))));
    return;
  }
  const models = APP.centrals.map(c => wdModel(c));
  if (!APP.wdActive || !byCid(APP.wdActive)) APP.wdActive = APP.cur || APP.centrals[0].cid;
  const C = byCid(APP.wdActive), W = wdModel(C);

  /* Ziel + Einfügen */
  const bts = D ? wdocBauteile(D) : [];
  if (APP.wdBte == null || APP.wdBte >= bts.length) APP.wdBte = 0;
  const used = models.filter(x => x.use);
  const dp = used.reduce((a, x) => a + x.pins.filter(p => p.include).length, 0);
  const target = h("div", { class: "card", style: { marginBottom: "12px" } },
    D ? h("div", { class: "row" },
      h("span", { class: "small muted" }, "Einfügen in"), selectEl(bts.map((b, i) => [i, wtxt(b, "bteBezeichnung") || "Einbauort " + (i + 1)]), APP.wdBte, v => { APP.wdBte = +v; }),
      chk("ISP mit gleichem Namen ersetzen", APP.wdReplace !== false, v => { APP.wdReplace = v; }),
      h("span", { class: "grow" }),
      h("span", { class: "small muted" }, used.length + " ISP · " + dp + " Datenpunkte"),
      btn("In Wartungsdoku einfügen", "download", () => {
        try {
          const bte = wdocBauteile(D)[APP.wdBte || 0];
          let last = null;
          for (const x of used) { const isp = wdocInsertIsp(D, bte, ispXml(x, 1, ""), APP.wdReplace !== false); last = isp; }
          D.sel = last ? (wkids(last, "facility")[0] || last) : D.sel;
          wdocChanged(D); APP.wdTab = "doc";
          toast(used.length + " ISP eingefügt" + (D.writable ? " – wird gespeichert." : " – mit „Speichern“ sichern."), "ok");
          renderAll();
        } catch (e) { toast(e.message, "err", 7000); }
      }, "accent"))
      : h("div", { class: "row" }, icon("info"), h("span", { class: "grow small" }, "Zum Einfügen zuerst die Wartungsdoku (z. B. die leere wartung_…-26-00.wtgml) öffnen."), btn("Wartungsdoku öffnen", "folder", () => wdocPickAndLink(), "accent")));
  body.appendChild(target);

  /* Zentralen */
  const cl = h("div", { class: "stack", style: { marginBottom: "12px" } });
  for (const Cx of APP.centrals) {
    const Wx = wdModel(Cx);
    const n = Wx.pins.filter(p => p.include).length;
    const cb = h("input", { type: "checkbox", checked: Wx.use });
    cb.addEventListener("click", e => e.stopPropagation());
    cb.addEventListener("change", () => { Wx.use = cb.checked; renderAll(); });
    cl.appendChild(h("div", { class: "wcent" + (APP.wdActive === Cx.cid ? " on" : ""), onclick: () => { APP.wdActive = Cx.cid; renderAll(); } },
      h("label", { class: "chk" }, cb), h("div", { class: "grow" }, h("div", { class: "t" }, Wx.isp.bez || Cx.meta.name), h("div", { class: "m" }, "Zentrale " + (Wx.centralAddr || "–") + " · " + Wx.stationType + " · " + n + " Datenpunkte · " + Wx.groups.filter(g => pinsOfGroup(Wx, g.gid).length).length + " Anlagen")),
      APP.wdActive === Cx.cid ? h("span", { class: "pill inf" }, "wird bearbeitet") : h("span", { class: "small muted" }, "bearbeiten")));
  }
  body.appendChild(cl);

  /* Editor */
  const ed = h("div", { class: "card" });
  body.appendChild(ed);
  const field = (lab, val, set, ph) => { const i = h("input", { class: "in", value: val || "", placeholder: ph || "" }); i.addEventListener("input", () => set(i.value)); return [h("label", null, lab), i]; };
  ed.appendChild(h("h3", null, "ISP „" + (W.isp.bez || C.meta.name) + "“"));
  ed.appendChild(h("div", { class: "fields" },
    ...field("ISP-Bezeichnung", W.isp.bez, v => W.isp.bez = v),
    ...field("Gruppe der Station", W.isp.facName, v => W.isp.facName = v),
    ...field("Artikeltyp", W.stationType, v => W.stationType = v),
    ...field("Artikelbezeichnung", W.isp.artBez, v => W.isp.artBez = v),
    ...field("Produktdatenblatt", W.isp.produktDoc, v => W.isp.produktDoc = v, "leer lassen, wenn nicht vorhanden")));
  ed.appendChild(h("div", { class: "row", style: { marginTop: "8px" } },
    chk("Automationsstation als eigene Gruppe anlegen", W.isp.station, v => W.isp.station = v),
    chk("Adresse und Softwarestand aus der Sicherung eintragen", W.isp.fillProps, v => W.isp.fillProps = v)));
  const redo = fn => { fn(); setKlartext(W, W.opt.klartext); renderAll(); };
  const num = h("input", { class: "in sm", type: "number", min: 0, max: 99, value: W.opt.mode === "anlage" ? W.opt.splitAt || 0 : W.opt.grpMax, style: { width: "64px" }, title: W.opt.mode === "anlage" ? "0 = Anlagen nie teilen" : "" });
  num.addEventListener("change", () => redo(() => { const v = Math.max(0, parseInt(num.value, 10) || 0); if (W.opt.mode === "anlage") W.opt.splitAt = v; else W.opt.grpMax = Math.max(2, v || 12); regroupBy(W); }));
  const frei = W.pins.filter(p => p.kind === "frei");
  ed.appendChild(h("div", { class: "cmdbar", style: { margin: "14px -18px 0", borderTop: "1px solid var(--stroke)" } },
    h("span", { class: "small" }, "Gruppieren:"),
    selectEl([["anlage", "nach Anlage (Programm)"], ["name", "nach Bezeichnung"], ["modul", C.format === "DDC3000" ? "nach Kreis" : "nach Modul"], ["eine", "alles in eine Gruppe"]], W.opt.mode, v => redo(() => { W.opt.mode = v; regroupBy(W); }), "sm"),
    W.opt.mode === "anlage" ? h("span", { class: "small muted" }, "große Anlagen teilen ab") : W.opt.mode === "name" ? h("span", { class: "small muted" }, "max. je Gruppe") : null,
    W.opt.mode === "anlage" || W.opt.mode === "name" ? num : null,
    W.opt.mode === "anlage" ? h("span", { class: "small muted" }, "DP (0 = nie)") : null,
    btn("Neu gruppieren", "sliders", () => redo(() => regroupBy(W)), "sm"),
    h("span", { class: "sep" }),
    h("span", { class: "small" }, "Klartext:"),
    selectEl([["voll", "voller Name"], ["zentrale", "ohne Ortspräfix"], ["gruppe", "ohne Gruppennamen"]], W.opt.klartext, v => { setKlartext(W, v); renderAll(); }, "sm"),
    h("span", { class: "sep" }),
    h("span", { class: "small" }, "Info-Feld:"),
    selectEl([["klemme", "Klemme"], ["klemmewert", "Klemme + Wert"], ["leer", "leer"]], W.opt.info, v => { W.opt.info = v; }, "sm"),
    h("span", { class: "sep" }),
    frei.length ? chk("freie Klemmen (" + frei.length + ")", frei.some(p => p.include), v => {
      frei.forEach(p => p.include = v);
      if (v) { let g = W.groups.find(x => x.name === "Freie Klemmen"); if (!g) { g = { gid: newGid(), name: "Freie Klemmen" }; W.groups.push(g); } frei.forEach(p => p.gid = g.gid); }
      renderAll();
    }) : null,
    chk("nach Art sortieren", W.opt.sortKind, v => { W.opt.sortKind = v; renderAll(); })));

  const gbox = h("div", { class: "wgroups" });
  const glist = h("div", { class: "stack", style: { gap: "10px" } });
  gbox.appendChild(glist);
  const gOpts = () => W.groups.map(g => [g.gid, g.name]);
  /* Klemmen je Gruppe einmal einsammeln statt je Gruppe alle durchzugehen */
  const byGid = new Map();
  for (const p of W.pins) { if (!byGid.has(p.gid)) byGid.set(p.gid, []); byGid.get(p.gid).push(p); }
  lazyAppend(glist, W.groups, (g, gi) => {
    const all = byGid.get(g.gid) || [];
    const pins = pinsOfGroup(W, g.gid);
    if (!all.length && !pins.length && g.name !== "Neue Gruppe") return null;
    const gn = h("input", { class: "in gn", value: g.name });
    gn.addEventListener("input", () => { g.name = gn.value; });
    gn.addEventListener("change", () => renderAll());
    const anyIn = all.some(p => p.include);
    const d = h("div", { class: "wgrp" + (anyIn ? "" : " off") },
      h("div", { class: "gh" }, gn, h("span", { class: "badge soft" }, pins.length + " DP"),
        btn(null, anyIn ? "eye" : "eyeoff", () => { all.forEach(p => p.include = !anyIn); renderAll(); }, "subtle sm", anyIn ? "Ganze Gruppe aus der Doku nehmen" : "Gruppe wieder aufnehmen"),
        btn(null, "up", () => { W.groups.splice(gi - 1, 0, W.groups.splice(gi, 1)[0]); renderAll(); }, "subtle sm", "nach oben"),
        btn(null, "down", () => { W.groups.splice(gi + 1, 0, W.groups.splice(gi, 1)[0]); renderAll(); }, "subtle sm", "nach unten"),
        btn(null, "trash", () => { const t = W.groups.find(x => x.gid !== g.gid); W.pins.filter(p => p.gid === g.gid).forEach(p => p.gid = t.gid); W.groups.splice(gi, 1); renderAll(); }, "subtle sm", "Gruppe auflösen (Datenpunkte in die erste Gruppe)")));
    const btns = $$("button", d.firstChild);
    if (gi === 0) btns[1].disabled = true;
    if (gi === W.groups.length - 1) btns[2].disabled = true;
    if (W.groups.length < 2) btns[3].disabled = true;
    d.addEventListener("dragover", e => { e.preventDefault(); d.classList.add("dragover"); });
    d.addEventListener("dragleave", () => d.classList.remove("dragover"));
    d.addEventListener("drop", e => {
      e.preventDefault(); e.stopPropagation(); d.classList.remove("dragover");
      const p = pinOf(W, e.dataTransfer.getData("text/x-ddcwb-pin"));
      if (p) { p.gid = g.gid; renderAll(); }
    });
    const rows = W.opt.sortKind ? pins : all.filter(p => p.include || p.kind !== "frei");
    if (rows.length) {
      const t = h("table", { class: "grid" });
      t.appendChild(h("thead", null, h("tr", null, h("th"), h("th"), h("th", null, "Klemme"), h("th", null, "Art"), h("th", null, "Klartext für die Doku"), h("th", null, "Bezeichnung in der DDC"), h("th", null, "Gruppe"))));
      const tb = h("tbody");
      for (const p of rows) {
        const ik = h("input", { class: "in", value: p.klartext });
        ik.addEventListener("input", () => { p.klartext = ik.value; });
        const why = p.how === "Programm" ? "im Programm verknüpft mit „" + p.plantName + (p.pgroupName ? " › " + p.pgroupName : "") + "“" : p.how === "Name" ? "über die Bezeichnung zugeordnet" : "keine Anlage erkannt";
        const tr = h("tr", { class: p.include ? "" : "off", draggable: "true" },
          h("td", { class: "grip", title: "Ziehen, um in eine andere Gruppe zu verschieben" }, "⋮⋮"),
          h("td", null, chk("", p.include, v => { p.include = v; renderAll(); })),
          h("td", { class: "mono" }, p.klemme), h("td", null, kindTag(p.kind)), h("td", null, ik),
          h("td", { class: "muted small", title: why }, p.name || "–", W.opt.mode === "anlage" ? h("span", { class: "sub", style: { color: p.how === "Programm" ? "var(--ok)" : p.how === "Name" ? "var(--warn)" : "var(--text-3)" } }, p.how === "Programm" ? "● Programm" : p.how === "Name" ? "● Name" : "○ ohne Bezug") : null),
          h("td", null, lazySelectEl(gOpts, p.gid, v => { p.gid = v; renderAll(); })));
        tr.addEventListener("dragstart", e => { e.dataTransfer.setData("text/x-ddcwb-pin", p.uid); e.dataTransfer.effectAllowed = "move"; });
        tb.appendChild(tr);
      }
      t.appendChild(tb);
      d.appendChild(t);
    } else d.appendChild(h("div", { class: "small muted", style: { padding: "10px 12px" } }, "Leer – Datenpunkte hierher ziehen."));
    return d;
  }, { first: 4, step: 3, scroller: body });
  gbox.appendChild(h("div", null, btn("Gruppe hinzufügen", "plus", () => { W.groups.push({ gid: newGid(), name: "Neue Gruppe" }); renderAll(); })));
  ed.appendChild(gbox);
  if (W.opt.mode === "anlage") ed.appendChild(h("div", { class: "small muted", style: { marginTop: "10px" } }, "● Programm = die Klemme hängt im Programm an dieser Anlage · ● Name = unverknüpft, über die Bezeichnung zugeordnet · Maus auf die Bezeichnung zeigt die Zuordnung."));
}

/* ======================= Tab: Befunde als Mängel ======================= */
function mangelState(cid) { APP.mangel = APP.mangel || {}; if (!APP.mangel[cid]) APP.mangel[cid] = new Map(); return APP.mangel[cid]; }
const fKey = f => f.cat + "|" + f.title;
function mangelText(f, toPin) {
  const t = f.title;
  const head = (t.match(/^([^:]{1,80}):\s*/) || [])[1] || "";
  const after = head ? t.slice(t.indexOf(":") + 1).trim() : t;
  const short = toPin || /\//.test(head) ? after : (head ? head.split("›").pop().trim() + ": " + after : t);
  if (f.cat === "Meldung") { const m = (f.detail || "").match(/kommend ([\d.]+ [\d:]+)/); return "Meldung steht an: " + t.split("›").pop().trim() + (m ? " (seit " + m[1] + ")" : ""); }
  if (f.cat === "Bezeichnung" && /uneinheitlich/.test(t)) { const m = (f.detail || "").match(/Wert: „([^“]+)“/); return (toPin ? "" : head + ": ") + "Klartext uneinheitlich" + (m ? " (Text am Wert: „" + m[1] + "“)" : ""); }
  if (f.cat === "Handeingriff") { const m = (f.detail || "").match(/steht auf „([^“]+)“/); return short + (m && !short.includes(m[1]) ? " (Schalter auf „" + m[1] + "“)" : ""); }
  return short;
}
/* Ziel eines Befunds in der ISP finden */
function findArtikelForPin(isp, pin) {
  const D = WDOC.cur; if (!D || !isp) return null;
  const hit = lkLinks(D, isp).byPin.get(pin.uid);
  return hit && LK_ON.has(hit.l.st) ? { f: hit.a.parentElement, a: hit.a } : null;
}
function stationArt(isp) {
  for (const f of wkids(isp, "facility")) for (const a of wkids(f, "Artikel")) { const ic = wkid(a, "installationClass"); if (wtxt(ic, "shortkey") === "54") return { f, a }; }
  const f = wkids(isp, "facility")[0]; const a = f && wkids(f, "Artikel")[0];
  return a ? { f, a } : null;
}
function autoTarget(C, f, isp) {
  const W = wdModel(C);
  const job = (a, re) => wkids(a, "job").find(j => re.test(wtxt(j, "jobDescription"))) || wkids(a, "job").find(j => /Funktion prüfen/.test(wtxt(j, "jobDescription"))) || wkids(a, "job")[0];
  const facByPlant = name => wkids(isp, "facility").find(x => norm(wtxt(x, "facBezeichnung")) === norm(name));
  let pin = f.ref && f.ref.pin ? pinOf(C, f.ref.pin) : null;
  const node = f.ref && f.ref.node ? C.nodes.get(f.ref.node) : null;
  if (!pin && node && node.pin) pin = node.pin;
  const multi = f.ref && f.ref.nodes && f.ref.nodes.length > 1;
  if (!pin && node && !multi) {
    /* direkt verbundene Klemmen, sonst eine Stufe weiter in Wirkrichtung (z. B. Schalter → Pumpe → Ausgang) */
    const near = id => [...edgesOut(C, id).map(e => C.nodes.get(e.to)), ...edgesIn(C, id).map(e => C.nodes.get(e.from))].filter(n => n && n.pin && n.pin.kind !== "frei").map(n => n.pin);
    let cand = near(node.id);
    if (!cand.length) {
      let front = [node.id]; const seen = new Set(front);
      for (let d = 0; d < 3 && !cand.length && front.length; d++) {
        const next = [];
        for (const id of front) for (const e of edgesOut(C, id)) {
          const n2 = C.nodes.get(e.to); if (!n2 || seen.has(n2.id)) continue; seen.add(n2.id);
          if (n2.pin) { if (isOutputKind(n2.pin.kind)) cand.push(n2.pin); } else next.push(n2.id);
        }
        front = next;
      }
    }
    cand.sort((a, b) => (isOutputKind(b.kind) ? 1 : 0) - (isOutputKind(a.kind) ? 1 : 0));
    pin = cand.find(p => findArtikelForPin(isp, p, W)) || null;
  }
  if (pin) {
    const hit = findArtikelForPin(isp, pin, W);
    if (hit) { const j = job(hit.a, /Funktion prüfen/); if (j) return { fac: hit.f, art: hit.a, job: j, label: wtxt(hit.f, "facBezeichnung") + " › " + artName(hit.a) };
    }
  }
  if (pin && !multi) {
    const a = assignPlant(C, pin);
    const fac = a.plant && facByPlant(a.plant.name);
    if (fac) return { fac, art: null, job: null, label: "Gesamtzustand " + wtxt(fac, "facBezeichnung") + " (Datenpunkt nicht in der Doku)" };
  }
  if (node && !multi) {
    const hp = plantOfNode(C, node);
    const fac = hp && (facByPlant(hp.P.name) || (hp.G && hp.G.name && facByPlant(hp.P.name + " – " + hp.G.name)));
    if (fac) return { fac, art: null, job: null, label: "Gesamtzustand " + wtxt(fac, "facBezeichnung") };
  }
  const st = stationArt(isp);
  if (st) {
    const re = f.cat === "Sicherheit" ? /Überprüfung der Zugriffsberechtigungen/ : f.cat === "System" && /batter/i.test(f.title) ? /Pufferbatterie\) prüfen/ :
      f.cat === "System" ? /Umgebungsbedingungen/ : /Zusatzfunktionen prüfen$/;
    const j = job(st.a, re);
    if (j) return { fac: st.f, art: st.a, job: j, station: true, label: "Station › " + trunc(wtxt(j, "jobDescription"), 60) };
  }
  return null;
}
const lineOf = (st, txt) => (st === "behoben" ? "Mangel behoben: " : "") + txt;
/* Verknüpfung Wartungsdoku ↔ Sicherung */
/* Verknüpfung Wartungsdoku ↔ Sicherung – Erkennung in 15b_link.js */
function centralForIsp(isp) { const D = WDOC.cur; return D && isp ? lkCentral(D, isp).C : null; }
export function pinForArt(a, isp) {
  const D = WDOC.cur; if (!D || !isp) return null;
  const L = lkLinks(D, isp), l = L.arts.get(a);
  return l && l.p && L.C ? { C: L.C, p: l.p, st: l.st } : null;      // auch Vorschläge – Aufrufer prüft st
}
function ispForCentral(D, C) { const list = wIsps(D); const x = list.find(y => centralForIsp(y.isp) === C) || (list.length === 1 && !centralForIsp(list[0].isp) ? list[0] : null); return x ? x.isp : null; }
export function artForPin(C, p) {
  const D = WDOC.cur; if (!D) return null;
  for (const { isp } of wIsps(D)) {
    const L = lkLinks(D, isp); if (L.C !== C) continue;
    const hit = L.byPin.get(p.uid);
    if (hit && LK_ON.has(hit.l.st)) return { f: hit.a.parentElement, a: hit.a };
  }
  return null;
}
export function jumpToPin(C, p) { APP.cur = C.cid; go("points", { pin: p.uid, flash: true }); }
/* Wert der verknüpften Klemme (wie im Reiter „Datenpunkte“) */
function artValueChip(C, p) {
  if (!p || !p.value) return null;
  const v = pinValue(p), corr = pinCorrText(p);
  const lo = livePinText(C, p), lv = lo && lo.ok ? lo : null;
  if (!v && !p.value.invalid && !lv) return null;
  const tip = "Wert aus der Sicherung " + stationLabel(C) + (C.meta.stamp ? " (Stand " + C.meta.stamp + ")" : "") + (corr ? "\nFühlerkorrektur " + corr : "") + (p.value.invalid ? "\nWert ist als ungültig markiert" : "");
  return h("span", { class: "artval", title: tip }, p.value.invalid ? h("span", { class: "pill err" }, "ungültig") : h("b", null, v), corr ? h("span", { class: "corr" }, "Korr. " + corr) : null,
    lv ? h("span", { class: "live " + lv.cls, title: "Live-Wert aus dem Online-Reiter, Stand " + liveInfo(C.cid).stamp }, "live " + lv.t) : null);
}
export function jumpToArt(hit) { const D = WDOC.cur; if (!D || !hit) return; D.sel = hit.f; D.flashArt = hit.a; APP.wdTab = "doc"; go("wartung", { tab: "doc", flash: true }); }

/* Ist ein Befund schon in der Wartungsdoku eingetragen? */
function docMangelState(C, f, isp, rec) {
  const tgt = autoTarget(C, f, isp);
  if (!tgt) return { st: null, tgt: null };
  const texts = uniq([rec && rec.text, rec && rec.origText, mangelText(f, !!(tgt.art && !tgt.station))].filter(Boolean));
  const hay = tgt.job ? wtxt(tgt.job, "jobBemerkung") + "\n" + (tgt.art ? wtxt(tgt.fac, "facZustand").split("\n").filter(l => l.startsWith(artName(tgt.art) + ": ") || l.startsWith(lkSplitTag(artName(tgt.art)).base + ": ")).join("\n") : "")
    : (tgt.fac ? wtxt(tgt.fac, "facZustand") : "");
  for (const tx of texts) {
    if (hay.includes("Mangel behoben: " + tx)) return { st: "behoben", tgt, text: tx };
    if (hay.includes(tx)) return { st: "offen", tgt, text: tx };
  }
  return { st: null, tgt };
}
export function findingDocState(C, f) {
  const D = WDOC.cur; if (!D) return null;
  const ver = (D.ver || 0) + "|" + APP.centrals.length;
  if (!C._mgDoc || C._mgDoc.ver !== ver || C._mgDoc.doc !== D.doc) {
    const isp = ispForCentral(D, C);
    C._mgDoc = { ver, doc: D.doc, isp, map: new Map() };
  }
  if (!C._mgDoc.isp) return null;
  if (!C._mgDoc.map.has(f.id)) {
    const S = mangelState(C.cid), rec = S.get(fKey(f));
    C._mgDoc.map.set(f.id, docMangelState(C, f, C._mgDoc.isp, rec).st);
  }
  return C._mgDoc.map.get(f.id);
}

function cleanBem(s) { return s.replace(/(\s*;\s*){2,}/g, "; ").replace(/^\s*;\s*|\s*;\s*$/g, "").replace(/\s{2,}/g, " ").trim(); }
function stripMangel(el, tx) {
  if (!el || !tx) return false;
  if (el.localName === "job") {
    const cur = wtxt(el, "jobBemerkung");
    const next = cleanBem(cur.split("Mangel behoben: " + tx).join("").split(tx).join(""));
    if (next !== cur.trim()) { wset(el, "jobBemerkung", next); return true; }
    return false;
  }
  const cur = wtxt(el, "facZustand");
  const next = cur.split("\n").filter(l => !l.includes(tx)).join("\n").trim();
  if (next !== cur.trim()) { wset(el, "facZustand", next); return true; }
  return false;
}
function writeMangel(D, rec, tgt, withFac) {
  /* eigene und bereits vorhandene Vermerke dieses Befunds entfernen – dann neu schreiben */
  const texts = uniq([rec.text, rec.origText, ...(rec.written || []).map(w => w.text)].filter(Boolean));
  const els = uniq([...(rec.written || []).map(w => w.el), tgt && tgt.job, tgt && tgt.fac].filter(el => el && D.doc.contains(el)));
  for (const el of els) {
    let removed = false;
    for (const tx of texts) removed = stripMangel(el, tx) || removed;
    if (removed && el.localName === "job" && wtxt(el, "executed") === "Mangel" && !/\S/.test(wtxt(el, "jobBemerkung"))) wset(el, "executed", "Ja");
  }
  rec.written = [];
  rec.origText = rec.use ? rec.text : null;
  if (!rec.use || !tgt) return;
  const line = lineOf(rec.status, rec.text);
  if (tgt.job) {
    const cur = wtxt(tgt.job, "jobBemerkung").trim();
    wset(tgt.job, "jobBemerkung", cur ? cur.replace(/[;.\s]*$/, "") + "; " + line : line);
    const ex = wtxt(tgt.job, "executed");
    setExecuted(D, tgt.art, tgt.job, rec.status === "offen" ? "Mangel" : (ex === "Mangel" ? "Mangel" : "Ja"));
    rec.written.push({ el: tgt.job, text: rec.text });
  }
  if (tgt.fac && (!tgt.job || (withFac && !tgt.station))) {
    const facLine = tgt.art ? artName(tgt.art) + ": " + line : line;
    let cur = wtxt(tgt.fac, "facZustand").trim();
    if (!cur) cur = "Anlage geprüft.";
    cur = cur.replace(/\s*Funktion in Ordnung\.?/, "");
    wset(tgt.fac, "facZustand", cur + "\n" + facLine);
    rec.written.push({ el: tgt.fac, text: rec.text });
  }
}

function wdMangelTab(body, D) {
  if (!APP.centrals.length) { body.appendChild(h("div", { class: "card" }, emptyState("alert", "Keine Sicherung geladen", "Die Befunde kommen aus der Sicherung der Station."))); return; }
  if (!D.date) D.date = wDate();
  if (!APP.mgC || !byCid(APP.mgC)) APP.mgC = APP.cur || APP.centrals[0].cid;
  const C = byCid(APP.mgC), W = wdModel(C);
  const isps = wIsps(D);
  if (!isps.length) { body.appendChild(h("div", { class: "card" }, emptyState("doc", "Das Dokument hat noch keine ISP", "Erst im Tab „Aus Sicherung übernehmen“ die Station einfügen – dann lassen sich Befunde den Datenpunkten zuordnen.", h("div", { style: { marginTop: "12px" } }, btn("Aus Sicherung übernehmen", "upload", () => go("wartung", { tab: "gen" }), "accent"))))); return; }
  /* Ziel-ISP: von Hand gewählt › über die Verknüpfung erkannt › gleicher Name › erste */
  const linked = ispForCentral(D, C);
  let ix = APP.mgIsp != null && isps[APP.mgIsp] ? APP.mgIsp : (linked ? isps.findIndex(x => x.isp === linked) : -1);
  if (ix < 0) ix = isps.findIndex(x => norm(wtxt(x.isp, "ispBezeichnung")) === norm(W.isp.bez));
  const guessed = ix < 0 && isps.length > 1;
  if (ix < 0) ix = 0;
  const isp = isps[ix].isp;
  const S = mangelState(C.cid);
  APP.mgSev = APP.mgSev || new Set(["err", "warn"]);
  const dateIn = h("input", { type: "date", class: "in sm", value: wDateToInput(D.date) });
  dateIn.addEventListener("change", () => { D.date = wDateFromInput(dateIn.value) || wDate(); });
  body.appendChild(h("div", { class: "card", style: { marginBottom: "12px" } }, h("div", { class: "row" },
    h("span", { class: "small muted" }, "Befunde aus"), selectEl(APP.centrals.map(c => [c.cid, stationLabel(c)]), C.cid, v => { APP.mgC = v; APP.mgIsp = null; renderAll(); }),
    h("span", { class: "small muted" }, "eintragen in ISP"), selectEl(isps.map((x, i) => [i, (wtxt(x.isp, "ispBezeichnung").trim() || "ISP") + " (" + (wtxt(x.bte, "bteBezeichnung") || "Einbauort") + ")"]), ix, v => { APP.mgIsp = +v; renderAll(); }),
    h("span", { class: "small muted" }, "Prüfdatum"), dateIn)));
  if (guessed) body.appendChild(h("div", { class: "infobar warn", style: { marginBottom: "12px" } }, icon("alert"), h("div", null, "Zu ", h("b", null, C.meta.name), " ist keine ISP der Doku zugeordnet – bitte oben die richtige ISP wählen oder im Tab „Verknüpfung“ zuordnen.")));

  /* Filter – wie in der Ansicht „Befunde“ */
  const fc = findingsCount(C);
  const cats = uniq(C.findings.map(f => f.cat)).sort(natCmp);
  if (APP.mgCat && !cats.includes(APP.mgCat)) APP.mgCat = "";
  const q = norm(APP.mgQ || "");
  const pass = f => APP.mgSev.has(f.sev) && (!APP.mgCat || f.cat === APP.mgCat) && ignPass(C, f) && (!q || norm(f.title + " " + f.detail + " " + f.cat + " " + ((findingWhere(C, f) || {}).pin ? findingWhere(C, f).pin.name : "")).includes(q));
  const rowsAll = C.findings.filter(pass).map(f => {
    let rec = S.get(fKey(f));
    const ds = docMangelState(C, f, isp, rec);
    if (!rec) {
      rec = { use: !!ds.st, status: ds.st || "offen", text: ds.text || "", origText: ds.text || null, written: [] };
      S.set(fKey(f), rec);
    }
    if (!rec.text) rec.text = mangelText(f, !!(ds.tgt && ds.tgt.art && !ds.tgt.station));
    return { f, rec, tgt: ds.tgt, st: ds.st, ign: isIgnored(C, f) };
  });
  const inDoc = rowsAll.filter(r => r.st).length;
  const rows = APP.mgHideDone ? rowsAll.filter(r => !r.st) : rowsAll;
  const qIn = searchBox("Befunde, Klemmen, Texte …", APP.mgQ || "", v => { APP.mgQ = v; APP._mgRefocus = true; renderAll(); }, "240px");
  body.appendChild(h("div", { class: "row", style: { marginBottom: "8px" } },
    ...["err", "warn", "info"].map(sv => h("span", { class: "chip" + (APP.mgSev.has(sv) ? " on" : ""), onclick: () => { APP.mgSev.has(sv) ? APP.mgSev.delete(sv) : APP.mgSev.add(sv); renderAll(); } },
      h("span", { class: "sw-dot", style: { background: `var(--${sv === "info" ? "inf" : sv})` } }), SEV_LABEL[sv], h("span", { class: "n" }, fc[sv]))),
    h("span", { class: "sep" }),
    selectEl([["", "Alle Bereiche"], ...cats.map(c => [c, c + " (" + C.findings.filter(f => f.cat === c && !isIgnored(C, f)).length + ")"])], APP.mgCat || "", v => { APP.mgCat = v; renderAll(); }, "sm"),
    ignFilterEl(),
    qIn,
    chk("eingetragene ausblenden", !!APP.mgHideDone, v => { APP.mgHideDone = v; renderAll(); }),
    h("span", { class: "grow" }),
    fc.ign ? h("span", { class: "small muted", title: "Gespeichert " + persistWhere() }, fc.ign + " abgehakt") : null));
  if (APP._mgRefocus) { APP._mgRefocus = false; setTimeout(() => { const i = qIn.querySelector("input"); if (i) { i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length); } }, 0); }

  const applyAll = () => {
    let n = 0;
    /* abgehakte Befunde werden beim Eintragen nicht angefasst */
    for (const r of rowsAll) { if (r.ign) continue; if (r.rec.use || r.st || (r.rec.written && r.rec.written.length)) { writeMangel(D, r.rec, r.tgt, APP.mgFac !== false); if (r.rec.use) n++; } }
    wdocChanged(D);
    toast(n + " Mängel in die Wartungsdoku eingetragen" + (D.writable ? " – wird gespeichert." : " – mit „Speichern“ sichern."), "ok");
    renderAll();
  };
  const sel = rows.filter(r => r.rec.use && !r.ign).length;
  body.appendChild(h("div", { class: "row", style: { marginBottom: "10px" } },
    btn("Alle auswählen", null, () => { rows.forEach(r => { if (r.tgt && !r.ign) r.rec.use = true; }); renderAll(); }, "sm"),
    btn("Keine", null, () => { rows.forEach(r => { if (!r.ign) r.rec.use = false; }); renderAll(); }, "sm"),
    btn("Sichtbare abhaken", "eyeoff", () => {
      const L = rows.filter(r => !r.ign).map(r => r.f);
      if (!L.length) { toast("Nichts zum Abhaken in dieser Auswahl.", "inf"); return; }
      if (!confirm(L.length + " Befunde abhaken (als „kann ignoriert werden“ markieren)?\nSie verschwinden auch in der Ansicht „Befunde“. In die Wartungsdoku wird dabei nichts geschrieben.")) return;
      setIgnored(C, L, true); renderAll();
    }, "sm", "Alle Befunde der aktuellen Auswahl abhaken"),
    chk("zusätzlich im Gesamtzustand der Anlage vermerken", APP.mgFac !== false, v => { APP.mgFac = v; }),
    h("span", { class: "grow" }),
    h("span", { class: "pill " + (inDoc ? "ok" : "") }, inDoc + " von " + rowsAll.length + " in der Wartungsdoku"),
    h("span", { class: "small muted" }, sel + " ausgewählt"),
    btn("In Wartungsdoku eintragen", "download", applyAll, "accent")));
  const t = h("table", { class: "grid card-t mg-t" });
  t.appendChild(h("thead", null, h("tr", null, h("th", { style: { width: "36px" } }), h("th", null, "Befund"), h("th", null, "Eintrag in der Wartungsdoku"), h("th", { style: { width: "200px" } }, "Status"))));
  const tb = h("tbody");
  for (const { f, rec, tgt, st, ign } of rows) {
    const ta = h("textarea", { class: "in", rows: 2, style: { fontFamily: "var(--font)", fontSize: "13px" }, disabled: ign }, rec.text);
    ta.addEventListener("input", () => { rec.text = ta.value; });
    const seg = h("div", { class: "seg" },
      h("button", { class: rec.status === "offen" ? "on" : "", onclick: () => { rec.status = "offen"; renderAll(); } }, "Mangel offen"),
      h("button", { class: rec.status === "behoben" ? "on" : "", onclick: () => { rec.status = "behoben"; renderAll(); } }, "behoben"));
    const changedSinceDoc = !ign && st && (!rec.use || rec.status !== st);
    tb.appendChild(h("tr", { class: (ign ? "ign " : rec.use || st ? "" : "dim ") + (st === "offen" ? "ex-mangel" : st === "behoben" ? "ex-ja" : "") },
      h("td", null, ign ? null : chk("", rec.use, v => { rec.use = v; renderAll(); })),
      h("td", null, h("div", { class: "row", style: { gap: "8px", flexWrap: "nowrap", alignItems: "flex-start" } }, sevIcon(f.sev),
        h("div", { style: { minWidth: 0 } }, h("b", null, f.title), h("span", { class: "sub" }, f.cat), whereLine(C, f)))),
      h("td", null, ta, h("span", { class: "sub" }, tgt ? "→ " + tgt.label + (tgt.job && !tgt.station ? " · " + trunc(wtxt(tgt.job, "jobDescription"), 50) : "") : "→ kein passender Eintrag in dieser ISP gefunden")),
      h("td", null, ign ? null : seg,
        st ? h("div", { class: "small", style: { marginTop: "6px", fontWeight: 600, color: st === "offen" ? "var(--err)" : "var(--ok)" } }, st === "offen" ? "✓ in der Doku als Mangel" : "✓ in der Doku als behoben") : (ign ? null : h("div", { class: "small faint", style: { marginTop: "6px" } }, "noch nicht eingetragen")),
        changedSinceDoc ? h("div", { class: "small", style: { color: "var(--warn)" } }, !rec.use ? "wird beim Eintragen entfernt" : "wird beim Eintragen geändert") : null,
        h("div", { class: "row", style: { gap: "6px", marginTop: "6px" } },
          ignButton(C, [f], () => { if (isIgnored(C, f) && !st) rec.use = false; renderAll(); }),
          tgt && (tgt.art || tgt.fac) ? h("a", { class: "small", onclick: () => jumpToArt({ f: tgt.fac, a: tgt.art }) }, "in der Doku zeigen") : null))));
  }
  if (!rows.length) tb.appendChild(h("tr", null, h("td", { colspan: 4, class: "muted" }, "Keine Befunde für diesen Filter.")));
  t.appendChild(tb);
  body.appendChild(h("div", { class: "card tight" }, t));
  body.appendChild(h("div", { class: "infobar inf", style: { marginTop: "12px" } }, icon("info"), h("div", { class: "small" },
    "Offene Mängel werden als Ergebnis „Mangel“ mit Bemerkung eingetragen, behobene als „Ja“ mit dem Vermerk „Mangel behoben: …“. Erneutes Eintragen ersetzt den eigenen Vermerk – Abwählen und Eintragen nimmt ihn wieder heraus. Was du im Tab „Dokument“ von Hand schreibst, bleibt erhalten.")));
}

