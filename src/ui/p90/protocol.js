import { decode, encode } from "./cp850.js";

/* =========================================================================
   P90-Protokoll (Kieback&Peter DDC3000, RS232) – Rahmenebene.
   Rekonstruiert aus SPClientDDC.exe und an einer echten DDC3200
   (Firmware 6.740) bestätigt. Details: docs/P90-PROTOKOLL.md.

   Steuerzeichen:  immer SYN (0x16) + Zeichen, z. B. 16 06 = ACK
   Block:          STX (02) Text [CR] ETX (03) CRC16 als 4 Hex-Zeichen SUB (1A)
                   CRC16/XMODEM (Poly 0x1021, Start 0) über STX … ETX
   Zeile:          2 Hex-Zeichen Bytesumme + Text + CR (DDC3200 nutzt das nicht)
   Läuft im Browser und unter Node (nur Uint8Array, kein Buffer).
   ========================================================================= */
export const SYN = 0x16, STX = 0x02, ETX = 0x03, ETB = 0x17, SUB = 0x1a, CR = 0x0d;
export const CTRL = {
  ENQ: 0x05, // Anfrage "bereit?"
  ACK: 0x06, // Block empfangen, Prüfsumme ok
  DC2: 0x12, // bitte warten (beschäftigt)
  DC4: 0x14, // bereit
  NAK: 0x15  // Block fehlerhaft, bitte wiederholen
};
export const CTRL_NAME = Object.fromEntries(Object.entries(CTRL).map(([k, v]) => [v, k]));

export function crc16(bytes) {
  let c = 0;
  for (const b of bytes) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}
export const hex4 = n => n.toString(16).toUpperCase().padStart(4, "0");
const ascii = s => Uint8Array.from(s, ch => ch.charCodeAt(0) & 0xff);
export const asciiText = bytes => String.fromCharCode(...bytes);

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Text -> kompletter Block. Die DDC sendet selbst ein CR vor ETX, das K&P-Programm nicht – beides geht. */
export function buildBlock(text) {
  const body = concat([STX], encode(text), [ETX]);
  return concat(body, ascii(hex4(crc16(body))), [SUB]);
}
export const ctrlFrame = code => Uint8Array.of(SYN, code);

/**
 * Stream-Parser. Füttern mit push(chunk); liefert Ereignisse an onEvent:
 *  { type:"ctrl",  code, name }
 *  { type:"block", text, ok, crcRx, crcCalc, etb }
 *  { type:"line",  text, ok }
 */
export class FrameParser {
  constructor(onEvent) { this.onEvent = onEvent; this.reset(); }
  reset() { this.st = "idle"; this.buf = []; this.hex = ""; this.syn = false; this.last = 0; }
  push(chunk) {
    const now = Date.now();
    if (this.st !== "idle" && now - this.last > 1500) this.reset();   // halbe Rahmen verwerfen
    this.last = now;
    for (const b of chunk) this._byte(b);
  }
  _byte(b) {
    if (this.syn) {
      this.syn = false;
      this.onEvent({ type: "ctrl", code: b, name: CTRL_NAME[b] || "0x" + b.toString(16) });
      return;
    }
    if (b === SYN && this.st !== "blk") { this.syn = true; return; }
    switch (this.st) {
      case "idle":
        if (b === STX) { this.st = "blk"; this.buf = [b]; }
        else if (b >= 0x20 && b < 0x7f) { this.st = "line"; this.buf = [b]; }
        return;
      case "blk":
        this.buf.push(b);
        if (b === ETX || b === ETB) { this.st = "crc"; this.hex = ""; }
        else if (this.buf.length > 2000) this.reset();
        return;
      case "crc":
        if (b === SUB || this.hex.length >= 4) {
          const calc = crc16(this.buf);
          const inner = this.buf.slice(1, -1).filter(x => x !== CR);
          this.onEvent({
            type: "block", text: decode(inner), ok: calc === parseInt(this.hex, 16),
            crcRx: this.hex, crcCalc: hex4(calc), etb: this.buf[this.buf.length - 1] === ETB
          });
          this.reset();
          if (b !== SUB) this._byte(b);
        } else this.hex += String.fromCharCode(b);
        return;
      case "line":
        if (b === CR) {
          const s = decode(this.buf);
          let sum = 0; for (const x of this.buf.slice(2)) sum = (sum + x) & 0xff;
          this.onEvent({ type: "line", text: s.slice(2), ok: /^[0-9A-Fa-f]{2}/.test(s) && parseInt(s.slice(0, 2), 16) === sum });
          this.reset();
        } else this.buf.push(b);
        return;
    }
  }
}
