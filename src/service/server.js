'use strict';
/* =========================================================================
   DDC-Werkbank – Hintergrunddienst
   Liefert die Werkbank-Oberflaeche aus und bietet die Lesebruecken
   BACnet/IP und K&P direkt (CTOS, wie das Service-Tool).
   Alles lokal auf 127.0.0.1. Es wird nichts auf Zentralen geschrieben.
   ========================================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const B = require('./bacnet.js');
const K = require('./ctos.js');

const VERSION = '0.3';
const PORT = 47902;

/* Ordner neben der .exe (in der Entwicklung: DDC-Werkbank\ im Repo oder WERKBANK_DIR) */
const BASE = process.pkg ? path.dirname(process.execPath) : (process.env.WERKBANK_DIR || path.join(__dirname, '..', '..', 'DDC-Werkbank'));
const UI_DIR = path.join(BASE, 'ui');
const CONFIG = path.join(BASE, 'config.json');
const DATA_DIR = path.join(BASE, 'daten');   // Merkliste: abgehakte Befunde, Entscheidungen, Einstellungen

/* ---------- Config ---------- */
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); }
  catch (e) { return { centrals: [], settings: { user3default: '2460' } }; }
}
function writeConfig(cfg) {
  try { fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2)); return true; }
  catch (e) { return false; }
}

/* ---------- Merkliste (daten\\<name>.json) ---------- */
const dataFile = name => path.join(DATA_DIR, name + '.json');
function readData(name) { try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); } catch (e) { return null; } }
/* Einträge zusammenführen: je Schlüssel gewinnt der neuere (t = Zeitstempel) */
function mergeData(a, b) {
  if (!a || !a.entries) return b;
  if (!b || !b.entries) return a;
  const out = { entries: Object.assign({}, a.entries) };
  for (const k of Object.keys(b.entries)) { const e = b.entries[k], c = out.entries[k]; if (!c || (e && (e.t || 0) > (c.t || 0))) out.entries[k] = e; }
  return out;
}
function writeData(name, obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = dataFile(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, dataFile(name));
}

/* ---------- K&P direkt: offene Sitzungen (Passwort nur im Speicher) ---------- */
const KP = new Map();   // "ip:port" → { sess, used }
const kpKey = (ip, port) => ip + ':' + (port || K.DEFAULT_PORT);
function kpSalts() { return K.findSalts([BASE, DATA_DIR], (readConfig().settings || {}).serviceToolDir); }
function kpGet(ip, port) {
  const e = KP.get(kpKey(ip, port));
  if (!e || e.sess.closed) { if (e) KP.delete(kpKey(ip, port)); return null; }
  e.used = Date.now(); return e.sess;
}
setInterval(() => { for (const [k, e] of KP) if (e.sess.closed || Date.now() - e.used > 10 * 60000) { e.sess.close(); KP.delete(k); } }, 60000).unref();

/* ---------- kleine Helfer ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function sendJson(res, obj, code) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 8 * 1024 * 1024) { reject(new Error('zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function safeJoin(root, p) {
  const full = path.normalize(path.join(root, p));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/* ---------- statische Oberflaeche ---------- */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/DDC-Werkbank.html';
  const file = safeJoin(UI_DIR, rel);
  if (!file) { res.writeHead(403); res.end('verboten'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // Index-Fallback, falls Datei nicht da
      if (rel === '/DDC-Werkbank.html') { res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<h1>ui\\DDC-Werkbank.html fehlt</h1><p>Die Oberflaeche wurde nicht gefunden. Liegt der Ordner <code>ui</code> neben der .exe?</p>'); return; }
      res.writeHead(404); res.end('nicht gefunden'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

/* ---------- API ---------- */
async function handleApi(req, res, u) {
  const q = u.searchParams;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; }

  if (u.pathname === '/api/health') return sendJson(res, { ok: true, service: 'DDC-Werkbank', version: VERSION, port: PORT, data: true });

  if (u.pathname.startsWith('/api/data/')) {
    const name = u.pathname.slice('/api/data/'.length);
    if (!/^[a-z0-9_-]{1,40}$/.test(name)) return sendJson(res, { ok: false, err: 'ungültiger Name' }, 400);
    if (req.method === 'POST') {
      let body; try { body = await readBody(req); } catch (e) { return sendJson(res, { ok: false, err: 'ungültiger Body' }, 400); }
      try { const merged = mergeData(readData(name), body); writeData(name, merged); return sendJson(res, { ok: true, data: merged }); }
      catch (e) { return sendJson(res, { ok: false, err: String(e.message || e) }, 500); }
    }
    return sendJson(res, { ok: true, data: readData(name) });
  }

  if (u.pathname === '/api/config') {
    if (req.method === 'POST') { const body = await readBody(req); const okw = writeConfig(body); return sendJson(res, { ok: okw }); }
    return sendJson(res, readConfig());
  }

  if (u.pathname === '/api/identify') {
    const ip = q.get('ip'); if (!ip) return sendJson(res, { ok: false, err: 'ip fehlt' }, 400);
    try { return sendJson(res, await B.identify(ip, q.get('inst'))); }
    catch (e) { return sendJson(res, { ok: false, err: String(e.message || e) }, 500); }
  }

  if (u.pathname === '/api/browse') {
    const ip = q.get('ip'), inst = Number(q.get('inst')); if (!ip || !inst) return sendJson(res, { ok: false, err: 'ip/inst fehlt' }, 400);
    try { return sendJson(res, await B.browse(ip, inst, true)); }
    catch (e) { return sendJson(res, { ok: false, err: String(e.message || e) }, 500); }
  }

  if (u.pathname === '/api/live') {
    if (req.method !== 'POST') return sendJson(res, { ok: false, err: 'POST erwartet' }, 405);
    let body; try { body = await readBody(req); } catch (e) { return sendJson(res, { ok: false, err: 'ungültiger Body' }, 400); }
    const ip = body.ip, objects = Array.isArray(body.objects) ? body.objects : [];
    if (!ip || !objects.length) return sendJson(res, { ok: false, err: 'ip/objects fehlt' }, 400);
    try { return sendJson(res, await B.readValues(ip, objects)); }
    catch (e) { return sendJson(res, { ok: false, err: String(e.message || e) }, 500); }
  }

  if (u.pathname.startsWith('/api/kp/')) return handleKp(req, res, u.pathname.slice(8));

  sendJson(res, { ok: false, err: 'unbekannte Route' }, 404);
}

/* K&P direkt: status · verbinden · lesen · explorer · trennen */
async function handleKp(req, res, what) {
  if (what === 'status') {
    const salts = kpSalts();
    return sendJson(res, { ok: true, salt: salts.length > 0, from: salts.length ? salts[0].from : '', port: K.DEFAULT_PORT,
      sessions: [...KP.values()].filter(e => !e.sess.closed).map(e => ({ ip: e.sess.ip, port: e.sess.port })) });
  }
  if (req.method !== 'POST') return sendJson(res, { ok: false, err: 'POST erwartet' }, 405);
  let body; try { body = await readBody(req); } catch (e) { return sendJson(res, { ok: false, err: 'ungültiger Body' }, 400); }
  const ip = String(body.ip || '').trim(), port = parseInt(body.port, 10) || K.DEFAULT_PORT;
  if (!ip) return sendJson(res, { ok: false, err: 'ip fehlt' }, 400);
  try {
    if (what === 'verbinden') {
      const old = KP.get(kpKey(ip, port)); if (old) { old.sess.close(); KP.delete(kpKey(ip, port)); }
      const sess = new K.CtosSession({ ip, port, salts: kpSalts() });
      await sess.open(String(body.user || ''), String(body.pass || ''));
      KP.set(kpKey(ip, port), { sess, used: Date.now() });
      return sendJson(res, { ok: true, host: sess.hostNumber, language: sess.language, languages: sess.languages });
    }
    if (what === 'trennen') {
      const e = KP.get(kpKey(ip, port)); if (e) { e.sess.close(); KP.delete(kpKey(ip, port)); }
      return sendJson(res, { ok: true });
    }
    const sess = kpGet(ip, port);
    if (!sess) return sendJson(res, { ok: false, err: 'nicht angemeldet', login: true });
    if (what === 'lesen') {
      const list = Array.isArray(body.adressen) ? body.adressen.filter(a => typeof a === 'string').slice(0, 20000) : [];
      return sendJson(res, { ok: true, values: await K.readAddresses(sess, list) });
    }
    if (what === 'explorer') return sendJson(res, Object.assign({ ok: true }, await K.browse(sess, String(body.adresse || ''))));
    return sendJson(res, { ok: false, err: 'unbekannte Route' }, 404);
  } catch (e) {
    return sendJson(res, { ok: false, err: String(e.message || e), login: e.code === 25 }, 200);
  }
}

/* ---------- Server ---------- */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:' + PORT);
  if (u.pathname.startsWith('/api/')) return handleApi(req, res, u).catch(e => { try { sendJson(res, { ok: false, err: String(e) }, 500); } catch (_) {} });
  serveStatic(req, res, req.url);
});

function holdOpen() {
  try { process.stdin.setRawMode && process.stdin.setRawMode(true); } catch (e) {}
  process.stdin.resume(); process.stdin.on('data', () => process.exit(1));
}

server.on('error', err => {
  console.log('');
  if (err.code === 'EADDRINUSE') { console.log('  FEHLER: Port ' + PORT + ' ist belegt. Läuft die Werkbank schon?'); }
  else console.log('  FEHLER beim Start: ' + err.message);
  console.log('  Zum Schließen eine Taste drücken.');
  holdOpen();
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://localhost:' + PORT;
  console.log('');
  console.log('  ===== DDC-WERKBANK DIENST v' + VERSION + ' =====');
  console.log('  Oberfläche:  ' + url);
  console.log('  Ordner:      ' + BASE);
  console.log('  Merkliste:   ' + DATA_DIR);
  console.log('');
  console.log('  Der Browser sollte sich gleich öffnen. Falls nicht, Adresse oben aufrufen.');
  console.log('  Zum Beenden dieses Fenster schließen (oder Strg+C).');
  console.log('');
  if (process.platform === 'win32') exec('cmd /c start "" "' + url + '"');
});
