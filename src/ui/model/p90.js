import { FORMATS } from "../core/ext.js";
import { parseBackup, devName } from "../p90/backup.js";
import { buildDDC3000 } from "./ddc3000.js";
import { makroDef } from "./d3makro.js";

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

const UNITS = { "13": "min", "108": "°C", "109": "K", "150": "%", "190": "kByte" };   // Einheiten-Code der DDC → Text (mit echten .wwf/.EZR abgeglichen)
const unitText = c => UNITS[c] || "";
const HEX2 = /^[0-9A-F]{2}$/i;
const REF_Z = /^(\d{3})\.(\d{3})$/;     // Quelle einer Verknüpfung: Zentrale.Gerät, z. B. 002.710
const isRef = t => REF_Z.test(t[0] || "") && /\//.test(t[1] || "");   // „002.710 B7/01“ – nicht ein Wert wie „100.000 0“

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
  for (let k = 1; k < t.length - 1; k++) if (t[k].toUpperCase() === "0F" && HEX2.test(t[k + 1])) { i = k; break; }
  if (i < 0) for (let k = 1; k < t.length - 1; k++) if (HEX2.test(t[k]) && HEX2.test(t[k + 1])) { i = k; break; }
  if (i < 0) { r.val = rest.trim(); return r; }
  let v = t.slice(0, i).filter(x => x !== "");
  if (v.length >= 2 && /^\d+$/.test(v[v.length - 1]) && !isRef(v)) r.unit = v.pop();
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
  if (/^L\d+$/.test(r.base) && (r.tok[0] === "---" || REF_Z.test(r.tok[0] || ""))) return "L";
  if (/^[0-9a-f]{8}$/i.test(r.val) && /[a-f]/i.test(r.val)) return "DM";          // Status-/Fehlerwort (hex)
  if (/^[01]{8}$/.test(r.val)) return /^2/.test(r.st) ? "DM" : "DS";                   // Bitmaske
  if (isRef(r.tok)) return / [EA] \d\d:\d\d/.test(r.val) ? "T" : /^L\d/.test(r.base) ? "L" : "V";
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
      /* „000.000 0000/00“ = keine Quelle eingetragen → leer lassen (Platz bleibt, wie „---“ in der .wwf) */
      out.push(/^0+$/.test(b) ? null : `${+z[1]}.${+z[2]} ${b}/${parseInt(n, 10) || 1}${ni}${op}`);
      i += /^[NI]$/.test(tok[i + 2] || "") ? 2 : 1;
      const o = (tok[i + 1] || "").toLowerCase();
      op = o === "and" || o === "or" ? o : "";
      if (o && !REF_Z.test(tok[i + 1])) i++;
    }
  }
  return out;
}

const SP_SKIP = new Set(["1207", "2030"]);   // ohne Definitionen: bekannte Systemparameter, die SPEnterprise ablehnt
/* Nutzzeiten je Wochentag (1014 = Mo … 1020 = So): „06:00-14:00 --- --- ---“ = bis zu 4 Blöcke.
   So liefert die DDC die Wochenprogramme (Menü 117 der Zentrale, Menü 74 der EZR). */
const NZ_DAY = { "1014": 0, "1015": 1, "1016": 2, "1017": 3, "1018": 4, "1019": 5, "1020": 6 };
const NZ_VAL = /^(?:---|\d\d:\d\d-\d\d:\d\d)(?: (?:---|\d\d:\d\d-\d\d:\d\d)){0,3}$/;
const JDP_VAL = /^([PE])([A-Z])([A-Z]) (\d{4}) (\d\d\.\d\d)(?:-(\d\d\.\d\d))?$/;   // Jahresprogramm-Eintrag „PAN 0000 31.12-01.01“
const emptyWeek = () => Array(7).fill("--:--");
function addBlocks(P, day, val) {
  String(val).split(" ").forEach((b, i) => {
    const m = b.match(/^(\d\d:\d\d)-(\d\d:\d\d)$/);
    if (!m || i > 3) return;
    (P["BEG" + (i + 1)] ||= emptyWeek())[day] = timeOk(m[1]);
    (P["END" + (i + 1)] ||= emptyWeek())[day] = timeOk(m[2]);
  });
}
/* Lampe: „001.703 S1/01 N ---“ → [LD, LB]; „---“ steht für eine leere Quelle */
function lampRefs(tok) {
  const out = [];
  for (let i = 0; i < tok.length && out.length < 2; i++) {
    if (tok[i] === "---") { out.push(null); continue; }
    if (REF_Z.test(tok[i])) { const [x] = refsOf(tok.slice(i, i + 3)); out.push(x || null); i += /^[NI]$/.test(tok[i + 2] || "") ? 2 : 1; }
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
  const jahr = new Map();    // Jahresprogramm-Nr → [{ i, typ, prog, del, zu, beg, end }]
  for (const d of devices) {
    const g = +d.addr.split(".")[2];
    const dprogs = g === 0 ? progs : new Map();
    if (g !== 0) recs.push({ kind: "K", f: { NR: String(g), TYP: d.group ? devName(d.group, d.type) : "", GT: d.text || "" }, sched: {} });
    for (const l of d.menus) {
      const m = l.match(/^m1 \S+ (\S+)(?: (\S+))?/);
      if (m) recs.push({ kind: "M", f: { NR: m[1], AKTIV: "1" }, sched: {} });
    }
    for (const l of d.values) {
      const r = parseP1(l);
      if (!r) continue;
      const D = def(d.group, r.base);
      /* ohne Definitionen: Vorlagen der Schnellparametrierung (falls in die Werkbank geladen) */
      const MK = !D && d.group ? makroDef(devName(d.group, d.type), r.base) : null;
      const pinLike = /^[bykBYK]\d+$/.test(r.base);
      const kind = (D && kindFromDef(D)) || (MK && !(MK.kind === "V" && !isRef(r.tok)) && MK.kind) || kindGuess(r);
      const f = { P: r.base + "/" + r.inst, W: r.val, ST: r.st };
      if (r.gt) f.GT = r.gt;
      if (D && D.name) {
        const n = D.range && D.lo != null ? (parseInt(r.base.replace(/^[A-Za-z]*/, ""), 10) - D.lo + 1) : r.inst;
        f.K = D.name.replace(/%\((\d+)\)/, "%(" + n + ")");
      }
      if (MK && MK.name && !pinLike && !f.K) f.K = MK.name;
      const u = unitText(r.unit || (D && D.unit) || "") || (MK && MK.unit && !/keine/i.test(MK.unit) ? MK.unit : "");
      if (u) f.E = u;
      if (kind === "AX" && D) { f.UG = D.min; f.OG = D.max; }
      /* Parameter, die die Schnellparametrierung nicht kennt (Attribut-Bit 0x04 in D1, z. B. 1207 Task-Zustand,
         2030 Treiber), lehnt SPEnterprise beim Übersetzen ab → für die .wwf weglassen */
      if (D ? (D.attr & 0x04) : (g === 0 && SP_SKIP.has(r.base))) f.noSP = true;
      if (kind === "V") refsOf(r.tok).slice(0, 4).forEach((x, i) => { if (x) f["V" + (i + 1)] = x; });
      else if (kind === "T") {
        const [ref] = refsOf(r.tok); if (ref) f.TV = ref;
        const tz = r.val.match(/ ([EA]) (\S+)$/);
        if (tz) f.TZ = tz[1] + " " + tz[2].replace(/\/00:00:00$/, "");
      } else if (kind === "L") {
        const [a, b] = lampRefs(r.tok); if (a) f.LD = a; if (b) f.LB = b;
      }
      /* Nutzzeiten → Wochenprogramm N (der Parameter bleibt für die Ansichten erhalten, nicht aber in der .wwf) */
      if (r.base in NZ_DAY && NZ_VAL.test(r.val)) {
        if (!dprogs.has(r.inst)) dprogs.set(r.inst, {});
        addBlocks(dprogs.get(r.inst), NZ_DAY[r.base], r.val);
        f.noSP = true;
      }
      /* aktuelle Nutzzeitblöcke heute/morgen (1010/1011), Datums- und Zeitblock-Werte: kennt die .wwf nicht */
      if ((D && [21, 22].includes(D.typ)) || /^\d\d\.\d\d\.\d\d$/.test(r.val) || (!D && NZ_VAL.test(r.val))) f.noSP = true;
      /* Jahresprogramm 501…532 („JDP %(n)“) → J-Datensatz */
      const jm = (D ? D.typ === 30 : /^5(0[1-9]|[12]\d|3[0-2])$/.test(r.base)) && (r.val.match(JDP_VAL) || r.val === "---");
      if (jm && g === 0) {
        if (Array.isArray(jm)) {
          if (!jahr.has(r.inst)) jahr.set(r.inst, []);
          jahr.get(r.inst).push({ i: parseInt(r.base, 10) - 500, typ: jm[1], prog: jm[2], del: jm[3], zu: jm[4], beg: jm[5], end: jm[6] || "--.--" });
        }
        f.noSP = true;
      }
      /* Schaltzeiten der Wochenprogramme: Parameter mit Namen „Mo-BEGINN1“ … „So-ENDE4“, Index = Programm */
      const sm = D && D.name.match(/^(Mo|Di|Mi|Do|Fr|Sa|So)-(BEGINN|ENDE)(\d)$/i);
      if (sm && g === 0) {
        if (!progs.has(r.inst)) progs.set(r.inst, {});
        const key = (/^B/i.test(sm[2]) ? "BEG" : "END") + sm[3];
        const P = progs.get(r.inst); if (!P[key]) P[key] = ["--:--", "--:--", "--:--", "--:--", "--:--", "--:--", "--:--"];
        P[key][DAYS.findIndex(x => x.toLowerCase() === sm[1].toLowerCase())] = timeOk(r.val);
        continue;
      }
      recs.push({ kind, f, sched: {}, kreis: g });
    }
    if (g !== 0) for (const [nr, sc] of dprogs) recs.push({ kind: "N", f: { NR: String(nr) }, sched: sc, kreis: g });
  }
  const jrecs = [...jahr].map(([nr, L]) => ({ kind: "J", f: { NR: String(nr) }, sched: {}, jdp: L.sort((a, b) => a.i - b.i), kreis: 0 }));
  return { recs, progs, jrecs };
}

/* Datensätze in Reihenfolge der .wwf: je Kreis K, dann seine Menüs und Parameter */
function ordered(z, devices, def) {
  const { recs, progs, jrecs } = recordsOf(z, devices, def);
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
  out.push(...jrecs);
  for (const [k, L] of groups) if (k !== 0) out.push(...L);
  return out;
}

/* Definitionen der Zentrale z (aus ihrem eigenen Abschnitt), sonst alle */
function defsFor(B, z, devices) {
  const own = devices.map(d => B.defsBy && B.defsBy[d.addr]).find(x => x && x.D1.length);
  return defIndex(own ? own.D1 : B.definitions.D1);
}

/* Geräte je Zentrale. Adresse a.z.g; bei kleinen Anlagen (DDC3035 …) ist z = 0, die Verknüpfungen nennen dann a */
function byZentrale(B) {
  const byZ = new Map();
  for (const d of B.devices) {
    const [a, zz] = d.addr.split(".").map(Number);
    const z = zz || a;
    if (!byZ.has(z)) byZ.set(z, []);
    byZ.get(z).push(d);
  }
  return byZ;
}

export function parseP90(text, label, fileName) {
  const B = parseBackup(text);
  if (!B.devices.length) throw new Error(B.aborted ? "Sicherung wurde abgebrochen, bevor ein Gerät gelesen war" : "Keine Geräte in der P90-Sicherung");
  const byZ = byZentrale(B);
  const stamp = (B.header.Erstellt || "").replace(/,/, "");
  const out = [];
  for (const [z, devices] of byZ) {
    const C = buildDDC3000(ordered(z, devices, defsFor(B, z, devices)), label, fileName, {
      format: (B.plain ? "DDC3000 · Sicherung des K&P-Programms (" + ((fileName || "").match(/\.\w+$/) || [".PRO"])[0].toUpperCase() + ")" : "DDC3000 · P90-Sicherung (.p90)") + (B.definitions.D1.length ? "" : " ohne Definitionen"),
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

/* =========================================================================
   Export als .wwf (Arbeitsdatei der Schnellparametrierung / SPEnterprise).
   Aufbau wie eine echte .wwf: RTF (Courier New), je Zeile ein Token-Datensatz,
   Z/B, Menüs (M), Parameter, Wochenprogramme (N), je Kreis K + Menüs + Parameter.
   K=!Text ist der angezeigte Text (Klartext, sonst Standardtext), GT= der Klartext.
   Je Zentrale am Bus eine Datei.  -> [{ z, name, rtf }]
   ========================================================================= */
const CP1252_ENC = (() => {
  const m = new Map();
  try { const dec = new TextDecoder("windows-1252"); for (let b = 0x80; b < 0x100; b++) m.set(dec.decode(Uint8Array.of(b)), b); } catch (e) { /* Latin-1 */ }
  return m;
})();
function rtfEsc(s) {
  let o = "";
  for (const ch of String(s ?? "")) {
    if (ch === "\\" || ch === "{" || ch === "}") o += "\\" + ch;
    else if (ch.charCodeAt(0) < 0x80) o += ch;
    else { const b = CP1252_ENC.get(ch) ?? (ch.charCodeAt(0) < 0x100 ? ch.charCodeAt(0) : 0x3f); o += "\\'" + b.toString(16).padStart(2, "0"); }
  }
  return o;
}
const pad = (s, n) => String(s ?? "").padEnd(n);
const wP = f => { const [b, i] = String(f.P).split("/"); return (+i || 1) > 1 ? b + "/" + (+i) : b; };
const wTZ = tz => String(tz || "").replace(/^([EA]) 0?(\d+):/, "$1 $2:");
/* Text für die .wwf: „_“ leitet in der Schnellparametrierung einen Platzhalter ein (#def _ANL …) → Leerzeichen */
const tx = s => String(s ?? "").replace(/_/g, " ");
/* Werte, die die Schnellparametrierung lesen kann – sonst leer lassen („W=“ = nicht vorgegeben, wie in den Vorlagen) */
const wAX = v => { v = String(v ?? "").trim(); return /^-?\d+(\.\d+)?$|^-+$|^[\\/][-\\/]*$|^\d\d:\d\d$/.test(v) ? v : ""; };
const wDS = v => { v = String(v ?? "").trim(); return /^\d{1,2}$|^[01]{2,8}$|^[ST]$/.test(v) ? v : ""; };
const RK_TYP = { "LÜFTUNG": "RK-Lüftung", "HEIZUNG": "RK-Heizung", "FESTWERT": "RK-Festwert" };

/* Reihenfolge wie in einer echten .wwf: Wochen-/Jahresprogramm (N/J) und ihr Status-Parameter direkt hinter
   ihrem Menü (117/67/74 bzw. 116/68), N und J je Gerät fortlaufend nummeriert. */
const WEEK_M = /^(?:117|67|74)\/(\d+)$/, YEAR_M = /^(?:116|68)\/(\d+)$/;
function wwfOrder(recs) {
  const out = [], groups = [];
  for (const r of recs) {
    if (r.kind === "Z" || r.kind === "B") { out.push(r); continue; }
    if (r.kind === "K" || !groups.length) groups.push({ head: r.kind === "K" ? r : null, list: [] });
    if (r.kind !== "K") groups[groups.length - 1].list.push(r);
  }
  for (const G of groups) {
    if (G.head) out.push(G.head);
    const used = new Set();
    const find = (kind, nr) => G.list.find(r => r.kind === kind && +r.f.NR === nr && !used.has(r));
    const stat = (b, nr) => G.list.find(r => r.f.P && !used.has(r) && (r.f.P === b + "/" + nr || (nr === 1 && r.f.P === b)));
    let nN = 0, nJ = 0;
    const menus = G.list.filter(r => r.kind === "M");
    for (const m of menus) {
      out.push(m); used.add(m);
      let x;
      if ((x = String(m.f.NR).match(WEEK_M))) {
        const n = find("N", +x[1]);
        if (n) { const st = stat("N", +x[1]); if (st) { out.push(st); used.add(st); } out.push({ ...n, wNR: ++nN }); used.add(n); }
      } else if ((x = String(m.f.NR).match(YEAR_M))) {
        const j = find("J", +x[1]);
        if (j) { const st = stat("J", +x[1]); if (st) { out.push(st); used.add(st); } out.push({ ...j, wNR: ++nJ }); used.add(j); }
      }
    }
    for (const r of G.list) if (!used.has(r)) out.push(r.kind === "N" ? { ...r, wNR: ++nN } : r.kind === "J" ? { ...r, wNR: ++nJ } : r);
  }
  return out;
}

function wwfLines(recs, name) {
  const L = [];
  recs = wwfOrder(recs);
  const head = (kind, f) => pad(kind, 8) + "P=" + pad(wP(f), 10) + "; K=     !" + tx(f.GT || f.K);
  const kindOf = r => (r.kind === "DS" && /^[NJ]\//.test(r.f.P)) ? "DM" : r.kind;   // Status Wochen-/Jahresprogramm: in der .wwf DM
  const refs = (f, keys) => keys.map((k, i) => "       " + k + "=" + pad(f[k] || "---", 15) + "; T" + (i + 1) + "=");
  name = tx(name);
  for (const r of recs) {
    const f = r.f;
    if (f.noSP) continue;
    if (r.kind === "T" && !f.TV) continue;          // Zeitglied ohne Quelle = nicht benutzt (steht in echten .wwf nicht drin)
    switch (kindOf(r)) {
      case "Z": L.push("Z      NR=" + pad(f.NR, 5) + "; TYP=DDC3000    ; K=" + name); break;
      case "B": L.push("B      NR=" + pad(recs[0].f.NR, 5) + "; TYP=" + pad(f.TYP, 11) + "; K=", "       GT=" + name); break;
      case "K": L.push("K      NR=" + pad(f.NR, 5) + "; TYP=" + (RK_TYP[f.TYP] || f.TYP || ""), "       RK=", "      ANL=", "       GT=" + tx(f.GT)); break;
      case "M": L.push("M      NR=" + pad(f.NR, 5) + "; AKTIV=1    ; K=" + f.NR); break;
      case "J": {
        const blocks = Math.max(1, Math.ceil(Math.max(0, ...r.jdp.map(e => e.i)) / 5));
        for (let b = 0; b < blocks; b++) {
          if (b === 0) L.push("J      NR=" + pad(r.wNR || f.NR, 5) + "; K=", "     !     Start   Ende    Programm   L\u00f6schen    Zuordnung");
          else L.push("J      NR=" + (r.wNR || f.NR));
          for (let k = 1; k <= 5; k++) {
            const e = r.jdp.find(x => x.i === b * 5 + k);
            L.push("     JDP" + String(k).padStart(2, "0") + "=" + pad(e ? e.beg : "--.--", 7) + "=" + pad(e ? e.end : "--.--", 11) + "=" + pad(e ? e.prog : "", 9) + "=" + pad(e ? e.del : "N", 9) + "=" + (e ? e.zu : "0000"));
          }
        }
        break;
      }
      case "N": {
        L.push("N      NR=" + pad(r.wNR || f.NR, 5) + "; K=", "     !     MO     DI     MI     DO     FR     SA     SO  ", "     !------------------------------------------------------------");
        for (let i = 1; i <= 4; i++) for (const k of ["BEG", "END"]) {
          const a = r.sched[k + i] || Array(7).fill("--:--");
          L.push("     " + k + i + "=" + a.map(x => pad(x, 6)).join("=").replace(/\s+$/, ""));
        }
        break;
      }
      case "AX": L.push(head("AX", f), "        W=" + pad(wAX(f.W), 5) + "; E=" + pad(f.E || "keine Einh", 5) + "; Z=", "       UG=" + pad(f.UG, 5) + "; OG=" + (f.OG || ""), "       GT=" + tx(f.GT)); break;
      case "AI": L.push(head("AI", f), "        E=" + pad(f.E || "keine Einh", 5) + "; Z=     ; SMIN=     ; SMAX=", "       GT=" + tx(f.GT)); break;
      case "DS": L.push(head("DS", f), "        W=" + pad(wDS(f.W), 5) + "; Z=", "       TM=  ,=              ", "       GT=" + tx(f.GT)); break;
      case "DM": L.push(head("DM", f), "       TM=  ,=                ,=              ", "      INV=0    ; Z=", "       GT=" + tx(f.GT)); break;
      case "TX": L.push(pad("TX", 8) + "P=" + wP(f), "        W=" + tx(f.W), "       GT=" + tx(f.GT)); break;
      case "V": L.push(head("V", f), ...refs(f, ["V1", "V2", "V3", "V4"]), "       TV=", "       GT=" + tx(f.GT)); break;
      case "T": L.push(head("T", f), "       TV=" + pad(f.TV || "---", 15) + "; T1=", "       TZ=" + pad(wTZ(f.TZ), 15) + "; T2=", "       GT=" + tx(f.GT)); break;
      case "L": L.push(head("L", f), "       LD=" + pad(f.LD || "---", 15) + "; T1=", "       LB=" + pad(f.LB || "---", 15) + "; T2=", "        F=" + (f.F || ""), "       GT=" + tx(f.GT)); break;
    }
  }
  return L;
}

export function toWwf(text, name) {
  const B = parseBackup(text);
  if (!B.devices.length) throw new Error("Keine Geräte in der Sicherung");
  const out = [];
  for (const [z, devices] of byZentrale(B)) {
    const nm = name || "Zentrale " + z;
    const lines = wwfLines(ordered(z, devices, defsFor(B, z, devices)), nm);
    const rtf = "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fmodern\\fprq1\\fcharset0 Courier New;}}\r\n" +
      "{\\colortbl ;\\red0\\green0\\blue0;\\red255\\green255\\blue255;}\r\n" +
      "\\viewkind4\\uc1\\pard\\cf1\\highlight2\\lang1031\\protect\\f0\\fs24\\par\r\n" +
      lines.map(l => rtfEsc(l) + "\\par\r\n").join("") + "\\par\r\n}\r\n\0";   // wie das Original: NUL am Ende
    out.push({ z, name: nm, rtf });
  }
  return out;
}

/* ---------- Als Dateiformat anmelden ---------- */
FORMATS.add({
  id: "ddc3000-p90", order: 11, icon: "list", label: "DDC3000 (P90/EZR)",
  desc: "*.p90 – Datensicherung der DDC3000 über RS232 (Reiter „DDC3000 sichern“), alle Zentralen am Bus; *.ezr/*.pro – Sicherung aus dem K&P-Programm (gleicher Inhalt).",
  exts: ["p90", "ezr", "pro"],
  sniff: (name, head) => /^\s*# P90-Sicherung/.test(head) || (/\.p90$/i.test(name) && /^\[Gerät \S+ /m.test(head)) ||
    /^\s*(?:t1|m1|p1) \d+\.\d+\.\d+ \S+/.test(head) && (head.match(/^(?:t1|m1|p1) \d+\.\d+\.\d+ /gm) || []).length >= 3,
  parse: (text, f) => parseP90(text, f.label, f.name)
});
