'use strict';
/* =========================================================================
   Wartungsdoku (.wtgml) über den Dienst öffnen und direkt zurückschreiben.

   Wozu: Die Oberfläche schreibt Änderungen normalerweise über den Browser in
   die geöffnete Datei (File System Access). Auf manchen Rechnern gibt der
   Browser die gewählte Datei nicht heraus – dann geht derselbe Weg hier über
   die .exe: Ordner ansehen, .wtgml lesen, .wtgml zurückschreiben.

   Grenzen (bewusst eng):
   - gelesen und geschrieben werden nur vorhandene .wtgml-Dateien
   - geschrieben wird nur, was wie eine Wartungsdoku aussieht (<Maintenance …>)
   - nur die Werkbank-Seite selbst darf diese Routen rufen (siehe erlaubt())
   ========================================================================= */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const EXT = /\.wtgml$/i;
const MAX_BYTES = 60 * 1024 * 1024;
const MAX_ENTRIES = 3000;

/* Nur Anfragen der eigenen Seite: richtiger Host (kein DNS-Rebinding), keine fremde Herkunft,
   und der eigene Kopf „X-Werkbank“ – den kann eine fremde Seite nicht ohne Freigabe mitschicken. */
function erlaubt(headers, port) {
  const own = ['localhost:' + port, '127.0.0.1:' + port];
  const host = String(headers.host || '').toLowerCase();
  if (!own.includes(host)) return false;
  const origin = headers.origin;
  if (origin && !own.map(h => 'http://' + h).includes(String(origin).toLowerCase())) return false;
  const site = headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;
  return headers['x-werkbank'] === '1';
}

/* Alles ohne Blockieren: ein träges Netzlaufwerk darf den Dienst nicht anhalten */
const within = (ms, p, dflt) => Promise.race([p, new Promise(res => setTimeout(() => res(dflt), ms))]);
const isDir = p => within(1500, fsp.stat(p).then(s => s.isDirectory(), () => false), false);

/* Startpunkte: Desktop, Dokumente, Downloads (auch unter OneDrive), Benutzerordner, Laufwerke */
async function orte() {
  const cand = [];
  const add = (name, p) => { if (p) cand.push({ name, pfad: path.resolve(p) }); };
  const home = os.homedir();
  const roots = [home, process.env.OneDriveCommercial, process.env.OneDrive, process.env.OneDriveConsumer].filter(Boolean);
  for (const r of roots) {
    const od = r !== home ? ' (OneDrive)' : '';
    add('Desktop' + od, path.join(r, 'Desktop'));
    add('Dokumente' + od, path.join(r, 'Documents')); add('Dokumente' + od, path.join(r, 'Dokumente'));
    if (r === home) add('Downloads', path.join(r, 'Downloads'));
  }
  add('Benutzerordner', home);
  if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; cand.push({ name: d, pfad: d }); }   // C: … Z:
  } else add('/', '/');
  const there = await Promise.all(cand.map(c => isDir(c.pfad)));
  const out = [], seen = new Set();
  cand.forEach((c, i) => { const k = c.pfad.toLowerCase(); if (there[i] && !seen.has(k)) { seen.add(k); out.push(c); } });
  return out;
}

const natCmp = (a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });

/* Ordnerinhalt: Unterordner und .wtgml-Dateien */
async function liste(pfad) {
  if (!pfad || !path.isAbsolute(String(pfad))) return { ok: false, err: 'Bitte einen vollständigen Pfad angeben (z. B. C:\\Wartung).' };
  const dir = path.resolve(String(pfad));
  let st; try { st = await fsp.stat(dir); } catch (e) { return { ok: false, err: 'Den Ordner gibt es nicht: ' + dir }; }
  /* Pfad einer Datei eingefügt → ihren Ordner zeigen */
  if (!st.isDirectory()) return Object.assign(await liste(path.dirname(dir)), { datei: EXT.test(dir) ? dir : '' });
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (e) { return { ok: false, err: 'Kein Zugriff auf ' + dir + ' (' + (e.code || e.message) + ')' }; }
  const ordner = [], dateien = [];
  for (const e of ents) {
    if (ordner.length + dateien.length >= MAX_ENTRIES) break;
    const n = e.name;
    if (n.startsWith('.') || n.startsWith('$') || /^(System Volume Information|Config\.Msi)$/i.test(n)) continue;
    let dirLike = e.isDirectory(), fileLike = e.isFile();
    if (e.isSymbolicLink()) { try { const s = await fsp.stat(path.join(dir, n)); dirLike = s.isDirectory(); fileLike = s.isFile(); } catch (x) { continue; } }
    if (dirLike) ordner.push({ name: n });
    else if (fileLike && EXT.test(n)) {
      let s = null; try { s = await fsp.stat(path.join(dir, n)); } catch (x) { /* nicht lesbar */ }
      dateien.push({ name: n, size: s ? s.size : 0, mtime: s ? s.mtimeMs : 0 });
    }
  }
  ordner.sort((a, b) => natCmp(a.name, b.name));
  dateien.sort((a, b) => b.mtime - a.mtime || natCmp(a.name, b.name));
  const parent = path.dirname(dir);
  return { ok: true, pfad: dir, eltern: parent === dir ? '' : parent, sep: path.sep, ordner, dateien };
}

async function pruefDatei(pfad) {
  if (!pfad || !path.isAbsolute(String(pfad))) return { err: 'Pfad fehlt' };
  const file = path.resolve(String(pfad));
  if (!EXT.test(file)) return { err: 'Nur .wtgml-Dateien' };
  let st; try { st = await fsp.stat(file); } catch (e) { return { err: 'Die Datei gibt es nicht (mehr): ' + file }; }
  if (!st.isFile()) return { err: 'Das ist keine Datei: ' + file };
  return { file, st };
}

/* .wtgml lesen → Bytes (base64), damit die Oberfläche den Zeichensatz wie sonst erkennt */
async function lesen(pfad) {
  const c = await pruefDatei(pfad); if (c.err) return { ok: false, err: c.err };
  if (c.st.size > MAX_BYTES) return { ok: false, err: 'Datei zu groß (' + Math.round(c.st.size / 1048576) + ' MB)' };
  try {
    const buf = await fsp.readFile(c.file);
    const st = await fsp.stat(c.file);
    return { ok: true, pfad: c.file, name: path.basename(c.file), mtime: st.mtimeMs, size: buf.length, data: buf.toString('base64') };
  } catch (e) { return { ok: false, err: 'Lesen fehlgeschlagen: ' + (e.code || e.message) }; }
}

/* .wtgml zurückschreiben. mtime = Stand, den die Oberfläche kennt: hat sich die Datei seitdem geändert
   (z. B. im Wartungsprogramm gespeichert), wird nicht überschrieben – außer mit force. */
async function schreiben(body) {
  body = body || {};
  const c = await pruefDatei(body.pfad); if (c.err) return { ok: false, err: c.err };
  const text = body.text;
  if (typeof text !== 'string' || !/<([\w-]+:)?Maintenance[\s>]/.test(text.slice(0, 4000))) return { ok: false, err: 'Das ist keine Wartungsdoku – nicht geschrieben.' };
  if (body.mtime != null && !body.force && Math.abs(c.st.mtimeMs - Number(body.mtime)) > 2) return { ok: false, konflikt: true, mtime: c.st.mtimeMs, err: 'Die Datei wurde außerhalb der Werkbank geändert.' };
  const tmp = c.file + '.wbtmp';
  try {
    /* erst vollständig daneben schreiben, dann austauschen – so bleibt nie eine halbe Datei zurück */
    await fsp.writeFile(tmp, text, 'utf8');
    try { await fsp.rename(tmp, c.file); }
    catch (e) {
      /* Austauschen nicht erlaubt (Datei woanders geöffnet, Netzlaufwerk): direkt hineinschreiben */
      await fsp.writeFile(c.file, text, 'utf8');
      await fsp.unlink(tmp).catch(() => {});
    }
    return { ok: true, mtime: (await fsp.stat(c.file)).mtimeMs };
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {});
    const why = e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES' ? 'kein Schreibzugriff – ist die Datei in einem anderen Programm geöffnet oder schreibgeschützt?' : (e.code || e.message);
    return { ok: false, err: 'Speichern fehlgeschlagen: ' + why };
  }
}

module.exports = { erlaubt, orte, liste, lesen, schreiben, MAX_BODY: MAX_BYTES * 2 };
