import { go } from "../core/nav.js";
import { APP } from "../core/state.js";
import { FORMATS, OVERVIEW_TILES, VIEWS } from "../core/ext.js";
import { safely } from "../core/registry.js";
import { $, copyText, h, trunc } from "../core/util.js";
import { btn, centralTitle, findingsCount, icon, kbar, logoSvg, pageHead, removeCentral, stationSub, toast } from "../shell/shell.js";
import { activeFindings } from "../core/persist.js";
import { findingRow } from "./findings-sched.js";
import { WDOC, wdocInfo } from "../wartung/wtgml.js";
import { wIsps } from "../wartung/view.js";

/* =========================================================================
   Ansicht: Start
   ========================================================================= */
VIEWS.add({
  id: "start", label: "Start", icon: "home", group: 0, order: 0,
  render(root) {
    root.appendChild(pageHead("Start", "Sicherungen öffnen und verwalten"));
    const body = h("div", { class: "page-body" });
    root.appendChild(body);
    const has = APP.centrals.length > 0;
    if (!has) body.appendChild(h("div", { class: "hero" }, logoSvg("logo"),
      h("div", null, h("h2", null, "DDC-Werkbank"),
        h("p", null, "Datensicherungen von Kieback&Peter öffnen, Klemmen und Programm verstehen, Befunde finden, Zeitprogramme und Meldungen prüfen und die Wartungsdokumentation als WTGML erzeugen – alles in einer Datei, ohne Installation und ohne Internet."))));
    const drop = h("div", { class: "drop" + (has ? " small" : "") },
      icon("upload", "big"),
      h("div", null, h("div", { class: "t" }, has ? "Weitere Sicherungen oder eine WTGML-Vorlage hinzufügen" : "Sicherungen hierher ziehen"),
        h("div", { class: "muted small", style: { marginTop: "4px" } }, "Ordner, ZIP-Archive oder einzelne Dateien – mehrere Zentralen auf einmal sind möglich.")),
      h("div", { class: "row", style: { justifyContent: "center" } },
        btn("Dateien öffnen", "file", () => $("#fileIn").click(), "accent"),
        btn("Ordner öffnen", "folder", () => $("#dirIn").click())));
    body.appendChild(drop);

    if (has) {
      body.appendChild(h("div", { class: "section-title" }, "Geladene Sicherungen", h("span", { class: "badge soft" }, APP.centrals.length)));
      const list = h("div", { class: "cards wide" });
      for (const C of APP.centrals) {
        const fc = findingsCount(C), m = C.meta;
        const used = C.pins.filter(p => p.kind !== "frei").length;
        list.appendChild(h("div", { class: "card" },
          h("div", { class: "station" },
            h("div", { class: "ic" }, icon(C.format === "DDC3000" ? "cpu" : "station")),
            h("div", { class: "grow", style: { minWidth: 0 } },
              h("div", { class: "nm ellip", title: centralTitle(C) }, centralTitle(C)),
              h("div", { class: "meta" }, [m.stationName && m.name !== m.stationName ? m.name : "", m.format, m.centralAddr ? "Zentrale " + m.centralAddr : "", m.applRev ? "FW " + m.applRev : ""].filter(Boolean).join(" · ")),
              h("div", { class: "meta ellip", title: C.filePath || C.fileName }, (C.filePath || C.fileName) + (m.stamp ? " · Stand " + m.stamp : "")))),
          h("div", { class: "row", style: { marginTop: "12px" } },
            h("span", { class: "pill" }, used + " Klemmen belegt"),
            h("span", { class: "pill" }, [...C.nodes.values()].filter(n => !n.ghost && !n.isPin).length + " Bausteine"),
            fc.err ? h("span", { class: "pill err" }, fc.err + " Fehler") : null,
            fc.warn ? h("span", { class: "pill warn" }, fc.warn + " Warnungen") : null,
            !fc.err && !fc.warn ? h("span", { class: "pill ok" }, "keine Auffälligkeiten") : null),
          h("div", { class: "row", style: { marginTop: "12px" } },
            btn("Öffnen", "right", () => { APP.cur = C.cid; go("overview"); }, "accent"),
            btn("Befunde", "alert", () => { APP.cur = C.cid; go("findings"); }),
            h("span", { class: "grow" }),
            btn("", "trash", () => removeCentral(C.cid), "subtle", "Aus der Liste entfernen"))));
      }
      body.appendChild(list);
    }
    if (WDOC.cur) {
      const D = WDOC.cur, I = wdocInfo(D);
      body.appendChild(h("div", { class: "section-title" }, "Wartungsdoku"));
      body.appendChild(h("div", { class: "cards wide" }, h("div", { class: "card" },
        h("div", { class: "station" }, h("div", { class: "ic" }, icon("doc")),
          h("div", { class: "grow", style: { minWidth: 0 } }, h("div", { class: "nm ellip" }, D.name),
            h("div", { class: "meta" }, [I.svc, I.prj, I.cust].filter(Boolean).join(" · ")),
            h("div", { class: "meta" }, wIsps(D).length + " ISP · " + (D.writable ? "verknüpft – Änderungen werden direkt gespeichert" : "nicht verknüpft")))),
        h("div", { class: "row", style: { marginTop: "12px" } }, btn("Bearbeiten", "right", () => go("wartung", { tab: "doc" }), "accent")))));
    }
    body.appendChild(h("div", { class: "section-title" }, "Was kann geöffnet werden?"));
    const f = h("div", { class: "cards" });
    const fmt = (ico, t, d) => h("div", { class: "card fmt" }, h("div", { class: "ic" }, icon(ico)), h("div", null, h("b", null, t), h("span", null, d)));
    for (const F of FORMATS.list(F => F.label)) f.appendChild(fmt(F.icon || "file", F.label, F.desc || (F.exts || []).map(e => "*." + e).join(", ")));
    body.appendChild(f);
    body.appendChild(h("div", { class: "infobar inf", style: { marginTop: "16px" } }, icon("lock"),
      h("div", null, h("b", null, "Alles bleibt auf diesem Rechner. "), "Die Dateien werden nur im Browser gelesen. Es gibt keine Verbindung ins Internet und nichts wird gespeichert – außer dem gewählten Farbschema.")));
  }
});

/* =========================================================================
   Ansicht: Übersicht
   ========================================================================= */
VIEWS.add({
  id: "overview", label: "Übersicht", icon: "overview", group: 1, order: 110,
  needsC: true,
  render(root, C, opts) {
    const m = C.meta;
    root.appendChild(pageHead(centralTitle(C), stationSub(C), [
      btn("Bericht drucken", "print", () => window.print()),
      btn("Steckbrief kopieren", "copy", () => copyText(stationProfileText(C)).then(() => toast("Steckbrief in die Zwischenablage kopiert.", "ok")))]));
    const body = h("div", { class: "page-body" });
    root.appendChild(body);

    const tile = T => h("div", { class: "tile" + (T.onclick ? " click" : ""), onclick: T.onclick || null },
      h("div", { class: "t" }, icon(T.icon || "info"), T.title), h("div", { class: "v" }, T.value, T.small ? h("small", null, T.small) : null),
      T.detail ? (typeof T.detail === "string" ? h("div", { class: "d" }, T.detail) : T.detail) : null);
    body.appendChild(h("div", { class: "tiles" }, OVERVIEW_TILES.list().map(X => { const T = safely("Kachel " + X.id, () => X.tile(C, go), null); return T ? tile(T) : null; })));

    /* Wichtigste Befunde */
    const top = activeFindings(C).filter(f => f.sev !== "info").slice(0, 6);
    if (top.length) {
      body.appendChild(h("div", { class: "section-title" }, "Wichtigste Befunde", h("a", { onclick: () => go("findings"), class: "small" }, "alle anzeigen")));
      const c = h("div", { class: "card tight" });
      for (const f of top) c.appendChild(findingRow(C, f));
      body.appendChild(c);
    }

    /* Module */
    body.appendChild(moduleTable(C, opts || {}));

    /* Systemdaten */
    const groups = new Map();
    for (const s of C.system) { if (!groups.has(s.group)) groups.set(s.group, []); groups.get(s.group).push(s); }
    body.appendChild(h("div", { class: "section-title" }, "Station und System"));
    const cards = h("div", { class: "cards wide" });
    for (const [g, list] of groups) {
      const dl = h("dl", { class: "kv" });
      const show = list.length > 14 ? list.slice(0, 14) : list;
      for (const s of show) { dl.appendChild(h("dt", null, s.k)); dl.appendChild(h("dd", { class: s.warn ? "warn" : "" }, s.v)); }
      const card = h("div", { class: "card" }, h("h3", null, icon(g === "Netzwerk" ? "bacnet" : g === "Gerät" ? "cpu" : g === "Meldungsversand" ? "bell" : g.startsWith("Neustarts") ? "clock" : "info"), g), dl);
      if (list.length > show.length) {
        const more = h("a", { class: "small", style: { display: "inline-block", marginTop: "8px" } }, "alle " + list.length + " anzeigen");
        more.onclick = () => { dl.innerHTML = ""; for (const s of list) { dl.appendChild(h("dt", null, s.k)); dl.appendChild(h("dd", { class: s.warn ? "warn" : "" }, s.v)); } more.remove(); };
        card.appendChild(more);
      }
      cards.appendChild(card);
    }
    if (C.users.length) {
      let shown = false;
      const dl = h("dl", { class: "kv" });
      const fill = () => { dl.innerHTML = ""; for (const u of C.users) { dl.appendChild(h("dt", null, u.user + (u.level ? " · Ebene " + u.level : ""))); dl.appendChild(h("dd", { class: "mono" }, u.password ? (shown ? u.password : "••••••") : "–")); } };
      fill();
      const tg = btn(null, "eye", () => { shown = !shown; fill(); tg.innerHTML = ""; tg.appendChild(icon(shown ? "eyeoff" : "eye")); }, "subtle sm", "Passwörter anzeigen/verbergen");
      cards.appendChild(h("div", { class: "card" }, h("h3", null, icon("key"), "Bedienebenen", h("span", { class: "grow" }), tg), dl,
        h("div", { class: "small faint", style: { marginTop: "8px" } }, "Passwörter stehen unverschlüsselt in der Sicherung. Datei nur an Berechtigte weitergeben.")));
    }
    body.appendChild(cards);
    if (C.notes.length) body.appendChild(h("div", { class: "infobar warn", style: { marginTop: "16px" } }, icon("alert"), h("div", null, h("b", null, "Hinweise beim Einlesen: "), C.notes.slice(0, 8).join(" · "))));
  }
});

/* Module bzw. Grundgerät und Kreise. Bei DDC3000-Sicherungen (.p90/.EZR) dazu je Busmodul:
   antwortet es, und welche Werte meldete es bei der Sicherung (EZR: Raum, Soll, Ventil). */
const MODF = new Map();   // cid → "all" | "off" | "bad"
const busBad = mo => !!(mo.bus && !mo.bus.off && mo.bus.vals.some(x => x.v == null));
function moduleTable(C, opts) {
  const d3 = C.format === "DDC3000";
  const bus = C.modules.filter(mo => mo.bus);
  const off = bus.filter(mo => mo.bus.off), bad = bus.filter(busBad);
  let f = MODF.get(C.cid) || "all";
  if ((f === "off" && !off.length) || (f === "bad" && !bad.length)) f = "all";
  const wrap = h("div", { id: "modTable" });
  const title = h("div", { class: "section-title" }, d3 ? "Grundgerät und Kreise" : "Module");
  wrap.appendChild(title);
  if (bus.length) {
    const seg = h("div", { class: "seg", style: { marginLeft: "12px" } });
    const opt = (k, label, n) => seg.appendChild(h("button", { class: f === k ? "on" : "", onclick: () => { MODF.set(C.cid, k); wrap.replaceWith(moduleTable(C, {})); } }, label + " " + n));
    opt("all", "Alle", C.modules.length);
    if (off.length) opt("off", "Antworten nicht", off.length);
    if (bad.length) opt("bad", "Wert ungültig", bad.length);
    title.appendChild(seg);
    title.appendChild(h("span", { class: "small muted", style: { marginLeft: "10px", fontWeight: "normal" } },
      (bus.length - off.length) + " von " + bus.length + " Busmodulen antworten · Werte zum Zeitpunkt der Sicherung"));
  }
  const t = h("table", { class: "grid card-t" });
  t.appendChild(h("thead", null, h("tr", null, h("th", null, d3 ? "Kreis" : "Modul"), h("th", null, "Typ"), h("th", null, "Bezeichnung"),
    bus.length ? h("th", null, "Verbindung") : null, bus.length ? h("th", null, "Werte") : null,
    h("th", { class: "num" }, "Klemmen"), bus.length ? null : h("th", { style: { width: "28%" } }, "Belegung"), h("th", null, d3 ? "SW-Module" : "Stand"))));
  const tb = h("tbody");
  const rows = f === "off" ? off : f === "bad" ? bad : C.modules;
  for (const mo of rows) {
    const usedM = mo.pinCount - (mo.kinds.frei || 0);
    const rk = C.nodes.has(mo.addr + ":RK") ? mo.addr + ":RK" : null;
    const open = mo.pinCount ? () => go("points", { mod: mo.addr }) : rk ? () => go("program", { node: rk }) : null;
    tb.appendChild(h("tr", { class: open ? "click" : "", onclick: open },
      h("td", { class: "mono" }, mo.addr), h("td", null, mo.type || "–", mo.active === false ? h("span", { class: "pill warn", style: { marginLeft: "6px" } }, "inaktiv") : null),
      h("td", null, mo.name || h("span", { class: "faint" }, "–")),
      bus.length ? h("td", { class: "nowrap" }, busState(mo)) : null,
      bus.length ? h("td", { class: "small" }, busVals(mo)) : null,
      h("td", { class: "num" }, mo.pinCount ? usedM + " / " + mo.pinCount : "–"),
      bus.length ? null : h("td", null, mo.pinCount ? kbar(mo.kinds, mo.pinCount) : null),
      h("td", { class: "small muted" }, d3 ? (mo.swModules || []).map(x => "M" + x.nr).join(" ") : [mo.fw ? "FW " + mo.fw : "", mo.hw ? "HW " + trunc(mo.hw, 40) : ""].filter(Boolean).join(" · ") || "")));
  }
  t.appendChild(tb);
  wrap.appendChild(h("div", { class: "card tight" }, t));
  if (opts.scroll === "mods") requestAnimationFrame(() => wrap.scrollIntoView({ block: "start" }));
  return wrap;
}
function busState(mo) {
  if (!mo.bus) return null;
  if (mo.bus.off) return h("span", { class: "pill err", title: "Bei der Sicherung hat die Zentrale das Modul nicht erreicht – keine Version, alle Istwerte ungültig." }, "antwortet nicht");
  return [h("span", { class: "pill ok" }, "antwortet"), mo.bus.fw ? h("span", { class: "small muted", style: { marginLeft: "6px" } }, "V " + mo.bus.fw) : null];
}
function busVals(mo) {
  const B = mo.bus;
  if (!B) return null;
  if (B.off) return h("span", { class: "faint" }, "keine Werte");
  const parts = B.vals.map(x => x.v == null ? h("span", { class: "pill err", title: x.k + ": Wert ungültig (????) – z. B. Fühler defekt oder nicht angeschlossen" }, x.k + " ungültig") : h("span", null, h("span", { class: "muted" }, x.k + " "), x.v));
  if (!parts.length && B.pins) parts.push(h("span", null, B.pinsOk + " von " + B.pins + " Klemmen mit Wert"));
  return parts.length ? parts.flatMap((x, i) => i ? [h("span", { class: "faint" }, " · "), x] : [x]) : h("span", { class: "faint" }, "–");
}

function stationProfileText(C) {
  const m = C.meta, L = [];
  const kinds = {}; C.pins.forEach(p => kinds[p.kind] = (kinds[p.kind] || 0) + 1);
  const ti = centralTitle(C);
  L.push(ti, "=".repeat(Math.min(60, ti.length || 10)));
  L.push("Format: " + m.format, "Zentrale: " + (m.centralAddr || "–") + (m.bacnetDevId ? " · BACnet Device " + m.bacnetDevId : ""));
  if (m.applRev) L.push("Firmware: " + m.applRev + (m.build ? " (Build " + m.build + ")" : ""));
  if (m.stamp) L.push("Stand der Sicherung: " + m.stamp + " (" + m.stampSrc + ")");
  L.push("Datei: " + (C.filePath || C.fileName), "");
  L.push("Klemmen: " + C.pins.length + " gesamt, belegt " + (C.pins.length - (kinds.frei || 0)) + " (" + ["AE", "AA", "BE", "BA"].map(k => k + " " + (kinds[k] || 0)).join(", ") + ")");
  L.push("Module: " + C.modules.map(x => x.addr + " " + x.type).join(", "));
  L.push("Zeitprogramme: " + C.schedules.length + " · Meldungen aktiv: " + C.messages.filter(x => x.active).length);
  const fc = findingsCount(C);
  L.push("Befunde: " + fc.err + " Fehler, " + fc.warn + " Warnungen, " + fc.info + " Hinweise", "");
  for (const s of C.system.filter(x => !/Neustarts/.test(x.group))) L.push(s.group + " · " + s.k + ": " + s.v);
  return L.join("\r\n");
}


/* ---------- Kacheln der Übersicht ---------- */
const pinKinds = C => { const k = {}; C.pins.forEach(p => k[p.kind] = (k[p.kind] || 0) + 1); return k; };
OVERVIEW_TILES.add({ id: "klemmen", order: 10, tile(C, go) {
  const kinds = pinKinds(C);
  return { icon: "pin", title: "Klemmen belegt", value: C.pins.length - (kinds.frei || 0), small: "/ " + C.pins.length, onclick: () => go("points"),
    detail: h("div", { class: "stack", style: { gap: "6px", marginTop: "4px" } }, kbar(kinds),
      h("div", { class: "legend" }, ["AE", "AA", "BE", "BA"].filter(k => kinds[k]).map(k => h("span", null, h("i", { style: { background: `var(--k-${k})` } }), k + " " + kinds[k])))) };
} });
OVERVIEW_TILES.add({ id: "bus", order: 15, tile(C, go) {
  const bus = C.modules.filter(mo => mo.bus); if (!bus.length) return null;
  const off = bus.filter(mo => mo.bus.off).length, bad = bus.filter(busBad).length;
  return { icon: "cpu", title: "Busmodule antworten", value: bus.length - off, small: "/ " + bus.length,
    onclick: () => { MODF.set(C.cid, off ? "off" : bad ? "bad" : "all"); go("overview", { scroll: "mods" }); },
    detail: h("div", { class: "row", style: { gap: "6px" } }, off ? h("span", { class: "pill err" }, off + " ohne Antwort") : h("span", { class: "pill ok" }, "alle antworten"),
      bad ? h("span", { class: "pill warn" }, bad + " mit ungültigem Wert") : null) };
} });
OVERVIEW_TILES.add({ id: "programm", order: 20, tile(C, go) {
  let n = 0; for (const x of C.nodes.values()) if (!x.ghost && !x.isPin && !String(x.type).startsWith("SY_") && x.type !== "SYS") n++;
  return { icon: "flow", title: "Programmbausteine", value: n, detail: C.edges.length + " Verknüpfungen · " + C.groups.size + " Gruppen", onclick: () => go("program") };
} });
OVERVIEW_TILES.add({ id: "befunde", order: 30, tile(C, go) {
  const fc = findingsCount(C);
  return { icon: "alert", title: "Befunde", value: fc.err + fc.warn, onclick: () => go("findings"),
    detail: h("div", { class: "row", style: { gap: "6px" } }, fc.err ? h("span", { class: "pill err" }, fc.err + " Fehler") : null, fc.warn ? h("span", { class: "pill warn" }, fc.warn + " Warnungen") : null, h("span", { class: "pill inf" }, fc.info + " Hinweise")) };
} });
OVERVIEW_TILES.add({ id: "zeit", order: 40, tile: (C, go) => ({ icon: "clock", title: "Zeitprogramme", value: C.schedules.length,
  detail: C.calendars.length ? C.calendars.length + " Kalender" : (C.format === "DDC3000" ? "Wochenprogramme N" : "keine Kalender"), onclick: () => go("sched", { tab: "sched" }) }) });
OVERVIEW_TILES.add({ id: "meldungen", order: 50, tile(C, go) {
  const act = C.messages.filter(x => x.active).length;
  return { icon: "bell", title: "Meldungen", value: act, small: C.messages.length ? "aktiv / " + C.messages.length : null,
    detail: C.messages.length ? "im Meldungsspeicher" : C.alarms.length + " Meldeobjekte", onclick: () => go("sched", { tab: C.messages.length ? "msg" : "alarm" }) };
} });
OVERVIEW_TILES.add({ id: "bacnet", order: 60, tile: (C, go) => C.format === "DDC3000" ? null : ({ icon: "bacnet", title: "BACnet-Objekte", value: C.bacnet.length,
  detail: "Device " + (C.meta.bacnetDevId || "–") + (C.trends.length ? " · " + C.trends.length + " Trends" : ""), onclick: () => go("sched", { tab: "bac" }) }) });
