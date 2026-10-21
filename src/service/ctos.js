'use strict';
/* =========================================================================
   K&P-Direktzugang (CTOS, TCP-Port 18090) – nur Lesen.
   Das Protokoll, über das das K&P Service-Tool mit DDC4000/BMR-Zentralen ab
   Firmware 1.12 spricht. Damit sind alle Objekte und Parameter der Zentrale
   lesbar, nicht nur die auf BACnet gelegten.

   Ablauf: Begrüßung "C2S1" → Zentrale schickt Hostnummer, zwei Zufallszahlen
   und die Salz-Nummer → Anmeldung "as.init" (Benutzer + CRC32 des Passworts)
   → ab da ist der Datenstrom mit dem Salz XOR-verschlüsselt.

   Das Salz (eine 1-KB-Schlüsseldatei von K&P) liegt NICHT im Repo. Der Dienst
   holt es zur Laufzeit aus der lokalen Service-Tool-Installation
   (plugins\de.hologarage.kup.util_*.jar) oder aus einer *.hg1k-Datei neben
   der .exe bzw. im Ordner daten\.

   Es werden ausschließlich Lesebefehle geschickt (siehe READ_ONLY). Befehle
   zum Schreiben, Anlegen, Löschen oder Verschieben gibt es hier nicht.
   ========================================================================= */
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_PORT = 18090;
const REQUEST_TIMEOUT = 10000;
const PING_EVERY = 15000;

/* Einzige erlaubte Befehle (alle lesend) */
const READ_ONLY = new Set([
  'as.init',  // Anmeldung
  'as.p',     // Ping
  'as.gid',   // Objekt-ID zu einer Adresse
  'as.gp',    // Eltern-Objekt
  'as.gc',    // Kind-Objekt nach Name
  'as.gcs',   // alle Kinder
  'as.hc',    // hat Kinder?
  'as.gav',   // ein Attribut lesen
  'as.gma',   // mehrere Attribute lesen
  'as.ian',   // Attribut leer?
  'as.gad',   // Attribut-Beschreibung
  'as.gae',   // Attribut-Bearbeitungsinfo (Grenzen, Typ)
  'as.gtx'    // Oberflächentext
]);

/* Attribut-Kürzel der Zentrale */
const ATTR = {
  address: 'a', name: 'n', type: 't', text: 'txt', standardText: 'stxt', userText: 'utxt',
  printable: 'pv', value: 'v', valueText: 'vt', unit: 'vut', unitId: 'vu', valueType: 'vtype',
  erased: 've', invalid: 'vi', hand: 'vh', state: 'st', stateOn: 'stOn', stateError: 'stIE', version: 'version'
};

const ERRORS = { 11: 'Protokollfehler', 14: 'ungültige Objekt-ID', 23: 'ungültige Adresse', 24: 'Verbindung getrennt',
  25: 'Anmeldung abgelehnt (Benutzer/Passwort)', 31: 'nicht unterstützt', 200: 'falscher Datentyp', 201: 'kein Wert', 202: 'unbekanntes Attribut' };
const errText = c => ERRORS[c] ? ERRORS[c] + ' (#' + c + ')' : 'Fehler #' + c;

/* ---------- CRC32 ---------- */
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(...bufs) {
  let c = -1;
  for (const b of bufs) for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
const hex8 = n => Buffer.from((n >>> 0).toString(16).toUpperCase().padStart(8, '0'), 'latin1');

/* ---------- Salz finden ---------- */
/* Minimaler ZIP-Leser: liefert [{ name, read() }] */
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < count && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nlen);
    out.push({ name, read() {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    } });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

function addSalt(list, data, from) {
  if (!data || data.length < 256) return;
  const id = crc32(data) & 0xFFFF;
  if (!list.some(s => s.id === id)) list.push({ id, data, from });
}

/* Suchorte: extraDirs (Werkbank-Ordner, daten\), dann Service-Tool-Installation(en) */
function findSalts(extraDirs, serviceToolDir) {
  const salts = [];
  for (const d of extraDirs || []) {
    try { for (const f of fs.readdirSync(d)) if (/^salt[0-9A-F]{4}\.hg1k$/i.test(f)) addSalt(salts, fs.readFileSync(path.join(d, f)), path.join(d, f)); } catch (e) {}
  }
  const roots = [serviceToolDir,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Kieback&Peter', 'Service-Tool'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Kieback&Peter', 'Service-Tool'),
    'C:\\Program Files (x86)\\Kieback&Peter\\Service-Tool', 'C:\\Program Files\\Kieback&Peter\\Service-Tool'].filter(Boolean);
  for (const r of [...new Set(roots)]) {
    let files; try { files = fs.readdirSync(path.join(r, 'plugins')); } catch (e) { continue; }
    for (const f of files) {
      if (!/^de\.hologarage\.kup\.util_.*\.jar$/i.test(f)) continue;
      const jar = path.join(r, 'plugins', f);
      try {
        for (const e of zipEntries(fs.readFileSync(jar)))
          if (/crypt\/salt[0-9A-F]{4}\.hg1k$/i.test(e.name)) addSalt(salts, e.read(), jar);
      } catch (e) {}
    }
  }
  return salts;
}

/* ---------- Datenformat ---------- */
class Oid { constructor(id) { this.id = BigInt(id); } toString() { return this.id.toString(); } }
const NEED_MORE = Symbol('mehr Daten');

/* Kleinste vorzeichenbehaftete Byte-Länge (wie im Service-Tool, 0 → 0) */
function bytesUsed(v) {
  if (v === 0n) return 0;
  let n = 1;
  while (v < -(1n << BigInt(8 * n - 1)) || v >= (1n << BigInt(8 * n - 1))) n++;
  return n;
}
function pushBE(out, v, size) { for (let i = size - 1; i >= 0; i--) out.push(Number((v >> BigInt(8 * i)) & 0xFFn)); }

function encLong(out, n) {
  const v = BigInt(n);
  if (v >= 0n) {
    if (v <= 15n) return out.push(3 + Number(v));
    const fixed = { 127: 35, 255: 42, 32767: 37, 65535: 43, 2147483647: 39, 4294967295: 44 };
    if (v <= 4294967295n && fixed[Number(v)] != null) return out.push(fixed[Number(v)]);
    if (v === 0x7FFFFFFFFFFFFFFFn) return out.push(41);
  } else {
    if (v >= -15n) return out.push(18 - Number(v));
    if (v === -128n) return out.push(34);
    if (v === -32768n) return out.push(36);
    if (v === -2147483648n) return out.push(38);
    if (v === -0x8000000000000000n) return out.push(40);
  }
  const size = bytesUsed(v);
  out.push(45 + size - 1); pushBE(out, v, size);
}
/* Kommazahl als Mantisse · 2^Exponent (wie im Service-Tool) */
function encDouble(out, d) {
  if (Number.isNaN(d)) return out.push(53);
  if (!Number.isFinite(d)) return out.push(d > 0 ? 54 : 55);
  if (d === 0) return out.push(3);
  const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, d);
  const bits = dv.getBigUint64(0), neg = bits >> 63n === 1n;
  let e = Number((bits >> 52n) & 0x7FFn), m = e === 0 ? (bits & 0xFFFFFFFFFFFFFn) << 1n : (bits & 0xFFFFFFFFFFFFFn) | 0x10000000000000n;
  e -= 1075;
  while (m && !(m & 1n)) { m >>= 1n; e++; }
  if (neg) m = -m;
  const ms = bytesUsed(m);
  if (ms <= 0) return out.push(3);
  if (e >= -128 && e <= 127) { out.push(56 + ms - 1, e & 255); pushBE(out, m, ms); }
  else if (e >= -32768 && e <= 32767) { out.push(64 + ms - 1, (e >> 8) & 255, e & 255); pushBE(out, m, ms); }
  else out.push(e < 0 ? 3 : (neg ? 55 : 54));
}
function encString(out, s) {
  if (s === '') return out.push(86);
  const b = Buffer.from(s, 'utf8'), len = b.length;
  if (len <= 167) out.push(89 + len - 1);
  else if (len <= 424) out.push(87, len - 168);
  else out.push(88, (len >> 8) & 255, len & 255);
  for (const x of b) out.push(x);
}
function encItem(out, x) {
  if (x == null) out.push(0);
  else if (typeof x === 'boolean') out.push(x ? 2 : 1);
  else if (typeof x === 'number' || typeof x === 'bigint') {
    if (typeof x === 'number' && !Number.isInteger(x)) encDouble(out, x);
    else encLong(out, x);
  } else if (x instanceof Oid) {
    if (x.id < 0n) return out.push(72);
    const size = bytesUsed(x.id);
    out.push(73 + size - 1); pushBE(out, x.id, Math.max(1, size));   // wie im Service-Tool (auch für ID 0)
  } else if (typeof x === 'string') encString(out, x);
  else throw new Error('Datentyp nicht unterstützt');
}
/* Rahmen: Typ ('R' Anfrage, '0' Antwort), Anfrage-Nr. (2 Byte), Anzahl, Elemente */
function encFrame(type, reqId, items) {
  const out = [type.charCodeAt(0)];
  if (reqId >= 0) out.push((reqId >> 8) & 255, reqId & 255);
  encLong(out, items.length);
  for (const x of items) encItem(out, x);
  return Buffer.from(out);
}

/* Leser über einem Puffer; wirft NEED_MORE, wenn der Rahmen noch nicht vollständig ist */
function makeReader(buf, start) {
  let p = start;
  const need = n => { if (p + n > buf.length) throw NEED_MORE; };
  const u8 = () => { need(1); return buf[p++]; };
  const sLong = n => { need(n); let v = BigInt.asIntN(8, BigInt(buf[p])); for (let i = 1; i < n; i++) v = (v << 8n) | BigInt(buf[p + i]); p += n; return v; };
  const uLong = n => { need(n); let v = 0n; for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(buf[p + i]); p += n; return v; };
  const bytes = n => { need(n); const b = buf.subarray(p, p + n); p += n; return b; };
  const num = v => (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(v) : v;
  function item() {
    const ft = u8();
    if (ft === 0) return null;
    if (ft === 1) return false;
    if (ft === 2) return true;
    if (ft <= 18) return ft - 3;
    if (ft <= 33) return 18 - ft;
    switch (ft) {
      case 34: return -128; case 35: return 127; case 36: return -32768; case 37: return 32767;
      case 38: return -2147483648; case 39: return 2147483647;
      case 40: return -0x8000000000000000n; case 41: return 0x7FFFFFFFFFFFFFFFn;
      case 42: return 255; case 43: return 65535; case 44: return 4294967295;
      case 53: return NaN; case 54: return Infinity; case 55: return -Infinity;
      case 72: return new Oid(-1);
      case 81: return Buffer.alloc(0);
      case 86: return '';
    }
    if (ft >= 45 && ft <= 52) return num(sLong(ft - 44));
    if (ft >= 56 && ft <= 71) {
      const es = ft < 64 ? 1 : 2, ms = ft < 64 ? ft - 55 : ft - 63;
      const e = Number(sLong(es)), m = sLong(ms);
      return Number(m) * Math.pow(2, e);
    }
    if (ft >= 73 && ft <= 80) return new Oid(uLong(ft - 72));
    if (ft >= 82 && ft <= 85) { const ls = ft - 81; let len = Number(uLong(ls)); if (ls === 1) len += 1; return Buffer.from(bytes(len)); }
    if (ft === 87) { const len = u8() + 168; return bytes(len).toString('utf8'); }
    if (ft === 88) { const len = Number(uLong(2)); return bytes(len).toString('utf8'); }
    return bytes(ft - 88).toString('utf8');
  }
  function frame() {
    const t = u8();
    if (t !== 0x52 && t !== 0x30 && t !== 0x4D) throw new Error('unbekannter Rahmentyp ' + t);
    const type = String.fromCharCode(t);
    const reqId = type === 'M' ? -1 : Number(uLong(2));
    const count = item();
    if (typeof count !== 'number' || count < 0 || count > 32767) throw new Error('ungültige Elementanzahl');
    const items = [];
    for (let i = 0; i < count; i++) items.push(item());
    return { type, reqId, items, end: p };
  }
  return { u8, uLong, frame, get pos() { return p; } };
}

/* ---------- Verbindung ---------- */
class CtosSession {
  constructor(opt) {
    this.ip = opt.ip; this.port = opt.port || DEFAULT_PORT;
    this.salts = opt.salts || [];
    this.sock = null; this.buf = Buffer.alloc(0);
    this.inSalt = null; this.inPos = 0; this.outSalt = null; this.outPos = 0;
    this.nextId = 0; this.pending = new Map(); this.queue = Promise.resolve();
    this.closed = false; this.lastComm = Date.now(); this.oidCache = new Map();
    this.host = null; this.language = null; this.languages = '';
  }

  _crypt(b, which) {
    const s = which === 'in' ? this.inSalt : this.outSalt; if (!s) return b;
    let pos = which === 'in' ? this.inPos : this.outPos;
    const o = Buffer.allocUnsafe(b.length);
    for (let i = 0; i < b.length; i++) { o[i] = b[i] ^ s[pos]; if (++pos >= s.length) pos = 0; }
    if (which === 'in') this.inPos = pos; else this.outPos = pos;
    return o;
  }
  _write(b) { this.sock.write(this._crypt(b, 'out')); }

  async open(user, pass) {
    if (!this.salts.length) throw new Error('Schlüsseldatei (Salz) nicht gefunden. Ist das K&P Service-Tool installiert? Alternativ die Datei salt*.hg1k in den Ordner daten\\ legen.');
    const sock = this.sock = net.connect({ host: this.ip, port: this.port });
    sock.setNoDelay(true);
    let hs = null;   // Begrüßung (14 Byte, unverschlüsselt)
    const handshake = new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('Zentrale antwortet nicht auf Port ' + this.port)), 6000);
      sock.once('error', e => { clearTimeout(to); reject(new Error(e.code === 'ECONNREFUSED' ? 'Port ' + this.port + ' abgelehnt' : (e.message || String(e)))); });
      sock.on('data', d => {
        if (hs === null) {
          this.buf = Buffer.concat([this.buf, d]);
          if (this.buf.length < 14) return;
          hs = this.buf.subarray(0, 14); const rest = this.buf.subarray(14); this.buf = Buffer.alloc(0);
          clearTimeout(to); resolve({ hs, rest });
        } else this._onData(d);
      });
    });
    sock.once('connect', () => {
      const ids = this.salts.slice(0, 255);
      const out = [0x43, 0x32, 0x53, 0x31, ids.length];
      for (const s of ids) out.push((s.id >> 8) & 255, s.id & 255);
      sock.write(Buffer.from(out));
    });
    const { rest } = await handshake;
    if (hs[0] !== 2) throw new Error('CTOS-Protokollfehler #1 (unerwartete Begrüßung)');
    this.hostNumber = hs.readUInt16BE(1);
    const prefix = hs.readUInt32BE(3), suffix = hs.readUInt32BE(7);
    if (hs[11] !== 1) throw new Error('CTOS-Protokollfehler #2');
    const saltId = hs.readUInt16BE(12);
    const salt = this.salts.find(s => s.id === saltId);
    if (!salt) throw new Error('Zentrale verlangt Schlüssel ' + saltId.toString(16).toUpperCase() + ', der lokal nicht vorhanden ist.');
    const pre = hex8(prefix), suf = hex8(suffix), pw = Buffer.from(pass || '', 'utf8');
    const crcPwd = crc32(pre, pw, suf);
    const inPos = suffix & 0x7FFFFFFF, outPos = crc32(suf, pw, pre) & 0x7FFFFFFF;

    sock.on('close', () => this._closed('Verbindung von der Zentrale beendet'));
    sock.on('error', e => this._closed(e.message || String(e)));
    sock.setTimeout(70000, () => { try { sock.destroy(); } catch (e) {} });

    // Anmeldung: noch unverschlüsselt senden, danach Salz einschalten
    const id = this._nextReqId();
    const reply = this._await(id, REQUEST_TIMEOUT);
    sock.write(encFrame('R', id, ['as.init', user || '', crcPwd, 2, 2]));
    this.inSalt = salt.data; this.inPos = inPos % salt.data.length;
    this.outSalt = salt.data; this.outPos = outPos % salt.data.length;
    if (rest.length) this._onData(rest);
    const r = await reply;
    const err = r.items[0];
    if (err !== 0) { this.close(); const e = new Error(errText(err)); e.code = err; throw e; }
    // [Fehler, ?, ?, ?, ?, Sprachen, Systemsprache, maxTyp, maxVrTyp]
    this.languages = r.items[5] || ''; this.language = r.items[6] || null;
    this.saltFrom = salt.from;
    this._pinger = setInterval(() => { if (!this.closed && Date.now() - this.lastComm > PING_EVERY) this.request(['as.p']).catch(() => {}); }, 5000);
    return this;
  }

  _nextReqId() { this.nextId = this.nextId >= 65535 ? 1 : this.nextId + 1; return this.nextId; }
  _await(id, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('Zeitüberschreitung')); }, ms);
      this.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
    });
  }
  _onData(d) {
    this.lastComm = Date.now();
    this.buf = Buffer.concat([this.buf, this._crypt(d, 'in')]);
    while (this.buf.length) {
      let f;
      try { f = makeReader(this.buf, 0).frame(); }
      catch (e) { if (e === NEED_MORE) return; this._closed('Datenfehler: ' + (e.message || e)); return; }
      this.buf = this.buf.subarray(f.end);
      if (f.type === '0') { const p = this.pending.get(f.reqId); if (p) { this.pending.delete(f.reqId); p.resolve(f); } }
      else if (f.type === 'R') this._write(encFrame('0', f.reqId, [31]));   // Anfragen der Zentrale: „nicht unterstützt“
      else if (f.type === 'M' && f.items[0] === 'as.close') this._closed('Zentrale hat die Sitzung beendet');
    }
  }
  _closed(why) {
    if (this.closed) return;
    this.closed = true; this.closeReason = why;
    clearInterval(this._pinger);
    for (const p of this.pending.values()) p.reject(new Error(why || 'Verbindung getrennt'));
    this.pending.clear();
    try { this.sock && this.sock.destroy(); } catch (e) {}
  }
  close() { this._closed('getrennt'); }

  /* Eine Anfrage (nacheinander, wie im Service-Tool). Liefert die Antwort-Elemente ohne Fehlercode. */
  request(items, ms) {
    const cmd = items[0];
    if (!READ_ONLY.has(cmd)) return Promise.reject(new Error('Befehl ' + cmd + ' ist gesperrt (nur Lesen).'));
    const run = async () => {
      if (this.closed) throw new Error(this.closeReason || 'nicht verbunden');
      const id = this._nextReqId();
      const reply = this._await(id, ms || REQUEST_TIMEOUT);
      this._write(encFrame('R', id, items));
      const r = await reply;
      const err = r.items[0];
      if (err !== 0) { const e = new Error(errText(err)); e.code = err; throw e; }
      return r.items.slice(1);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /* ---------- Lesefunktionen ---------- */
  async objectId(address) {
    if (this.oidCache.has(address)) return this.oidCache.get(address);
    let oid = null;
    try { const [o] = await this.request(['as.gid', address]); oid = o instanceof Oid && o.id >= 0n ? o : null; }
    catch (e) { if (this.closed) throw e; oid = null; }
    this.oidCache.set(address, oid);
    return oid;
  }
  async children(oid) {
    const r = await this.request(['as.gcs', oid, null, 4096]);
    return r.filter(x => x instanceof Oid && x.id >= 0n);
  }
  /* Mehrere Attribute; bei Fehler einzeln nachlesen. Ergebnis: { kürzel: Wert | undefined } */
  async attrs(oid, codes, lang) {
    const out = {};
    try {
      const r = await this.request(['as.gma', oid, lang === undefined ? this.language : lang, ...codes]);
      codes.forEach((c, i) => { out[c] = r[i]; });
      return out;
    } catch (e) { if (this.closed) throw e; }
    for (const c of codes) {
      try { const [v] = await this.request(['as.gav', oid, lang === undefined ? this.language : lang, c]); out[c] = v; }
      catch (e) { if (this.closed) throw e; out[c] = undefined; }
    }
    return out;
  }
}

/* JSON-taugliche Werte (BigInt/Oid/Buffer) */
function plain(v) {
  if (v instanceof Oid) return v.id >= 0n ? 'oid:' + v.id.toString() : null;
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return '0x' + v.toString('hex');
  if (typeof v === 'number' && !isFinite(v)) return String(v);
  return v;
}

/* Werte zu Adressen lesen: [{ a, ok, pv, v, unit, err }] */
async function readAddresses(sess, addresses) {
  const out = [];
  for (const a of addresses) {
    try {
      const oid = await sess.objectId(a);
      if (!oid) { out.push({ a, ok: false, err: 'Adresse unbekannt' }); continue; }
      const r = await sess.attrs(oid, ['pv', 'v', 'vut']);
      out.push({ a, ok: r.pv !== undefined || r.v !== undefined, pv: plain(r.pv), v: plain(r.v), unit: plain(r.vut) || '', err: r.pv === undefined && r.v === undefined ? 'kein Wert' : undefined });
    } catch (e) {
      if (sess.closed) throw e;
      out.push({ a, ok: false, err: e.message || String(e) });
    }
  }
  return out;
}

/* Kinder einer Adresse mit Grundangaben (für den Explorer) */
async function browse(sess, address) {
  const oid = address ? await sess.objectId(address) : await sess.objectId('//');
  if (!oid) throw new Error('Adresse unbekannt: ' + address);
  const kids = await sess.children(oid);
  const items = [];
  for (const k of kids.slice(0, 2000)) {
    const r = await sess.attrs(k, ['a', 'n', 't', 'txt', 'pv', 'vut']);
    const hasKids = await sess.request(['as.hc', k]).then(x => x[0] === true).catch(() => null);
    if (r.a) sess.oidCache.set(r.a, k);
    items.push({ a: plain(r.a), n: plain(r.n), t: plain(r.t), txt: plain(r.txt), pv: plain(r.pv), unit: plain(r.vut) || '', kids: hasKids });
  }
  return { address: address || '//', count: kids.length, items };
}

module.exports = { CtosSession, findSalts, readAddresses, browse, DEFAULT_PORT, READ_ONLY, ATTR,
  _test: { encFrame, makeReader, crc32, hex8, Oid, zipEntries } };
