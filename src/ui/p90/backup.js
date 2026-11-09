import { decode } from "./cp850.js";
import { DEVTYPES } from "./devtypes.js";

/* =========================================================================
   Datensicherung einer DDC3000-Zentrale (inkl. aller Zentralen am
   Zentralenbus) über P90 – nur Lesebefehle – und Einlesen von .p90-Dateien.
   Ablauf und Dateiformat: docs/P90-PROTOKOLL.md, Abschnitt 5.
   ========================================================================= */
const isZ6 = t => /^Z6 /.test(t);
// Fehler: "Z2 <code> …" oder "Z6 <code≠000> …"
export const isError = t => /^Z2 /.test(t) || /^Z6 (?!000 )\d{3} /.test(t);

export function devName(group, type, extra) {
  const k = `${group} ${type}`;
  return (extra && extra[k]) || DEVTYPES[k] || `Typ ${group}/${type}`;
}

/**
 * Sicherung erstellen.
 * link:     P90Link (verbunden)
 * options:  { definitions: true,          // D0/D2/D4 mitsichern (≈ 4 min je Zentrale)
 *             onProgress(info),            // { phase, text, device?, done?, total?, count? }
 *             signal }                     // AbortSignal (optional)
 * Ergebnis: { text, ident, zentralen, devices, failed, seconds, aborted }
 *   text  = Dateiinhalt (UTF-8). Format: PROTOKOLL.md, Abschnitt "Sicherungsdatei".
 */
export async function createBackup(link, options = {}) {
  const { definitions = true, onProgress = () => {}, signal } = options;
  const t0 = Date.now();
  const out = [];
  let failed = 0, aborted = false;
  const prog = (phase, text, extra = {}) => onProgress({ phase, text, ...extra });
  const checkAbort = () => { if (signal && signal.aborted) throw new Error("abgebrochen"); };
  let abortDone = null;                       // Abbruch wartet, bis die DDC aufgehört hat zu senden
  const onAbort = () => { abortDone = link.abort(); };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  let ident = null; const zentralen = []; const devices = [];
  try {
    // 1. Anmelden
    prog("login", "Anmelden …");
    ident = await link.login();
    checkAbort();

    // 2. Zentralen am Zentralenbus: "T0 *.0" -> t1 z.k.0 <gruppe> <typ> <status>, Ende "Z6 …"
    prog("zentralen", "Suche Zentralen am Bus …");
    const zres = await link.request("T0 *.0", isZ6);
    checkAbort();
    for (const t of [...zres.lines, zres.end || ""]) {
      const m = t.match(/^(?:t1|Z6) (\d+\.\d+\.0) /);
      if (m && !zentralen.includes(m[1])) zentralen.push(m[1]);
    }
    if (!zentralen.length) throw new Error("Keine Zentrale gefunden (" + zres.status + ")");

    // 3. Geräte je Zentrale: "T0 <k>.*" -> Zentrale selbst, Regelkreise, SBM, FBM …
    for (const z of zentralen) {
      checkAbort();
      const k = z.split(".")[1];
      prog("geraete", `Geräteliste von Zentrale ${z} …`);
      const dres = await link.request(`T0 ${k}.*`, isZ6);
      const seen = new Set(devices.map(d => d.addr));
      for (const t of [...dres.lines, dres.end || ""]) {
        const m = t.match(/^(?:t1|Z6) (\d+\.\d+\.\d+) (\d+) (\d+)/);
        if (m && !seen.has(m[1])) { seen.add(m[1]); devices.push({ addr: m[1], group: m[2], type: m[3], t1: /^t1 /.test(t) ? t : "" }); }
      }
    }
    prog("geraete", `${devices.length} Geräte gefunden`, { total: devices.length });

    out.push("# P90-Sicherung (Kieback&Peter DDC3000)",
             `# Erstellt: ${new Date().toLocaleString("de-DE")}`,
             `# Kennung: ${ident}`,
             `# Geräte: ${devices.length}`,
             "# Zeichensatz: UTF-8 (Klartexte der DDC aus CP850 umgewandelt)", "");

    // 4. Je Gerät: Menüs (m0 -> m1) und Parameterwerte (p0 -> p1)
    let n = 0;
    for (const d of devices) {
      checkAbort();
      n++;
      const [, k, p] = d.addr.split(".");
      const name = devName(d.group, d.type);
      prog("geraet", `Gerät ${n}/${devices.length}: ${d.addr} ${name}`, { device: d.addr, done: n - 1, total: devices.length });
      const mres = await link.request(`m0 ${k}.${p} *`, isZ6);
      checkAbort();
      const pres = await link.request(`p0 ${k}.${p} *`, isZ6, {
        onLine: c => prog("geraet", `Gerät ${n}/${devices.length}: ${d.addr} ${name} – ${c} Werte`, { device: d.addr, done: n - 1, total: devices.length, count: c }),
      });
      const ok = mres.status === "ok" && pres.status === "ok" && !isError(mres.end || "") && !isError(pres.end || "");
      if (!ok) failed++;
      d.name = name; d.menus = mres.lines.length; d.values = pres.lines.length; d.ok = ok;
      out.push(`[Gerät ${d.addr} ${name} ${d.group} ${d.type}]`, ...(d.t1 ? [d.t1] : []), ...mres.lines, ...pres.lines,
               `# Ende m0: ${mres.end || mres.status} | Ende p0: ${pres.end || pres.status}`, "");
      prog("geraet", `Gerät ${n}/${devices.length}: ${d.addr} ${name} – ${d.menus} Menüs, ${d.values} Werte`, { device: d.addr, done: n, total: devices.length, ok });
    }

    // 5. Definitionen je Zentrale (Parameternamen, Grenzen, Menüs, Gerätetypen) – Grundlage für
    //    Anzeige/Bearbeitung und um beim Einspielen Istwerte (Attribut-Bit 0x40) auszulassen
    if (definitions) {
      for (const z of zentralen) {
        const k = z.split(".")[1];
        for (const [cmd, what] of [[`D0 ${k}  *`, "Parameterdefinitionen"], [`D2 ${k} *`, "Menüdefinitionen"], [`D4 ${k} *`, "Gerätedefinitionen"]]) {
          checkAbort();
          prog("definitionen", `${what} von Zentrale ${z} …`);
          const r = await link.request(cmd, isZ6, { onLine: c => prog("definitionen", `${what} von Zentrale ${z} … ${c} Zeilen`, { count: c }) });
          out.push(`[Definitionen ${z} ${cmd.slice(0, 2)} ${what}]`, ...r.lines, `# Ende ${cmd.slice(0, 2)}: ${r.end || r.status}`, "");
        }
      }
    }
  } catch (e) {
    aborted = true;
    out.push(`# ABGEBROCHEN: ${e.message}`);
    prog("fehler", "Abgebrochen: " + e.message);
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    if (abortDone) { prog("fehler", "Abgebrochen – warte, bis die DDC aufhört zu senden …"); await abortDone; }
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  if (!aborted) {
    out.push(`# Fertig nach ${seconds} s, ${failed ? failed + " Gerät(e) mit Fehler" : "ohne Fehler"}`);
    prog("fertig", `Fertig: ${devices.length} Geräte in ${seconds} s${failed ? `, ${failed} mit Fehler` : ""}`);
  }
  return { text: out.join("\r\n") + "\r\n", ident, zentralen, devices, failed, seconds, aborted };
}

/**
 * Sicherungsdatei einlesen (eigenes Format, auch Dateien aus dem bisherigen HTML-Tool).
 * -> { header:{…}, devices:[{addr,name,group,type,menus:[m1…],values:[p1…],ok}], definitions:{D1:[],D3:[],D5:[]}, aborted }
 */
export function parseBackup(text) {
  // Ältere Dateien aus dem HTML-Tool enthalten die CP850-Bytes als Zeichen U+0080–U+00FF.
  // Ältere Dateien (HTML-Tool, .EZR/.PRO des K&P-Programms) enthalten die CP850-Bytes roh – je nach
  // Einlesen als Zeichen U+0080–U+00FF oder als Windows-1252-Zeichen (€, „ …). Beides → Byte → CP850.
  const old = !/Zeichensatz: UTF-8/.test(text.slice(0, 2000));
  const byte = ch => CP1252_REV.get(ch) ?? ch.charCodeAt(0);
  const fix = s => old ? s.replace(/[^\x00-\x7f]+/g, x => decode(Array.from(x, byte))) : s;
  const res = { header: {}, devices: [], definitions: { D1: [], D3: [], D5: [] }, aborted: false };
  let dev = null, def = null;
  /* Datei ohne [Gerät …]-Abschnitte (.EZR/.PRO, reine Antwortzeilen): Geräte aus den Adressen bilden */
  const plain = !/^\[Gerät /m.test(text);
  const byAddr = new Map();
  const plainDev = addr => {
    if (!byAddr.has(addr)) { const d = { addr, name: "", group: "", type: "", text: "", menus: [], values: [], ok: true }; byAddr.set(addr, d); res.devices.push(d); }
    return byAddr.get(addr);
  };
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/\r$/, "");
    let m;
    if ((m = l.match(/^# (Erstellt|Kennung|Geräte): (.*)$/))) { res.header[m[1]] = m[2]; continue; }
    if (/^# ABGEBROCHEN/.test(l)) { res.aborted = true; continue; }
    if ((m = l.match(/^\[Gerät (\S+) (.+) (\d+) (\d+)\]$/))) { dev = { addr: m[1], name: fix(m[2]), group: m[3], type: m[4], text: "", menus: [], values: [], ok: true }; res.devices.push(dev); def = null; continue; }
    if ((m = l.match(/^\[Definitionen \S+ (D[024]) /))) { def = { D0: "D1", D2: "D3", D4: "D5" }[m[1]]; dev = null; continue; }
    if (dev && (m = l.match(/^# Ende m0: (.*) \| Ende p0: (.*)$/))) { dev.ok = [m[1], m[2]].every(e => /^Z6 000 /.test(e)); continue; }
    if (!l || l.startsWith("#")) continue;
    if (l.startsWith("t1 ") && (m = l.match(/^t1 (\d+\.\d+\.\d+) (\d+) (\d+) \S+ ?(.*)$/))) {
      const d = plain ? plainDev(m[1]) : (dev && dev.addr === m[1] ? dev : null);
      if (d) { d.group = d.group || m[2]; d.type = d.type || m[3]; d.text = fix(m[4]).trim(); }
      continue;
    }
    if (plain && (m = l.match(/^[mp]1 (\d+\.\d+\.\d+) /))) dev = plainDev(m[1]);
    if (dev && l.startsWith("m1 ")) dev.menus.push(fix(l));
    else if (dev && l.startsWith("p1 ")) dev.values.push(fix(l));
    else if (def && l.startsWith(def + " ")) res.definitions[def].push(fix(l));
  }
  res.plain = plain;
  for (const d of res.devices) if (!d.name) d.name = d.group ? devName(d.group, d.type) : "";
  return res;
}

/* Text, der aus roh gelesenen CP850-Bytes entstand (als Windows-1252 oder Latin-1), richtig wandeln */
export function fixCp850(s) {
  return s.replace(/[^\x00-\x7f]+/g, x => decode(Array.from(x, ch => CP1252_REV.get(ch) ?? ch.charCodeAt(0))));
}

/* Windows-1252-Zeichen → Byte (für roh eingelesene CP850-Dateien) */
const CP1252_REV = (() => {
  const m = new Map();
  try { const dec = new TextDecoder("windows-1252"); for (let b = 0x80; b < 0x100; b++) { const ch = dec.decode(Uint8Array.of(b)); if (ch.charCodeAt(0) !== b) m.set(ch, b); } }
  catch (e) { /* ohne Decoder: nur U+0080–U+00FF */ }
  return m;
})();
