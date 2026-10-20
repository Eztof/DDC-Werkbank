import { go } from "../core/nav.js";
import { APP } from "../core/state.js";
import { VIEWS } from "../core/views.js";
import { $, copyText, h, trunc } from "../core/util.js";
import { btn, findingsCount, icon, kbar, logoSvg, pageHead, removeCentral, stationSub, toast } from "../shell/shell.js";
import { activeFindings } from "../core/persist.js";
import { findingRow } from "./findings-sched.js";
import { WDOC, wdocInfo } from "../wartung/wtgml.js";
import { wIsps } from "../wartung/view.js";

/* =========================================================================
   Ansicht: Start
   ========================================================================= */
VIEWS.start = {
  render(root) {
    root.appendChild(pageHead("Start", "Sicherungen öffnen und verwalten"));
    const body = h("div", { class: "page-body" });
    root.appendChild(body);
    const has = APP.centrals.length > 0;
    if (!has) body.appendChild(h("div", { class: "hero" }, logoSvg("logo"),
      h("div", null, h("h2", null, "DDC-Werkbank"),
        h("p", null, "Datensicherungen von Kieback&Peter öffnen, Klemmen und Programm verstehen, Befunde finden, Zeitprogramme und Meldungen prüfen, zwei Stände vergleichen und die Wartungsdokumentation als WTGML erzeugen – alles in einer Datei, ohne Installation und ohne Internet."))));
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
              h("div", { class: "nm ellip" }, m.name),
              h("div", { class: "meta" }, [m.format, m.centralAddr ? "Zentrale " + m.centralAddr : "", m.applRev ? "FW " + m.applRev : ""].filter(Boolean).join(" · ")),
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
    f.appendChild(fmt("station", "DDC4000-Familie", "datasave.xml aus der Datensicherung (DDC4200, DDC4200e, DDC4400 …), auch im ZIP oder Sicherungsordner."));
    f.appendChild(fmt("cpu", "BMR / DDC420", "param_backup.d4pml – Parametersicherung der BMR-Raumautomation."));
    f.appendChild(fmt("list", "DDC3000", "*.wwf – Parameterliste der DDC3000-Zentrale (DDC3200 …) inkl. Kreisen, Logik und Wochenprogrammen."));
    f.appendChild(fmt("doc", "Wartungsdoku-Vorlage", "*.wtgml – Wartungsdokumentation aus dem Wartungsprogramm, leer oder ausgefüllt. Wird verknüpft und direkt bearbeitet."));
    body.appendChild(f);
    body.appendChild(h("div", { class: "infobar inf", style: { marginTop: "16px" } }, icon("lock"),
      h("div", null, h("b", null, "Alles bleibt auf diesem Rechner. "), "Die Dateien werden nur im Browser gelesen. Es gibt keine Verbindung ins Internet und nichts wird gespeichert – außer dem gewählten Farbschema.")));
  }
};

/* =========================================================================
   Ansicht: Übersicht
   ========================================================================= */
VIEWS.overview = {
  needsC: true,
  render(root, C) {
    const m = C.meta;
    root.appendChild(pageHead(m.name, stationSub(C), [
      btn("Bericht drucken", "print", () => window.print()),
      btn("Steckbrief kopieren", "copy", () => copyText(stationProfileText(C)).then(() => toast("Steckbrief in die Zwischenablage kopiert.", "ok")))]));
    const body = h("div", { class: "page-body" });
    root.appendChild(body);

    const kinds = {}; C.pins.forEach(p => kinds[p.kind] = (kinds[p.kind] || 0) + 1);
    const used = C.pins.length - (kinds.frei || 0);
    const fc = findingsCount(C);
    const prog = [...C.nodes.values()].filter(n => !n.ghost && !n.isPin && !String(n.type).startsWith("SY_") && n.type !== "SYS");
    const act = C.messages.filter(x => x.active).length;
    const tile = (ico, t, v, small, d, onclick) => h("div", { class: "tile" + (onclick ? " click" : ""), onclick },
      h("div", { class: "t" }, icon(ico), t), h("div", { class: "v" }, v, small ? h("small", null, small) : null), d ? (typeof d === "string" ? h("div", { class: "d" }, d) : d) : null);
    body.appendChild(h("div", { class: "tiles" },
      tile("pin", "Klemmen belegt", used, "/ " + C.pins.length, h("div", { class: "stack", style: { gap: "6px", marginTop: "4px" } }, kbar(kinds),
        h("div", { class: "legend" }, ["AE", "AA", "BE", "BA"].filter(k => kinds[k]).map(k => h("span", null, h("i", { style: { background: `var(--k-${k})` } }), k + " " + kinds[k])))), () => go("points")),
      tile("flow", "Programmbausteine", prog.length, null, C.edges.length + " Verknüpfungen · " + C.groups.size + " Gruppen", () => go("program")),
      tile("alert", "Befunde", fc.err + fc.warn, null, h("div", { class: "row", style: { gap: "6px" } },
        fc.err ? h("span", { class: "pill err" }, fc.err + " Fehler") : null, fc.warn ? h("span", { class: "pill warn" }, fc.warn + " Warnungen") : null,
        h("span", { class: "pill inf" }, fc.info + " Hinweise")), () => go("findings")),
      tile("clock", "Zeitprogramme", C.schedules.length, null, C.calendars.length ? C.calendars.length + " Kalender" : (C.format === "DDC3000" ? "Wochenprogramme N" : "keine Kalender"), () => go("sched", { tab: "sched" })),
      tile("bell", "Meldungen", act, C.messages.length ? "aktiv / " + C.messages.length : null, C.messages.length ? "im Meldungsspeicher" : C.alarms.length + " Meldeobjekte", () => go("sched", { tab: C.messages.length ? "msg" : "alarm" })),
      C.format !== "DDC3000" ? tile("bacnet", "BACnet-Objekte", C.bacnet.length, null, "Device " + (m.bacnetDevId || "–") + (C.trends.length ? " · " + C.trends.length + " Trends" : ""), () => go("sched", { tab: "bac" })) : null));

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
};

function stationProfileText(C) {
  const m = C.meta, L = [];
  const kinds = {}; C.pins.forEach(p => kinds[p.kind] = (kinds[p.kind] || 0) + 1);
  L.push(m.name, "=".repeat(Math.min(60, m.name.length || 10)));
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

