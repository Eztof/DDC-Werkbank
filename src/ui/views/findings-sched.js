import { go, openNode, openPin, openRef } from "../core/nav.js";
import { APP, vstate } from "../core/state.js";
import { SEARCH, VIEWS } from "../core/ext.js";
import { $, copyText, csv, download, fmtNum, LAZY, h, lazyAppend, natCmp, norm, nowStamp, safeName, trunc, uniq } from "../core/util.js";
import { nodePlace, valText } from "../model/model.js";
import { WD } from "../model/d4pml.js";
import { SEV, SEV_LABEL } from "../model/findings.js";
import { btn, emptyState, findingsCount, icon, pageHead, renderAll, searchBox, selectEl, sevIcon, stationSub, toast } from "../shell/shell.js";
import { PERSIST, activeFindings, ignButton, ignFilterEl, ignPass, isIgnored, persistWhere, setIgnored, whereLine } from "../core/persist.js";
import { findingDocState } from "../wartung/view.js";

/* =========================================================================
   Ansicht: Befunde
   ========================================================================= */
export function findingRow(C, f, compact) {
  const multi = f.ref && f.ref.nodes && f.ref.nodes.length > 1;
  const ign = isIgnored(C, f);
  if (compact) return h("div", { class: "frow mini" + (ign ? " ign" : ""), "data-fid": f.id }, sevIcon(f.sev),
    h("div", { class: "tx" }, h("b", null, f.title, ign ? h("span", { class: "pill", style: { marginLeft: "6px" } }, "abgehakt") : null), f.detail && compact !== "line" ? h("span", null, trunc(f.detail, 220)) : null),
    h("div", { class: "go" }, btn(null, "alert", () => go("findings", { focus: f.id }), "sm subtle", "In der Befundliste zeigen")));
  const ds = findingDocState(C, f);
  const docPill = ds ? h("span", { class: "pill docmark " + (ds === "offen" ? "err" : "ok"), title: "In der verknüpften Wartungsdoku eingetragen" }, icon("doc"), ds === "offen" ? "in Wartungsdoku: Mangel" : "in Wartungsdoku: behoben") : null;
  const links = multi ? h("div", { class: "links" }, f.ref.nodes.slice(0, 12).map(id => { const n = C.nodes.get(id); return h("a", { onclick: () => openRef(C, { node: id }) }, n ? (n.name || n.addr) + " · " + nodePlace(C, n) : id); })) : null;
  const where = !multi ? whereLine(C, f) : null;
  return h("div", { class: "frow" + (ign ? " ign" : ds === "offen" ? " ex-mangel" : ds === "behoben" ? " ex-ja" : ""), "data-fid": f.id }, sevIcon(f.sev),
    h("div", { class: "tx" }, h("b", null, f.title, docPill ? " " : null, docPill), where, f.detail ? h("span", null, f.detail) : null, links),
    h("div", { class: "go" }, ignButton(C, [f]), f.ref && !multi ? btn("Anzeigen", "jump", () => openRef(C, f.ref), "sm") : null));
}

VIEWS.add({
  id: "findings", label: "Befunde", icon: "alert", group: 1, order: 140,
  needsC: true,
  badge(C) {
    if (!C) return null;
    const fc = findingsCount(C);
    return [fc.err && { n: fc.err, cls: "err", title: fc.err + " Fehler" }, fc.warn && { n: fc.warn, cls: "warn", title: fc.warn + " Warnungen" }, fc.err && { dot: true }];
  },
  render(root, C, opts) {
    const S = vstate("findings", C, () => ({ sev: new Set(["err", "warn", "info"]), cat: "", q: "", open: null }));
    const fc = findingsCount(C);
    root.appendChild(pageHead("Befunde", stationSub(C), [
      btn("Bericht kopieren", "copy", () => copyText(findingsText(C, list())).then(() => toast("Befundbericht kopiert.", "ok"))),
      btn("CSV", "download", () => {
        const rows = [["Schwere", "Bereich", "Befund", "Details", "Bezug"]];
        list().forEach(f => rows.push([SEV_LABEL[f.sev], f.cat, f.title, f.detail, f.ref ? (f.ref.pin || f.ref.node || "") : ""]));
        download(safeName(C.meta.name) + "_Befunde.csv", csv(rows), "text/csv;charset=utf-8");
      }),
      btn("Drucken", "print", () => { S.open = new Set(cats()); LAZY.all = true; try { renderAll(); } finally { LAZY.all = false; } setTimeout(() => window.print(), 100); })]));
    const cats = () => uniq(C.findings.map(f => f.cat));
    const list = () => {
      const q = norm(S.q);
      return C.findings.filter(f => S.sev.has(f.sev) && (!S.cat || f.cat === S.cat) && ignPass(C, f) && (!q || norm(f.title + " " + f.detail + " " + f.cat).includes(q)));
    };
    const cmd = h("div", { class: "cmdbar", style: { padding: "0 32px 12px", borderBottom: "0", background: "transparent" } },
      ...["err", "warn", "info"].map(sv => h("span", { class: "chip" + (S.sev.has(sv) ? " on" : ""), onclick: () => { S.sev.has(sv) ? S.sev.delete(sv) : S.sev.add(sv); renderAll(); } },
        h("span", { class: "sw-dot", style: { background: `var(--${sv === "info" ? "inf" : sv})` } }), SEV_LABEL[sv], h("span", { class: "n" }, fc[sv]))),
      h("span", { class: "sep" }),
      selectEl([["", "Alle Bereiche"], ...cats().map(c => [c, c + " (" + C.findings.filter(f => f.cat === c && !isIgnored(C, f)).length + ")"])], S.cat, v => { S.cat = v; renderAll(); }, "sm"),
      ignFilterEl(),
      searchBox("Befunde durchsuchen …", S.q, v => { S.q = v; draw(); }, "260px"),
      h("span", { class: "grow" }),
      fc.ign ? h("span", { class: "small muted", title: "Gespeichert " + persistWhere() }, fc.ign + " abgehakt") : null,
      btn("Sichtbare abhaken", "eyeoff", () => {
        const L = list().filter(f => !isIgnored(C, f));
        if (!L.length) { toast("Nichts zum Abhaken in dieser Auswahl.", "inf"); return; }
        if (!confirm(L.length + " Befunde abhaken (als „kann ignoriert werden“ markieren)?")) return;
        setIgnored(C, L, true); toast(L.length + " Befunde abgehakt – gespeichert " + persistWhere() + ".", "ok"); renderAll();
      }, "sm", "Alle Befunde der aktuellen Auswahl abhaken"));
    root.appendChild(cmd);
    const body = h("div", { class: "page-body" });
    root.appendChild(body);
    if (!C.findings.length) { body.appendChild(emptyState("check", "Keine Befunde", "Die automatischen Prüfungen haben nichts gefunden.")); return; }
    if (!S.open) S.open = new Set(uniq(activeFindings(C).filter(f => f.sev !== "info").map(f => f.cat)));
    if (PERSIST.old) body.appendChild(h("div", { class: "infobar warn", style: { marginBottom: "10px" } }, icon("alert"), h("div", { class: "small" }, "Der laufende Dienst ist eine ältere Version ohne Merkliste – Abgehaktes wird nur im Browser gespeichert. Die neue DDC-Werkbank.exe verwenden.")));
    if (opts.focus != null) { const f = C.findings.find(x => x.id === opts.focus); if (f) { S.open.add(f.cat); S.sev.add(f.sev); if (isIgnored(C, f) && (APP.ignView || "aus") === "aus") APP.ignView = "an"; } }
    const box = h("div");
    body.appendChild(box);
    body.appendChild(h("div", { class: "infobar inf", style: { marginTop: "8px" } }, icon("info"), h("div", { class: "small" },
      h("b", null, "Wie entstehen die Befunde? "), "Die Prüfungen laufen auf den Parametern der Sicherung: Handschalter und Handwerte, ungültige Fühler und große Korrekturen, unverknüpfte Ein- und Ausgänge, abweichende Klartexte, offene Formeleingänge, Verweise ins Leere, BACnet-Instanzen, Zeitprogramme, anstehende Meldungen und Systemwerte. Sie ersetzen keine Prüfung vor Ort, zeigen aber, wo es sich lohnt hinzusehen.")));
    function draw() {
      box.innerHTML = "";
      const L = list();
      if (!L.length) { box.appendChild(emptyState("filter", "Keine Befunde für diesen Filter")); return; }
      const byCat = new Map();
      for (const f of L) { if (!byCat.has(f.cat)) byCat.set(f.cat, []); byCat.get(f.cat).push(f); }
      const order = [...byCat.entries()].sort((a, b) => Math.max(...b[1].map(f => SEV[f.sev])) - Math.max(...a[1].map(f => SEV[f.sev])) || b[1].length - a[1].length);
      for (const [cat, fs] of order) {
        const open = S.open.has(cat) || !!S.q || APP.ignView === "nur";
        const c = { err: 0, warn: 0, info: 0 }; fs.forEach(f => c[f.sev]++);
        /* Zeilen erst bauen, wenn die Gruppe offen ist – große Gruppen schrittweise */
        const bd = h("div", { class: "bd" });
        let built = false;
        const build = () => { if (built) return; built = true; const fi = opts.focus != null ? fs.findIndex(f => f.id === opts.focus) : -1; lazyAppend(bd, fs, f => findingRow(C, f), { first: 60, until: fi >= 0 ? fi : null }); };
        if (open) build();
        const g = h("div", { class: "card tight fgroup" + (open ? " open" : "") },
          h("div", { class: "hd", onclick: () => { S.open.has(cat) ? S.open.delete(cat) : S.open.add(cat); build(); g.classList.toggle("open"); } },
            h("span", { class: "tw" }, icon("chev")), h("span", { class: "t" }, cat),
            c.err ? h("span", { class: "pill err" }, c.err + " Fehler") : null, c.warn ? h("span", { class: "pill warn" }, c.warn + " Warnung" + (c.warn > 1 ? "en" : "")) : null,
            c.info ? h("span", { class: "pill inf" }, c.info + " Hinweis" + (c.info > 1 ? "e" : "")) : null,
            h("span", { class: "grow" }), ignButton(C, fs)),
          bd);
        box.appendChild(g);
      }
      if (opts.focus != null) {
        const el = $(`[data-fid="${opts.focus}"]`, box);
        if (el) { el.scrollIntoView({ block: "center" }); el.style.background = "var(--accent-soft)"; }
      }
    }
    draw();
  }
});
function findingsText(C, list) {
  const L = ["Befundbericht · " + C.meta.name, stationSub(C), "Erstellt " + nowStamp() + " mit der DDC-Werkbank", ""];
  let cat = null;
  for (const f of [...list].sort((a, b) => natCmp(a.cat, b.cat) || SEV[b.sev] - SEV[a.sev])) {
    if (f.cat !== cat) { L.push("", "## " + f.cat); cat = f.cat; }
    L.push("[" + SEV_LABEL[f.sev] + "] " + f.title + (f.detail ? "\r\n    " + f.detail : ""));
  }
  return L.join("\r\n");
}

/* =========================================================================
   Ansicht: Zeitprogramme, Meldungen, Alarmierung, BACnet, Betriebsstunden
   ========================================================================= */
const WD_ORDER = ["mo", "tu", "we", "th", "fr", "sa", "su"];
const WD_LONG = { mo: "Montag", tu: "Dienstag", we: "Mittwoch", th: "Donnerstag", fr: "Freitag", sa: "Samstag", su: "Sonntag", ho: "Feiertag", sp: "Sondertag" };
function schedValName(v, names) {
  if (names && names[v] != null) return names[v];
  return { "0": "Aus", "1": "Ein / Stufe 1", "2": "Stufe 2", "3": "Stufe 3", "35": "Rückfall auf Default", "true": "Ein", "false": "Aus" }[v] || "Wert " + v;
}
export function weekGrid(days, names, def) {
  const g = h("div", { class: "week" });
  const map = new Map((days || []).map(d => [d.weekday, d]));
  const order = WD_ORDER.concat([...map.keys()].filter(k => !WD_ORDER.includes(k)));
  g.appendChild(h("div")); g.appendChild(h("div", { class: "ax" }, [0, 3, 6, 9, 12, 15, 18, 21, 24].map(x => h("span", { style: { left: (x / 24 * 100) + "%" } }, x === 24 ? "24" : String(x).padStart(2, "0")))));
  for (const wd of order) {
    const d = map.get(wd);
    const entries = d ? d.entries.map((e, i) => ({ ...e, i })).sort((a, b) => a.time.localeCompare(b.time) || a.i - b.i) : [];
    const bar = h("div", { class: "bar", title: (WD_LONG[wd] || wd) + ": " + (entries.length ? entries.map(e => e.time + " → " + schedValName(e.value, names)).join(", ") : "keine Schaltzeiten (Default)") });
    [6, 12, 18].forEach(x => bar.appendChild(h("span", { class: "hl", style: { left: (x / 24 * 100) + "%" } })));
    const toMin = t => { const [hh, mm] = t.split(":").map(Number); return (hh || 0) * 60 + (mm || 0); };
    let cur = def != null && def !== "" ? String(def) : "0", from = 0;
    const segs = [];
    const nv = x => x === "true" ? "1" : x === "false" ? "0" : String(x);
    cur = nv(cur);
    for (const e of entries) { const m = toMin(e.time); if (m > from) segs.push([from, m, cur]); cur = nv(e.value); from = Math.max(from, m); }
    segs.push([from, 1440, cur]);
    for (const [a, b, v] of segs) {
      if (b <= a || v === "0" || v === "") continue;
      const cls = v === "35" ? "vd" : v === "1" ? "v1" : v === "2" ? "v2" : v === "3" ? "v3" : "vx";
      bar.appendChild(h("span", { class: "seg " + cls, style: { left: (a / 1440 * 100) + "%", width: ((b - a) / 1440 * 100) + "%" }, title: `${WD_LONG[wd] || wd} ${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}–${String(Math.floor(b / 60)).padStart(2, "0")}:${String(b % 60).padStart(2, "0")}: ${schedValName(v, names)}` }));
    }
    g.appendChild(h("div", { class: "d" }, WD[wd] || wd));
    g.appendChild(bar);
    if (entries.length) g.appendChild(h("div", { class: "tx" }, entries.map(e => e.time + "→" + e.value).join("  ")));
  }
  return g;
}

VIEWS.add({
  id: "sched", label: "Zeit & Meldungen", icon: "clock", group: 1, order: 150,
  needsC: true,
  render(root, C, opts) {
    const S = vstate("sched", C, () => ({ tab: C.schedules.length ? "sched" : "alarm", q: "", bsort: "inst" }));
    if (opts.tab) S.tab = opts.tab;
    root.appendChild(pageHead("Zeit & Meldungen", stationSub(C)));
    const tabs = [["sched", "Zeitprogramme", C.schedules.length, "clock"], ["cal", "Kalender", C.calendars.length, "cal"], ["msg", "Meldungsspeicher", C.messages.length, "bell"],
      ["alarm", "Meldeobjekte", C.alarms.length, "alert"], ["bac", "BACnet", C.bacnet.length, "bacnet"], ["hours", "Betriebsstunden", C.hours.length, "hours"]].filter(t => t[2] || t[0] === "sched" || t[0] === "alarm");
    root.appendChild(h("div", { class: "pivot" }, tabs.map(([k, l, n, ic]) => h("button", { class: S.tab === k ? "on" : "", onclick: () => { S.tab = k; renderAll(); } }, icon(ic), l, h("span", { class: "badge soft" }, n)))));
    const body = h("div", { class: "page-body", style: { paddingTop: "16px" } });
    root.appendChild(body);
    const T = {
      sched() {
        if (!C.schedules.length) return body.appendChild(emptyState("clock", "Keine Zeitprogramme in dieser Sicherung"));
        body.appendChild(h("div", { class: "legend", style: { marginBottom: "12px" } },
          h("span", null, h("i", { style: { background: "var(--accent)" } }), "Ein / Stufe 1"), h("span", null, h("i", { style: { background: "var(--k-AA)" } }), "Stufe 2"),
          h("span", null, h("i", { style: { background: "var(--k-BA)" } }), "Stufe 3"), h("span", null, h("i", { style: { background: "var(--card-3)", border: "1px solid var(--stroke-2)" } }), "Aus"),
          h("span", null, h("i", { style: { background: "repeating-linear-gradient(135deg, var(--stroke-2) 0 2px, transparent 2px 5px)", border: "1px solid var(--stroke-2)" } }), "35 = Rückfall auf Default-Wert")));
        const grid = h("div", { class: "cards wide" });
        for (const sc of C.schedules) {
          const n = C.nodes.get(sc.nodeId);
          const fs = C.findings.filter(f => f.ref && (f.ref.node === sc.nodeId || (f.ref.nodes || []).includes(sc.nodeId)) && f.cat !== "Handeingriff");
          const users = sc.consumers.map(e => C.nodes.get(e.to)).filter(Boolean);
          grid.appendChild(h("div", { class: "card" },
            h("h3", null, icon("clock"), h("span", { class: "grow ellip" }, sc.name), btn(null, "jump", () => openNode(C.cid, sc.nodeId, "down"), "subtle sm", "Wirkung im Programm zeigen")),
            h("div", { class: "small muted", style: { marginTop: "-6px", marginBottom: "10px" } }, [sc.place !== sc.name ? sc.place : "", n ? n.addr : "", sc.objId ? "BACnet Schedule " + sc.objId : "", sc.act != null && sc.act !== "" ? "aktuell " + schedValName(sc.act, sc.stateNames) : "", sc.nxt ? "nächster " + schedValName(sc.nxt, sc.stateNames) : ""].filter(Boolean).join(" · ")),
            weekGrid(sc.days, sc.stateNames, sc.def === "35" ? "35" : sc.def),
            users.length ? h("div", { class: "small", style: { marginTop: "10px" } }, h("span", { class: "muted" }, "Wirkt auf: "), users.slice(0, 6).map((u, i) => [i ? ", " : "", h("a", { onclick: () => openNode(C.cid, u.id) }, u.addr + (u.name ? " " + trunc(u.name, 26) : ""))]), users.length > 6 ? " +" + (users.length - 6) : "") : h("div", { class: "small faint", style: { marginTop: "10px" } }, "Nicht im Programm verknüpft"),
            sc.lopr && sc.lopr.length ? h("div", { class: "small muted" }, "Schreibt auf: " + sc.lopr.map(l => "Device " + l.dev + " · " + l.type + ":" + l.inst + " (Prop " + l.prop + ")").join(", ")) : null,
            fs.length ? h("div", { style: { marginTop: "10px" }, class: "card tight" }, fs.map(f => findingRow(C, f, "line"))) : null));
        }
        body.appendChild(grid);
      },
      cal() {
        const t = table(["Kalender", "Ort", "Einträge", "Ausgang"], C.calendars.map(c => [h("a", { onclick: () => openNode(C.cid, c.nodeId) }, c.name || c.nodeId), nodePlace(C, C.nodes.get(c.nodeId)), h("span", { class: "mono small" }, c.dates.join(" · ") || "–"), c.out]));
        body.appendChild(h("div", { class: "card tight" }, t));
      },
      msg() {
        const act = C.messages.filter(m => m.active).length;
        body.appendChild(h("div", { class: "row", style: { marginBottom: "12px" } }, h("span", { class: "pill " + (act ? "warn" : "ok") }, act + " stehen an"), h("span", { class: "pill" }, (C.messages.length - act) + " gegangen"),
          h("span", { class: "small muted" }, "Meldungsspeicher zum Zeitpunkt der Sicherung, neueste zuerst.")));
        const rows = C.messages.map(m => {
          const parts = m.text.split("/").filter(Boolean);
          const n = m.nodeId && C.nodes.get(m.nodeId);
          return [m.active ? h("span", { class: "pill warn" }, "steht an") : h("span", { class: "pill" }, "gegangen"),
            h("span", { class: "nowrap" }, m.comeTxt || "–"), h("span", { class: "nowrap" }, m.goTxt || "–"), m.kind || "–",
            h("span", null, h("b", null, parts.slice(-2).join(" › ")), h("span", { class: "sub" }, parts.slice(0, -2).join(" › "))),
            n ? h("a", { class: "mono small", onclick: () => openNode(C.cid, n.id, "up") }, m.path) : h("span", { class: "mono small" }, m.path)];
        });
        body.appendChild(h("div", { class: "card tight" }, table(["Status", "Kommt", "Geht", "Art", "Meldung", "Quelle"], rows)));
      },
      alarm() {
        if (!C.alarms.length) return body.appendChild(emptyState("alert", "Keine Meldeobjekte"));
        const d3 = C.format === "DDC3000";
        const rows = C.alarms.map(a => [
          h("a", { onclick: () => openNode(C.cid, a.nodeId, "up") }, a.name), a.place,
          d3 ? (a.ziel || "–") : (a.prio || "–"), d3 ? (a.mtext || "–") : (a.state ? valText(a.state) : "–"), d3 ? h("span", { class: "mono small" }, a.src || "–") : a.para]);
        body.appendChild(h("div", { class: "card tight" }, table(d3 ? ["Meldung", "Ort", "Ziel", "Meldetext", "Quelle"] : ["Meldung", "Ort", "Priorität", "Zustand", "Para"], rows)));
      },
      bac() {
        const counts = {}; C.bacnet.forEach(b => { if (b.inst && b.fb !== "DEV") { const k = b.btype + ":" + b.inst; counts[k] = (counts[k] || 0) + 1; } });
        const types = uniq(C.bacnet.map(b => b.blabel)).sort();
        const st = vstate("bac", C, () => ({ q: "", type: "" }));
        const wrap = h("div");
        body.appendChild(h("div", { class: "row", style: { marginBottom: "12px" } }, searchBox("Instanz, Name, Ort …", st.q, v => { st.q = v; draw(); }), selectEl([["", "Alle Objekttypen"], ...types.map(t => [t, t + " (" + C.bacnet.filter(b => b.blabel === t).length + ")"])], st.type, v => { st.type = v; draw(); }, "sm"),
          btn("CSV", "download", () => download(safeName(C.meta.name) + "_BACnet.csv", csv([["Typ", "Instanz", "Name", "Ort", "Baustein", "Para", "COV"], ...C.bacnet.map(b => [b.blabel, b.inst, b.name, nodePlace(C, C.nodes.get(b.nodeId) || {}), (C.nodes.get(b.nodeId) || {}).addr, b.para, b.cov])]), "text/csv;charset=utf-8"))));
        body.appendChild(wrap);
        const draw = () => {
          wrap.innerHTML = "";
          const q = norm(st.q);
          const list = C.bacnet.filter(b => (!st.type || b.blabel === st.type) && (!q || norm([b.inst, b.name, b.blabel, nodePlace(C, C.nodes.get(b.nodeId) || {})].join(" ")).includes(q)))
            .sort((a, b) => a.btype - b.btype || (parseInt(a.inst, 10) || 0) - (parseInt(b.inst, 10) || 0));
          const rows = list.map(b => { const n = C.nodes.get(b.nodeId); const dup = counts[b.btype + ":" + b.inst] > 1;
            return [b.blabel, h("span", { class: "mono" }, b.inst || "–", dup ? h("span", { class: "pill err", style: { marginLeft: "6px" } }, "doppelt") : null), b.name || "–",
              n ? h("a", { onclick: () => n.pin ? openPin(C.cid, n.pin.uid) : openNode(C.cid, n.id) }, n.addr) : "–", n ? nodePlace(C, n) : "", b.cov || ""]; });
          wrap.appendChild(h("div", { class: "card tight" }, table(["Objekttyp", "Instanz", "Objektname / Text", "Baustein", "Ort", "COV"], rows)));
        };
        draw();
      },
      hours() {
        const list = [...C.hours].sort((a, b) => b.hours - a.hours);
        const max = Math.max(1, ...list.map(x => x.hours));
        const g = h("div", { class: "hrs card" });
        for (const x of list) {
          g.appendChild(h("div", null, h("a", { onclick: () => openNode(C.cid, x.nodeId) }, x.label), h("div", { class: "small muted" }, x.place)));
          g.appendChild(h("div", { class: "b" }, h("span", { style: { width: (x.hours / max * 100) + "%" } })));
          g.appendChild(h("div", { class: "num", style: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }, fmtNum(x.hours, 0) + " h"));
        }
        body.appendChild(g);
      }
    };
    (T[S.tab] || T.sched)();
  }
});
function table(heads, rows) {
  const t = h("table", { class: "grid card-t" });
  t.appendChild(h("thead", null, h("tr", null, heads.map(x => h("th", null, x)))));
  const tb = h("tbody");
  for (const r of rows) tb.appendChild(h("tr", null, r.map(c => h("td", null, c))));
  if (!rows.length) tb.appendChild(h("tr", null, h("td", { colspan: heads.length, class: "muted" }, "Keine Einträge")));
  t.appendChild(tb);
  return t;
}


/* ---------- Globale Suche: Befunde ---------- */
SEARCH.add({
  id: "befunde", label: "Befunde", order: 30,
  index: C => C.findings.map(f => [f, norm(f.title + " " + f.detail)]),
  hit: (C, f) => ({ a: SEV_LABEL[f.sev], n: f.title, w: f.cat + (isIgnored(C, f) ? " · abgehakt" : ""), go: () => { APP.cur = C.cid; go("findings", { focus: f.id }); } })
});
