import { FORMATS } from "../core/ext.js";
import { parseBackup, devName } from "../p90/backup.js";
import { buildDDC3000 } from "./ddc3000.js";

/* =========================================================================
   DDC3000 – P90-Sicherung (.p90, erstellt im Reiter „DDC3000 sichern“ oder
   mit dem bisherigen HTML-Tool). Die Zeilen m1/p1 sind unverändert die
   Antworten der DDC. Hier werden sie in dieselben Datensätze übersetzt, die
   auch die .wwf liefert (AX/AI/DS/DM/TX/V/T/L, K, M, N …), und dann wie eine
   .wwf ausgewertet (buildDDC3000). Je Zentrale am Bus eine Zentrale.

   Mit Definitionen (D1) in der Sicherung sind Art (Ist-/Sollwert, digital,
   Verknüpfung …), Standardtexte und Grenzen bekannt; ohne sie wird die Art
   aus der Form des Werts abgeleitet.
   ========================================================================= */

const UNITS = { "108": "°C" };     // Einheiten-Code der DDC → Text (nur gesicherte)
const unitText = c => UNITS[c] || "";
const HEX2 = /^[0-9A-F]{2}$/;
const REF_Z = /^(\d{3})\.(\d{3})$/;     // Quelle einer Verknüpfung: Zentrale.Gerät, z. B. 002.710

/* "p1 1.2.1 5100/1 28.5 108 0F 00 WT Becken Soll" → Bestandteile */
export function parseP1(line) {
  const m = line.match(/^p1 (\d+)\.(\d+)\.(\d+) ([^\s/]*)\/(\d+) ?(.*)$/);
  if (!m) return null;
  const r = { a: m[1], z: +m[2], g: +m[3], base: m[4], inst: parseInt(m[5], 10) || 1, val: "", unit: "", attr: "", st: "", gt: "", quoted: false, tok: [] };
  let rest = m[6];
  if (rest.startsWith('"')) {
    const j = rest.indexOf('"', 1);
    r.val = rest.slice(1, j < 0 ? undefined : j); r.quoted = true;
    rest = j < 0 ? "" : rest.slice(j + 1).trim();
    const t = rest.split(" ");
    if (HEX2.test(t[0] || "") && HEX2.test(t[1] || "")) { r.attr = t[0]; r.st = t[1]; r.gt = t.slice(2).join(" ").trim(); }
    return r;
  }
  const t = rest.split(" ");
  let i = -1;
  for (let k = 1; k < t.length - 1; k++) if (t[k] === "0F" && HEX2.test(t[k + 1])) { i = k; break; }
  if (i < 0) for (let k = 1; k < t.length - 1; k++) if (HEX2.test(t[k]) && HEX2.test(t[k + 1])) { i = k; break; }
  if (i < 0) { r.val = rest.trim(); return r; }
  let v = t.slice(0, i).filter(x => x !== "");
  if (v.length >= 2 && /^\d+$/.test(v[v.length - 1]) && !REF_Z.test(v[0])) r.unit = v.pop();
  r.tok = v; r.val = v.join(" ");
  r.attr = t[i]; r.st = t[i + 1]; r.gt = t.slice(i + 2).join(" ").trim();
  return r;
}

/* Definitionen D1 → Nachschlagen je Gerätegruppe und Parameter */
function defIndex(lines) {
  const byGroup = new Map();
  for (const l of lines) {
    const t = l.split(" ");
    if (t.length < 12) continue;
    const pm = t[2].match(/^([A-Za-z]*)(\d*)(?:-([A-Za-z]*)(\d+))?$/);
    if (!pm) continue;
    const d = { letter: pm[1], lo: pm[2] === "" ? null : +pm[2], hi: pm[4] != null ? +pm[4] : (pm[2] === "" ? null : +pm[2]),
      typ: +t[3], max: t[5], min: t[6], dflt: t[7], unit: t[8], attr: parseInt(t[9], 16) || 0, name: t.slice(12).join(" ").trim(), range: pm[4] != null };
    if (!byGroup.has(t[1])) byGroup.set(t[1], []);
    byGroup.get(t[1]).push(d);
  }
  return (group, base) => {
    const L = byGroup.get(String(group)); if (!L) return null;
    const m = base.match(/^([A-Za-z]*)(\d*)$/); if (!m) return null;
    const num = m[2] === "" ? null : +m[2];
    return L.find(d => d.letter === m[1] && (num == null ? d.lo == null : d.lo != null && num >= d.lo && num <= d.hi)) || null;
  };
}

/* Art wie in der .wwf (PROTOKOLL.md, Abschnitt 4.2) */
function kindFromDef(d) {
  const ist = !!(d.attr & 0x40);
  if ([1, 2, 3, 14, 20].includes(d.typ)) return ist ? "AI" : "AX";
  if ([10, 13].includes(d.typ)) return ist ? "DM" : "DS";
  if (d.typ === 4) return "TX";
  if (d.typ === 31 || d.typ === 34) return "V";
  if (d.typ === 32) return "T";
  if (d.typ === 33) return "L";
  return null;
}
function kindGuess(r) {
  if (r.quoted) return "TX";
  if (REF_Z.test(r.tok[0] || "")) return / [EA] \d\d:\d\d/.test(r.val) ? "T" : /^L\d/.test(r.base) ? "L" : "V";
  const dig = /^[01]$/.test(r.val) && !r.unit;
  const letter = (r.base.match(/^[A-Za-z]+/) || [""])[0];
  if (letter === "b" || letter === "y") return "AI";
  if (letter === "k") return "DM";
  if (letter && letter === letter.toLowerCase()) return dig ? "DM" : "AI";
  if (/^2/.test(r.st)) return dig ? "DM" : "AI";
  return dig ? "DS" : "AX";
}

/* Quellen einer Verknüpfung: "002.710 B7/01 N AND 002.000 M28/01 N ---" → ["2.710 B7/1N", "2.0 M28/1Nand"]
   (der Verknüpfungsoperator steht – wie die .wwf-Auswertung ihn liest – an der folgenden Quelle) */
function refsOf(tok) {
  const out = []; let op = "";
  for (let i = 0; i < tok.length; i++) {
    const z = tok[i].match(REF_Z);
    if (z && tok[i + 1] && /\//.test(tok[i + 1])) {
      const [b, n] = tok[i + 1].split("/");
      const ni = /^[NI]$/.test(tok[i + 2] || "") ? tok[i + 2] : "N";
      out.push(`${+z[1]}.${+z[2]} ${b}/${parseInt(n, 10) || 1}${ni}${op}`);
      i += /^[NI]$/.test(tok[i + 2] || "") ? 2 : 1;
      const o = (tok[i + 1] || "").toLowerCase();
      op = o === "and" || o === "or" ? o : "";
      if (o && !REF_Z.test(tok[i + 1])) i++;
    }
  }
  return out;
}

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const timeOk = v => { const m = String(v || "").match(/^(\d\d):(\d\d)$/); return m && (+m[1] < 24 || v === "24:00") ? v : "--:--"; };

/* Eine Zentrale (z) aus der Sicherung → Datensätze wie in der .wwf */
function recordsOf(z, devices, def) {
  const recs = [];
  const dev0 = devices.find(d => +d.addr.split(".")[2] === 0);
  const typ0 = dev0 ? devName(dev0.group, dev0.type) : "DDC3000";
  recs.push({ kind: "Z", f: { NR: String(z), TYP: typ0 }, sched: {} });
  recs.push({ kind: "B", f: { TYP: typ0 }, sched: {} });
  const progs = new Map();   // Wochenprogramm-Nr → { BEG1: [ "", Mo … So ], … }
  for (const d of devices) {
    const g = +d.addr.split(".")[2];
    if (g !== 0) recs.push({ kind: "K", f: { NR: String(g), TYP: devName(d.group, d.type), GT: "" }, sched: {} });
    for (const l of d.menus) {
      const m = l.match(/^m1 \S+ (\S+)(?: (\S+))?/);
      if (m) recs.push({ kind: "M", f: { NR: m[1], AKTIV: "1" }, sched: {} });
    }
    for (const l of d.values) {
      const r = parseP1(l);
      if (!r) continue;
      const D = def(d.group, r.base);
      const kind = (D && kindFromDef(D)) || kindGuess(r);
      const f = { P: r.base + "/" + r.inst, W: r.val, ST: r.st };
      if (r.gt) f.GT = r.gt;
      if (D && D.name) {
        const n = D.range && D.lo != null ? (parseInt(r.base.replace(/^[A-Za-z]*/, ""), 10) - D.lo + 1) : r.inst;
        f.K = D.name.replace(/%\((\d+)\)/, "%(" + n + ")");
      }
      const u = unitText(r.unit || (D && D.unit) || "");
      if (u) f.E = u;
      if (kind === "AX" && D) { f.UG = D.min; f.OG = D.max; }
      if (kind === "V") refsOf(r.tok).slice(0, 4).forEach((x, i) => { f["V" + (i + 1)] = x; });
      else if (kind === "T") {
        const [ref] = refsOf(r.tok); if (ref) f.TV = ref;
        const tz = r.val.match(/ ([EA]) (\S+)$/);
        if (tz) f.TZ = tz[1] + " " + tz[2].replace(/\/00:00:00$/, "");
      } else if (kind === "L") {
        const [a, b] = refsOf(r.tok); if (a) f.LD = a; if (b) f.LB = b;
      }
      /* Schaltzeiten der Wochenprogramme: Parameter mit Namen „Mo-BEGINN1“ … „So-ENDE4“, Index = Programm */
      const sm = D && D.name.match(/^(Mo|Di|Mi|Do|Fr|Sa|So)-(BEGINN|ENDE)(\d)$/i);
      if (sm && g === 0) {
        if (!progs.has(r.inst)) progs.set(r.inst, {});
        const key = (/^B/i.test(sm[2]) ? "BEG" : "END") + sm[3];
        const P = progs.get(r.inst); if (!P[key]) P[key] = ["", "--:--", "--:--", "--:--", "--:--", "--:--", "--:--", "--:--"];
        P[key][DAYS.findIndex(x => x.toLowerCase() === sm[1].toLowerCase()) + 1] = timeOk(r.val);
        continue;
      }
      recs.push({ kind, f, sched: {}, kreis: g });
    }
  }
  return { recs, progs };
}

/* Datensätze in Reihenfolge der .wwf: je Kreis K, dann seine Menüs und Parameter */
function ordered(z, devices, def) {
  const { recs, progs } = recordsOf(z, devices, def);
  const out = recs.filter(r => r.kind === "Z" || r.kind === "B");
  const rest = recs.filter(r => r.kind !== "Z" && r.kind !== "B");
  /* recordsOf liefert schon gerätweise; Grundgerät-Datensätze (ohne K davor) zuerst */
  let cur = 0;
  const groups = new Map([[0, []]]);
  for (const r of rest) {
    if (r.kind === "K") { cur = +r.f.NR; groups.set(cur, [r]); continue; }
    groups.get(cur).push(r);
  }
  out.push(...groups.get(0));
  for (const [nr, sc] of progs) out.push({ kind: "N", f: { NR: String(nr) }, sched: sc });
  for (const [k, L] of groups) if (k !== 0) out.push(...L);
  return out;
}

export function parseP90(text, label, fileName) {
  const B = parseBackup(text);
  if (!B.devices.length) throw new Error(B.aborted ? "Sicherung wurde abgebrochen, bevor ein Gerät gelesen war" : "Keine Geräte in der P90-Sicherung");
  const def = defIndex(B.definitions.D1);
  const byZ = new Map();
  for (const d of B.devices) {
    const z = +d.addr.split(".")[1];
    if (!byZ.has(z)) byZ.set(z, []);
    byZ.get(z).push(d);
  }
  const stamp = (B.header.Erstellt || "").replace(/,/, "");
  const out = [];
  for (const [z, devices] of byZ) {
    const C = buildDDC3000(ordered(z, devices, def), label, fileName, {
      format: "DDC3000 · P90-Sicherung (.p90)" + (B.definitions.D1.length ? "" : " ohne Definitionen"),
      stamp, stampSrc: stamp ? "Sicherung erstellt" : "", values: true
    });
    const failed = devices.filter(d => !d.ok).map(d => d.addr);
    C.system.push({ group: "Sicherung", k: "Erstellt", v: B.header.Erstellt || "–" },
      { group: "Sicherung", k: "Kennung", v: B.header.Kennung || "–" },
      { group: "Sicherung", k: "Geräte", v: String(devices.length) },
      { group: "Sicherung", k: "Definitionen", v: B.definitions.D1.length ? B.definitions.D1.length + " Parameterdefinitionen" : "nicht mitgesichert – Art der Werte geschätzt", warn: !B.definitions.D1.length });
    if (failed.length) C.system.push({ group: "Sicherung", k: "Geräte mit Fehler", v: failed.join(", "), warn: true });
    if (B.aborted) C.system.push({ group: "Sicherung", k: "Status", v: "abgebrochen – unvollständig", warn: true });
    C.p90 = { failed, aborted: B.aborted, defs: B.definitions.D1.length };
    out.push(C);
  }
  return out.length === 1 ? out[0] : out;
}

/* ---------- Als Dateiformat anmelden ---------- */
FORMATS.add({
  id: "ddc3000-p90", order: 11, icon: "list", label: "DDC3000 (P90)",
  desc: "*.p90 – Datensicherung der DDC3000 über RS232 (Reiter „DDC3000 sichern“), alle Zentralen am Bus.",
  exts: ["p90"],
  sniff: (name, head) => /^\s*# P90-Sicherung/.test(head) || (/\.p90$/i.test(name) && /^\[Gerät \S+ /m.test(head)),
  parse: (text, f) => parseP90(text, f.label, f.name)
});
