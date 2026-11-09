import * as P from "./protocol.js";
import { decode } from "./cp850.js";
import { Emitter } from "./link.js";

/* =========================================================================
   Nachgebaute DDC3200 für Tests und den Demo-Modus (ohne Hardware).
   Verhalten nach echten Mitschnitten (DDC3200, Firmware 6.740, Zentrale 2):
    - quittiert jeden Block mit 16 06, antwortet auf 16 05 mit 16 14
    - Listen: nächster Block erst nach ACK; ohne ACK Wiederholung nach 2 s,
      nach 3 Versuchen Aufgabe
    - jede Liste endet mit "Z6 …", unbekannte Befehle -> "Z2 048 …"
    - sendet zwischendurch "Z5 …" (Uhrzeit)
   ========================================================================= */
export class SimDDC extends Emitter {
  constructor(opts = {}) {
    super();
    this.opts = { valuesPerDevice: 20, nakFirst: false, corruptOnce: false, failDevice: null, ...opts };
    this.rx = []; this.queue = []; this.tries = 0; this.timer = null; this.received = []; this.gaveUp = 0;
    this.nakDone = false; this.corruptDone = false;
  }
  // ---- Transport-Schnittstelle ----
  async write(buf) { setTimeout(() => this._in(buf), 2); }
  async close() { clearTimeout(this.timer); }
  _out(bytes) { setTimeout(() => this.emit("data", Uint8Array.from(bytes)), 2); }
  _block(text, corrupt = false) {
    const b = P.buildBlock(text + "\r");     // DDC hängt CR vor ETX an
    if (corrupt) b[b.length - 2] ^= 0x01;
    return b;
  }

  _in(buf) {
    for (const b of buf) this.rx.push(b);
    while (this.rx.length) {
      if (this.rx[0] === P.SYN) {
        if (this.rx.length < 2) return;
        const c = this.rx[1]; this.rx.splice(0, 2);
        if (c === P.CTRL.ACK && this.queue.length) { this.queue.shift(); this.tries = 0; clearTimeout(this.timer); setTimeout(() => this._next(), 3); }
        if (c === P.CTRL.NAK && this.queue.length) { clearTimeout(this.timer); setTimeout(() => this._next(true), 3); }
        if (c === P.CTRL.ENQ) this._out([P.SYN, P.CTRL.DC4]);
        continue;
      }
      if (this.rx[0] === P.STX) {
        const i = this.rx.indexOf(P.SUB); if (i < 0) return;
        const fr = this.rx.splice(0, i + 1);
        const e = fr.indexOf(P.ETX);
        const body = fr.slice(0, e + 1);
        const ok = P.hex4(P.crc16(body)) === P.asciiText(fr.slice(e + 1, e + 5));
        if (this.opts.nakFirst && !this.nakDone) { this.nakDone = true; this._out([P.SYN, P.CTRL.NAK]); continue; }
        if (!ok) { this._out([P.SYN, P.CTRL.NAK]); continue; }
        this._out([P.SYN, P.CTRL.ACK]);
        const text = decode(body.slice(1, -1));
        this.received.push(text);
        setTimeout(() => this._command(text), 10);
        continue;
      }
      this.rx.shift();
    }
  }

  _send(list) { this.queue = list.slice(); this.tries = 0; this._next(); }
  _next(isRetry = false) {
    if (!this.queue.length) return;
    if (!isRetry) this.tries++;
    if (this.tries > 3) { this.gaveUp++; this.queue = []; return; }
    const corrupt = this.opts.corruptOnce && !this.corruptDone && this.queue.length === 2;
    if (corrupt) this.corruptDone = true;
    this._out(this._block(this.queue[0], corrupt));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._next(), 2000);
  }

  _command(t) {
    const Z = "1";                                   // Zentrale 1, Kreis-Adresse 2
    let m;
    if (/^G0 /.test(t)) return this._send(["G1 0000 000000000000000 32 96 6.740 A 2 2 DDC001"]);
    if (t === "T0 *.0") return this._send([`t1 ${Z}.2.0 32 96 00 `, `Z6 ${Z}.2.0 32 96 00 `]);
    if (t === "T0 2.*") return this._send([`t1 ${Z}.2.0 32 96 00 `, `t1 ${Z}.2.1 31 110 00 `, "Z5 1.2.0 09.11.26 10:00",
                                            `t1 ${Z}.2.701 30 124 00 `, `t1 ${Z}.2.801 29 87 00 `, `Z6 ${Z}.2.801 29 87 00 `]);
    if ((m = t.match(/^m0 2\.(\d+) \*$/))) return this._send([`m1 ${Z}.2.${m[1]} 69/1 03`, `m1 ${Z}.2.${m[1]} 117/1 03`, `Z6 000 m0 ${Z}.2.${m[1]} */*`]);
    if ((m = t.match(/^p0 2\.(\d+) \*$/)) && this.opts.demo) {
      const a = `${Z}.2.${m[1]}`;
      return this._send([...(DEMO_P[m[1]] || []).map(l => `p1 ${a} ${l}`), `Z6 000 p0 ${a} */*`]);
    }
    if ((m = t.match(/^D([024]) 2 {1,2}\*$/)) && this.opts.demo) {
      const c = "D" + (+m[1] + 1);
      return this._send([...(m[1] === "0" ? DEMO_D1 : []).map(l => `${c} ${l}`), `Z6 000 D${m[1]} 32 *`]);
    }
    if ((m = t.match(/^p0 2\.(\d+) \*$/))) {
      const a = `${Z}.2.${m[1]}`;
      if (this.opts.failDevice === a) return this._send([`Z6 110 p0 ${a} */*`]);
      const L = [`p1 ${a} 899/1 6.740 0 0F 00 `, `p1 ${a} 5100/1 28.5 108 0F 00 WT Becken Zulüfter Soll`];
      for (let k = 1; k <= this.opts.valuesPerDevice; k++) L.push(`p1 ${a} k${k}/1 0 0F 00 `);
      L.push(`Z6 000 p0 ${a} */*`);
      return this._send(L);
    }
    if ((m = t.match(/^D([024]) 2 {1,2}\*$/))) {
      const c = "D" + (+m[1] + 1);
      return this._send([`${c} 32 1 20 00 24:59 00:00 07:00 0 81 0F 0000 Mo-BEGINN1`, `${c} 32 5100 1 0A 30.00 5.00 17.00 108 01 0F 0000 LÜFTUNG Soll`, `Z6 000 D${m[1]} 32 *`]);
    }
    return this._send([`Z2 048 ${t}`]);
  }
}


/* ---------- Demo-Inhalt: kleine, aber vollständige Anlage (Zentrale 2) ---------- */
const DEMO_P = {
  "0": [
    "899/1 6.740 0 0F 00 ",
    "1/1 06:00 0 0F 00 ", "2/1 22:00 0 0F 00 ", "3/1 06:00 0 0F 00 ", "4/1 22:00 0 0F 00 ", "5/1 06:00 0 0F 00 ", "6/1 22:00 0 0F 00 ",
    "7/1 06:00 0 0F 00 ", "8/1 22:00 0 0F 00 ", "9/1 06:00 0 0F 00 ", "10/1 20:00 0 0F 00 ", "11/1 24:59 0 0F 00 ", "12/1 24:59 0 0F 00 ",
    "13/1 24:59 0 0F 00 ", "14/1 24:59 0 0F 00 ",
    "N/1 1 0F 00 Lüftung Halle",
    "b1/1 8.4 108 0F 00 Außentemperatur",
    "b2/1 ???? 0 0F 20 Raumtemperatur Halle",
    "b3/1 21.0 108 0F 00 ",
    "B1/1 0.5 108 0F 00 ",
    "k1/1 0 0F 00 Störung Zuluftventilator",
    "k2/1 0 0F 00 ",
    "k3/1 1 0F 00 Freigabe Zuluftventilator",
    "K3/1 002.000 M1/01 N --- 0F 00 ",
    "M1/1 002.000 k1/01 I AND 002.000 T1/01 N --- 0F 00 Freigabe Anlage",
    "T1/1 002.000 N/01 N E 00:00:30/00:00:00 0F 00 Einschaltverzögerung",
    "y1/1 45.0 0 0F 00 Heizventil",
    "Y1/1 002.001 5200/01 N --- 0F 00 ",
    "2141/1 \"01712521002\" 0F 00",
    "4600/1 2 0F 00 "
  ],
  "1": [
    "5100/1 21.0 108 0F 00 Zuluft Soll",
    "5115/1 1 0F 00 ",
    "5200/1 45.0 0 0F 00 ",
    "5201/1 002.000 b3/01 N --- 0F 00 "
  ],
  "701": ["b7/1 18.2 108 0F 00 Rücklauf Heizung", "k1/1 0 0F 00 Frostschutz"],
  "801": ["b1/1 22.5 108 0F 00 Raum 1.01"]
};
const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DEMO_D1 = [
  ...DAYS.flatMap((d, i) => [`32 ${2 * i + 1} 20 00 24:59 00:00 07:00 0 81 0F 0000 ${d}-BEGINN1`, `32 ${2 * i + 2} 20 00 24:59 00:00 22:00 0 81 0F 0000 ${d}-ENDE1`]),
  "32 N 10 00 1 0 0 0 01 0F 0000 Wochenprogramm",
  "32 899 1 0A 9.999 0 0 0 41 0F 0000 Firmware",
  "32 b1-b32 1 0A 150.0 -50.0 0.0 108 41 0F 0000 Fühler B%(1)",
  "32 B1-B32 1 0A 10.0 -10.0 0.0 108 01 0F 0000 Korrektur B%(1)",
  "32 k1-k32 10 00 1 0 0 0 41 0F 0000 Kontakt K%(1)",
  "32 K1-K32 31 00 --- --- --- 0 01 0F 0000 Verknüpfung K%(1)",
  "32 y1-y16 1 0A 100.0 0.0 0.0 0 41 0F 0000 Ausgang Y%(1)",
  "32 Y1-Y16 31 00 --- --- --- 0 01 0F 0000 Verknüpfung Y%(1)",
  "32 M1-M64 31 00 --- --- --- 0 01 0F 0000 Merker M%(1)",
  "32 T1-T32 32 00 --- --- --- 0 01 0F 0000 Timer T%(1)",
  "32 2141 4 00 --- --- --- 0 01 0F 0000 Rufnummer 1",
  "32 4600 1 00 5 0 2 0 01 0F 0000 P90 Baudrate",
  "31 5100 1 0A 30.00 5.00 17.00 108 01 0F 0000 Sollwert",
  "31 5115 1 00 8 0 1 0 01 0F 0000 Auswahl Wochenprogramm",
  "31 5200 1 0A 100.0 0.0 0.0 0 41 0F 0000 Stellgröße",
  "31 5201 31 00 --- --- --- 0 01 0F 0000 Fühler Regelgröße",
  "30 b1-b16 1 0A 150.0 -50.0 0.0 108 41 0F 0000 Fühler B%(1)",
  "30 k1-k16 10 00 1 0 0 0 41 0F 0000 Kontakt K%(1)",
  "29 b1-b8 1 0A 150.0 -50.0 0.0 108 41 0F 0000 Fühler B%(1)"
];
