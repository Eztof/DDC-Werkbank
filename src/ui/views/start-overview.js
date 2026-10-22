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
  render(root, C) {
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
    body.appendChild(h("div", { class: "section-title" }, C.format === "DDC3000" ? "Grundgerät und Kreise" : "Module"));
    const t = h("table", { class: "grid card-t" });
    t.appendChild(h("thead", null, h("tr", null, h("th", null, C.format === "DDC3000" ? "Kreis" : "Modul"), h("th", null, "Typ"), h("th", null, "Bezeichnung"),
      h("th", { class: "num" }, "Klemmen"), h("th", { style: { width: "28%" } }, "Belegung"), h("th", null, C.format === "DDC3000" ? "SW-Module" : "Stand"))));
    const tb = h("tbody");
    for (const mo of C.modules) {
      const usedM = mo.pinCount - (mo.kinds.frei || 0);
      tb.appendChild(h("tr", { class: mo.pinCount ? "click" : "", onclick: mo.pinCount ? () => go("points", { mod: mo.addr }) : null },
        h("td", { class: "mono" }, mo.addr), h("td", null, mo.type || "–", mo.active === false ? h("span", { class: "pill warn", style: { marginLeft: "6px" } }, "inaktiv") : null),
        h("td", null, mo.name || h("span", { class: "faint" }, "–")),
        h("td", { class: "num" }, mo.pinCount ? usedM + " / " + mo.pinCount : "–"),
        h("td", null, mo.pinCount ? kbar(mo.kinds, mo.pinCount) : null),
        h("td", { class: "small muted" }, C.format === "DDC3000" ? (mo.swModules || []).map(x => "M" + x.nr).join(" ") : [mo.fw ? "FW " + mo.fw : "", mo.hw ? "HW " + trunc(mo.hw, 40) : ""].filter(Boolean).join(" · ") || "")));
    }
    t.appendChild(tb);
    body.appendChild(h("div", { class: "card tight" }, t));

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
