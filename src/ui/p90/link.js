import { buildBlock, ctrlFrame, CTRL, FrameParser } from "./protocol.js";

/* =========================================================================
   P90-Sicherungsschicht: quittieren, Blöcke senden mit Wiederholung,
   Anfragen mit Antworten sammeln, Anmeldung, Abbruch.
   transport: { write(Uint8Array): Promise, on("data", fn(Uint8Array)),
                removeListener?("data", fn), close?(): Promise }
   Ereignisse (on(name, fn)):
     "frame" (ev, dir)    erkannter Rahmen, dir = "rx" | "tx"
     "log"   (level, text) level = "info" | "warn" | "error"
   ========================================================================= */

/* Kennung, mit der sich das K&P-Programm (SPClientDDC) an der DDC anmeldet */
export const LOGIN_IDENT = "0000 Terminalprog.__ 128 0 1.04 A 0.0.0 2 KPT001";
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* kleiner Ereignis-Baustein (statt Node "events", läuft auch im Browser) */
export class Emitter {
  constructor() { this._ev = {}; }
  on(n, fn) { (this._ev[n] = this._ev[n] || []).push(fn); return this; }
  off(n, fn) { this._ev[n] = (this._ev[n] || []).filter(f => f !== fn); return this; }
  removeListener(n, fn) { return this.off(n, fn); }
  emit(n, ...a) { for (const f of (this._ev[n] || []).slice()) { try { f(...a); } catch (e) { console.error(e); } } }
}

export class P90Link extends Emitter {
  constructor(transport, opts = {}) {
    super();
    this.t = transport;
    this.ackTimeout = opts.ackTimeout ?? 3000;   // Wartezeit auf ACK nach eigenem Block
    this.maxTries = opts.maxTries ?? 4;          // Sendeversuche je Block
    this.autoAck = true;                         // eingehende Blöcke quittieren
    this.ackSuppressed = false;                  // für Abbruch: nicht mehr quittieren
    this.pending = null;                         // eigener Block wartet auf ACK
    this.collector = null;                       // laufende Anfrage sammelt Antworten
    this.lastRx = 0;
    this.lastG0 = "";
    this._chain = Promise.resolve();
    this._rxParser = new FrameParser(ev => this._onRx(ev));
    this._txParser = new FrameParser(ev => this.emit("frame", ev, "tx"));
    this._onData = buf => { this.emit("rx", buf); this._rxParser.push(buf); };
    this.t.on("data", this._onData);
  }

  log(level, text) { this.emit("log", level, text); }

  /** Rohbytes senden (nacheinander). */
  write(buf) {
    this.emit("tx", buf); this._txParser.push(buf);
    const job = this._chain.then(() => this.t.write(buf)).then(() => true, e => { this.log("error", "Senden: " + (e && e.message || e)); return false; });
    this._chain = job;
    return job;
  }
  sendCtrl(code) { return this.write(ctrlFrame(code)); }

  /** Block senden und auf ACK warten. -> "ack" | "fail" */
  sendBlock(text) {
    return new Promise(resolve => {
      if (this.pending) { this.log("error", "Es wartet noch ein Block auf Quittung."); return resolve("fail"); }
      this.pending = { buf: buildBlock(text), text, tries: 1, resolve, timer: null, poll: null };
      this.write(this.pending.buf);
      this._armAck();
    });
  }
  _armAck() {
    const p = this.pending; if (!p) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      if (this.pending !== p) return;
      if (p.tries >= this.maxTries) { this.log("error", `Keine Quittung für "${p.text}" nach ${p.tries} Versuchen.`); return this._done("fail"); }
      p.tries++; this.log("warn", `Keine Quittung – Versuch ${p.tries}.`);
      this.write(p.buf); this._armAck();
    }, this.ackTimeout);
  }
  _done(result) {
    const p = this.pending; if (!p) return;
    clearTimeout(p.timer); clearInterval(p.poll);
    this.pending = null; p.resolve(result);
  }

  _onRx(ev) {
    this.emit("frame", ev, "rx");
    if (ev.type === "block") {
      // sofort quittieren – die DDC sendet den nächsten Block erst nach unserem ACK
      if (this.autoAck && !this.ackSuppressed) this.sendCtrl(ev.ok ? CTRL.ACK : CTRL.NAK);
    }
    const p = this.pending;
    if (ev.type === "ctrl") {
      switch (ev.code) {
        case CTRL.ACK: if (p) this._done("ack"); break;
        case CTRL.NAK:
          if (!p) break;
          if (p.tries >= this.maxTries) { this.log("error", "DDC meldet wiederholt NAK."); this._done("fail"); break; }
          p.tries++; this.write(p.buf); this._armAck(); break;
        case CTRL.DC2:                         // DDC beschäftigt -> alle 2 s nachfragen
          if (p && !p.poll) { clearTimeout(p.timer); p.poll = setInterval(() => this.sendCtrl(CTRL.ENQ), 2000); }
          break;
        case CTRL.DC4:                         // wieder bereit -> Block erneut senden
          if (p && p.poll) { clearInterval(p.poll); p.poll = null; this.write(p.buf); this._armAck(); }
          break;
        case CTRL.ENQ:
          if (this.autoAck) this.sendCtrl(CTRL.DC4); break;
      }
      return;
    }
    if (!ev.ok) return;
    this.lastRx = Date.now();
    if (/^G0 /.test(ev.text)) this.lastG0 = ev.text;
    // Z5 (Uhrzeit, jede Minute) und G0 (Anmeldung der DDC) kommen unaufgefordert
    if (this.collector && !this.ackSuppressed && !/^(Z5|G0) /.test(ev.text)) this.collector(ev.text);
  }

  /**
   * Anfrage senden, Antworten sammeln bis isEnd(text) zutrifft.
   * -> { status: "ok"|"timeout"|"noack"|"abort", lines: [...], end: "Z6 …" | null }
   */
  request(cmd, isEnd, { idleMs = 15000, onLine = null } = {}) {
    return new Promise(resolve => {
      const lines = []; let last = Date.now(), done = false;
      const finish = (status, end = null) => {
        if (done) return; done = true;
        clearInterval(iv); this.collector = null; this._abortRequest = null;
        resolve({ status, lines, end });
      };
      this._abortRequest = () => finish("abort");
      this.collector = text => {
        last = Date.now();
        if (isEnd(text)) finish("ok", text);
        else { lines.push(text); if (onLine) onLine(lines.length, text); }
      };
      const iv = setInterval(() => { if (Date.now() - last > idleMs) finish("timeout"); }, 200);
      this.sendBlock(cmd).then(r => { if (r !== "ack") finish("noack"); else last = Date.now(); });
    });
  }

  /** Laufende Anfrage abbrechen. Quittungen werden ausgesetzt, bis die DDC quietMs lang still ist. */
  async abort(quietMs = 8000) {
    if (this._abortRequest) this._abortRequest();
    this._done("fail");
    this.ackSuppressed = true;
    this.lastRx = Date.now();
    while (Date.now() - this.lastRx < quietMs) await sleep(200);
    this.ackSuppressed = false;
  }

  /** Als Terminal anmelden (wie das K&P-Programm). -> Kennung der DDC ("G1 …") */
  async login() {
    const r = await this.request("G0 " + LOGIN_IDENT, t => /^G1 /.test(t), { idleMs: 8000 });
    if (r.status !== "ok") throw new Error("Anmeldung fehlgeschlagen (" + r.status + ")");
    return r.end;
  }

  async close() {
    if (this.t.removeListener) this.t.removeListener("data", this._onData);
    if (this.pending) this._done("fail");
    if (this.t.close) await this.t.close();
  }
}
