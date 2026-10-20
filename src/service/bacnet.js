'use strict';
/* =========================================================================
   BACnet/IP – nur Lesen. Portiert aus dem geprüften PowerShell-Test.
   Who-Is / I-Am, ReadProperty (Device-Eigenschaften, present-value,
   object-name, object-list per Index). Keine Schreibdienste.
   ========================================================================= */
const dgram = require('dgram');

const BPORT = 47808;

/* ---------- Objekt-IDs ---------- */
const oidOf = (type, inst) => ((type & 0x3FF) * 4194304) + (inst & 0x3FFFFF);
const DEV = 8; // Device-Objekttyp

/* ---------- Pakete bauen ---------- */
// Unicast Who-Is ohne Bereichsgrenzen (an genau eine Zentrale)
const WHOIS = Buffer.from([0x81, 0x0A, 0x00, 0x08, 0x01, 0x00, 0x10, 0x08]);

function buildReadProperty(invoke, type, inst, prop, arrayIndex) {
  const oid = oidOf(type, inst);
  const apdu = [0x00, 0x05, invoke & 0xff, 0x0C,
    0x0C, (oid >>> 24) & 255, (oid >>> 16) & 255, (oid >>> 8) & 255, oid & 255,
    0x19, prop & 0xff];
  if (arrayIndex != null) {
    if (arrayIndex < 256) apdu.push(0x29, arrayIndex & 255);
    else apdu.push(0x2A, (arrayIndex >>> 8) & 255, arrayIndex & 255);
  }
  const npdu = [0x01, 0x04];
  const len = 4 + npdu.length + apdu.length;
  return Buffer.from([0x81, 0x0A, (len >>> 8) & 255, len & 255].concat(npdu, apdu));
}

/* ---------- NPDU: Offset bis zur APDU ---------- */
function apduOffset(d) {
  if (d.length < 6 || d[0] !== 0x81) return null;
  const f = d[1]; let i = 4;
  if (f === 0x04) i = 10; else if (f !== 0x0A && f !== 0x0B) return null;
  if (d[i] !== 0x01) return null;
  const ctl = d[i + 1]; i += 2;
  if (ctl & 0x20) i += 3 + d[i + 2];
  if (ctl & 0x08) i += 3 + d[i + 2];
  if (ctl & 0x20) i += 1;
  if (ctl & 0x80) return null;
  return i;
}

/* ---------- Anwendungswert dekodieren ---------- */
function decodeValue(d, p) {
  if (p >= d.length) return null;
  const t = d[p], tn = t >> 4, l = t & 0x07;
  if (t === 0xC4) { // Object Identifier
    const oid = d.readUInt32BE(p + 1);
    return { v: { type: oid >>> 22, inst: oid & 0x3FFFFF }, kind: 'oid', next: p + 5 };
  }
  if (tn === 4) return { v: d.readFloatBE(p + 1), kind: 'real', next: p + 5 }; // Real
  if (tn === 2) { let v = 0; for (let i = 0; i < l; i++) v = v * 256 + d[p + 1 + i]; return { v, kind: 'uint', next: p + 1 + l }; }
  if (tn === 3) { let v = (d[p + 1] & 0x80) ? -1 : 0; for (let i = 0; i < l; i++) v = (v * 256) + d[p + 1 + i]; return { v, kind: 'int', next: p + 1 + l }; }
  if (tn === 9) { let v = 0; for (let i = 0; i < l; i++) v = v * 256 + d[p + 1 + i]; return { v, kind: 'enum', next: p + 1 + l }; }
  if (tn === 1) return { v: l === 1, kind: 'bool', next: p + 1 }; // Boolean (Wert im Längenfeld)
  if (tn === 7) { // CharacterString
    let pp = p + 1, len = l;
    if (l === 5) { len = d[pp]; pp++; if (len === 254) { len = (d[pp] << 8) + d[pp + 1]; pp += 2; } else if (len === 255) { len = d.readUInt32BE(pp); pp += 4; } }
    if (len < 1) return { v: '', kind: 'str', next: pp };
    const enc = d[pp], start = pp + 1, n = len - 1, bytes = d.slice(start, start + n);
    let str;
    if (enc === 0) str = bytes.toString('utf8');
    else if (enc === 4) { const b = Buffer.from(bytes); str = (b.length % 2 === 0) ? b.swap16().toString('utf16le') : b.toString('latin1'); }
    else str = bytes.toString('latin1');
    return { v: str, kind: 'str', next: start + n };
  }
  if (tn === 8) { let v = 0; for (let i = 0; i < l; i++) v = v * 256 + d[p + 1 + i]; return { v, kind: 'bits', next: p + 1 + l }; }
  return { v: null, kind: 'other', next: p + 1 + (l === 5 ? 1 + d[p + 1] : l) };
}

/* ---------- Wert aus einem ReadProperty-ACK holen ---------- */
function ackValue(d, a) {
  // a zeigt auf [0x30][inv][0x0C service] ...
  let p = a + 3;
  if (d[p] === 0x0C) p += 5;                      // ctx0 object id
  if ((d[p] & 0xF8) === 0x18) p += 1 + (d[p] & 7); // ctx1 property id
  if ((d[p] & 0xF8) === 0x28) p += 1 + (d[p] & 7); // ctx2 array index (optional)
  if (d[p] !== 0x3E) return null;                  // opening tag 3
  return decodeValue(d, p + 1);
}

/* =========================================================================
   Session: ein UDP-Socket, InvokeID-Zuordnung, Timeouts, begrenzte Parallelität
   ========================================================================= */
class Session {
  constructor() {
    this.sock = null; this.port = 0; this.invoke = 0;
    this.dst = BPORT;           // Zielport (für Tests überschreibbar)
    this.pending = new Map();   // invokeId -> {resolve, timer}
    this.iamWaiters = [];       // {ip, resolve, timer}
    this.inflight = 0; this.max = 10; this.queue = [];
  }
  open() {
    return new Promise(resolve => {
      const tryBind = port => {
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        let settled = false;
        s.on('message', (msg, rinfo) => this._dispatch(msg, rinfo));
        s.on('error', () => {
          if (settled) return; settled = true;
          try { s.close(); } catch (e) {}
          if (port === BPORT) tryBind(0); else { this.sock = s; this.port = 0; resolve(); }
        });
        s.bind(port, () => {
          if (settled) return; settled = true;
          try { s.setBroadcast(true); } catch (e) {}
          this.sock = s; this.port = s.address().port; resolve();
        });
      };
      tryBind(BPORT);
    });
  }
  close() { try { this.sock && this.sock.close(); } catch (e) {} this.sock = null; }

  _dispatch(d, rinfo) {
    const a = apduOffset(d); if (a == null) return;
    const pt = d[a] >> 4;
    if (pt === 1 && d[a + 1] === 0x00 && d[a + 2] === 0xC4) {
      // I-Am
      const oid = d.readUInt32BE(a + 3), inst = oid & 0x3FFFFF;
      const r1 = decodeValue(d, a + 7);
      const r2 = r1 && decodeValue(d, r1.next);
      const r3 = r2 && decodeValue(d, r2.next);
      const info = { inst, maxApdu: r1 ? r1.v : 0, vendor: r3 ? r3.v : null, ip: rinfo.address };
      for (let i = this.iamWaiters.length - 1; i >= 0; i--) {
        const w = this.iamWaiters[i];
        if (!w.ip || w.ip === rinfo.address) { clearTimeout(w.timer); this.iamWaiters.splice(i, 1); w.resolve(info); }
      }
      return;
    }
    if (pt === 3 || pt === 5 || pt === 6 || pt === 7) {
      const inv = d[a + 1], waiter = this.pending.get(inv);
      if (!waiter) return;
      clearTimeout(waiter.timer); this.pending.delete(inv);
      waiter.resolve({ d, a, pt });
    }
  }

  _send(buf, ip) { return new Promise(res => this.sock.send(buf, this.dst, ip, () => res())); }

  whoIs(ip, timeout) {
    return new Promise(async resolve => {
      const w = { ip, resolve, timer: setTimeout(() => { const i = this.iamWaiters.indexOf(w); if (i >= 0) this.iamWaiters.splice(i, 1); resolve(null); }, timeout || 3000) };
      this.iamWaiters.push(w);
      await this._send(WHOIS, ip);
    });
  }

  _nextInvoke() { this.invoke = (this.invoke + 1) & 0xff; if (this.invoke === 0) this.invoke = 1; return this.invoke; }

  // Roh-ReadProperty mit Nebenläufigkeitsbegrenzung
  readProp(ip, type, inst, prop, arrayIndex, timeout) {
    return new Promise(resolve => {
      const job = () => {
        const invoke = this._nextInvoke();
        const buf = buildReadProperty(invoke, type, inst, prop, arrayIndex);
        const timer = setTimeout(() => { this.pending.delete(invoke); this._done(); resolve({ ok: false, err: 'timeout' }); }, timeout || 1500);
        this.pending.set(invoke, {
          timer, resolve: ({ d, a, pt }) => {
            this._done();
            if (pt === 3) { const r = ackValue(d, a); resolve(r ? { ok: true, kind: r.kind, value: r.v } : { ok: false, err: 'parse' }); }
            else if (pt === 5) resolve({ ok: false, err: 'error' });
            else if (pt === 6) resolve({ ok: false, err: 'reject' });
            else resolve({ ok: false, err: 'abort' });
          }
        });
        this._send(buf, ip);
      };
      if (this.inflight < this.max) { this.inflight++; job(); }
      else this.queue.push(() => { this.inflight++; job(); });
    });
  }
  _done() { this.inflight--; if (this.queue.length) { const j = this.queue.shift(); j(); } }
}

/* =========================================================================
   Hochsprachige Funktionen
   ========================================================================= */
const DEV_PROPS = [[77, 'name'], [121, 'vendorName'], [70, 'model'], [44, 'firmware'], [12, 'software']];

async function identify(ip, knownInst, opts) {
  const se = new Session(); if (opts && opts.port) se.dst = opts.port; await se.open();
  try {
    let iam = await se.whoIs(ip, 3000);
    let inst = iam ? iam.inst : (knownInst != null ? Number(knownInst) : null);
    if (inst == null) return { ok: false, err: 'Keine Antwort (Who-Is). Firewall, falsches Subnetz oder Zentrale hinter Router?' };
    const out = { ok: true, inst, vendor: iam ? iam.vendor : null, maxApdu: iam ? iam.maxApdu : null, port: se.port, viaWhoIs: !!iam };
    for (const [prop, key] of DEV_PROPS) {
      const r = await se.readProp(ip, DEV, inst, prop, null, 1500);
      out[key] = r.ok ? r.value : null;
    }
    return out;
  } finally { se.close(); }
}

// Live-Werte für eine vorgegebene Objektliste [{type, inst, name, ...}]
async function readValues(ip, objects, onProgress, opts) {
  const se = new Session(); if (opts && opts.port) se.dst = opts.port; await se.open();
  try {
    let done = 0;
    const results = await Promise.all(objects.map(async o => {
      const r = await se.readProp(ip, o.type, o.inst, 85, null, 1800);
      done++; if (onProgress && (done % 10 === 0 || done === objects.length)) onProgress(done, objects.length);
      return Object.assign({}, o, { ok: r.ok, kind: r.kind, value: r.ok ? r.value : null, err: r.err });
    }));
    return { ok: true, port: se.port, values: results };
  } finally { se.close(); }
}

// Geräte durchsuchen: object-list per Index lesen, dann Namen holen
async function browse(ip, inst, withNames, opts) {
  const se = new Session(); if (opts && opts.port) se.dst = opts.port; await se.open();
  try {
    const cnt = await se.readProp(ip, DEV, inst, 76, 0, 2000); // Länge der object-list
    if (!cnt.ok) return { ok: false, err: 'object-list nicht lesbar (' + cnt.err + ')' };
    const n = Number(cnt.value) || 0;
    const idx = [];
    for (let i = 1; i <= n; i++) idx.push(i);
    const objs = [];
    await Promise.all(idx.map(async i => {
      const r = await se.readProp(ip, DEV, inst, 76, i, 1800);
      if (r.ok && r.kind === 'oid') objs.push({ type: r.value.type, inst: r.value.inst });
    }));
    objs.sort((a, b) => a.type - b.type || a.inst - b.inst);
    if (withNames) {
      await Promise.all(objs.map(async o => {
        const r = await se.readProp(ip, o.type, o.inst, 77, null, 1500);
        o.name = r.ok ? r.value : '';
      }));
    }
    return { ok: true, count: n, objects: objs };
  } finally { se.close(); }
}

module.exports = { identify, readValues, browse, oidOf, Session };
