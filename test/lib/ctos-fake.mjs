/* Nachgebildete Zentrale für den K&P-Direktzugang (CTOS) – nur für Tests.
   Spricht die Serverseite des Protokolls mit einem zufälligen Test-Salz
   (nicht dem von K&P). Objekte: { adresse: { n, t, txt, pv, v, vut } } */
import net from "node:net";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { _test: T } = require("../../src/service/ctos.js");
const { encFrame, makeReader, crc32, hex8, Oid } = T;

export function testSalt() {
  const d = crypto.randomBytes(1024);
  return { id: crc32(d) & 0xFFFF, data: d, from: "test" };
}

export function startFakeCentral({ salt, user = "service", pass = "geheim", hostNumber = 12, objects = {} }) {
  const addrs = Object.keys(objects);
  const oidOf = new Map(addrs.map((a, i) => [a, BigInt(i + 1)]));
  const addrOf = new Map(addrs.map((a, i) => [String(i + 1), a]));
  const log = [];
  const server = net.createServer(sock => {
    let buf = Buffer.alloc(0), stage = 0, inS = null, inP = 0, outS = null, outP = 0;
    const xor = (b, dir) => {
      const s = dir === "in" ? inS : outS; if (!s) return b;
      let p = dir === "in" ? inP : outP; const o = Buffer.alloc(b.length);
      for (let i = 0; i < b.length; i++) { o[i] = b[i] ^ s[p]; if (++p >= s.length) p = 0; }
      if (dir === "in") inP = p; else outP = p; return o;
    };
    const send = (id, items) => sock.write(xor(encFrame("0", id, items), "out"));
    const prefix = crypto.randomBytes(4).readUInt32BE(0), suffix = crypto.randomBytes(4).readUInt32BE(0);
    sock.on("data", d => {
      buf = Buffer.concat([buf, stage >= 2 ? xor(d, "in") : d]);
      for (;;) {
        if (stage === 0) {
          if (buf.length < 5 || buf.length < 5 + buf[4] * 2) return;
          if (buf.toString("latin1", 0, 4) !== "C2S1") { sock.destroy(); return; }
          buf = buf.subarray(5 + buf[4] * 2);
          const hs = Buffer.alloc(14); hs[0] = 2; hs.writeUInt16BE(hostNumber, 1); hs.writeUInt32BE(prefix, 3); hs.writeUInt32BE(suffix, 7); hs[11] = 1; hs.writeUInt16BE(salt.id, 12);
          sock.write(hs); stage = 1; continue;
        }
        let f;
        try { f = makeReader(buf, 0).frame(); } catch (e) { return; }
        buf = buf.subarray(f.end);
        const [cmd, ...args] = f.items;
        log.push(cmd);
        if (stage === 1) {
          const pw = Buffer.from(pass, "utf8"), pre = hex8(prefix), suf = hex8(suffix);
          const ok = cmd === "as.init" && args[0] === user && Number(args[1]) === crc32(pre, pw, suf);
          const rest = buf; buf = Buffer.alloc(0);
          if (!ok) { outS = salt.data; outP = (suffix & 0x7FFFFFFF) % salt.data.length; send(f.reqId, [25]); return; }
          inS = salt.data; inP = (crc32(suf, pw, pre) & 0x7FFFFFFF) % salt.data.length;
          outS = salt.data; outP = (suffix & 0x7FFFFFFF) % salt.data.length;
          send(f.reqId, [0, 0, 0, false, false, "de,en", "de", 100, 100]);
          stage = 2; buf = xor(rest, "in"); continue;
        }
        const obj = o => o instanceof Oid ? objects[addrOf.get(o.id.toString())] : null;
        if (cmd === "as.p") send(f.reqId, [0]);
        else if (cmd === "as.gid") send(f.reqId, oidOf.has(args[0]) ? [0, new Oid(oidOf.get(args[0]))] : [23]);
        else if (cmd === "as.gma" || cmd === "as.gav") {
          const o = obj(args[0]); if (!o) { send(f.reqId, [14]); continue; }
          const codes = args.slice(2);
          if (codes.some(c => !(c in o) && c !== "a")) { send(f.reqId, [202]); continue; }
          send(f.reqId, [0, ...codes.map(c => c === "a" ? addrOf.get(args[0].id.toString()) : o[c])]);
        }
        else if (cmd === "as.gcs") {
          const base = addrOf.get(args[0].id.toString());
          const kids = addrs.filter(a => a !== base && a.startsWith(base === "//" ? "//" : base + "/") && !a.slice((base === "//" ? 2 : base.length + 1)).includes("/"));
          send(f.reqId, [0, kids.length, kids.length, ...kids.map(a => new Oid(oidOf.get(a)))]);
        }
        else if (cmd === "as.hc") send(f.reqId, [0, addrs.some(a => a.startsWith(addrOf.get(args[0].id.toString()) + "/"))]);
        else send(f.reqId, [31]);
      }
    });
    sock.on("error", () => {});
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, log, close: () => new Promise(r => server.close(r)) })));
}
