/* K&P-Direktzugang (CTOS): Anmeldung, Verschlüsselung, Lesen – gegen eine nachgebildete Zentrale */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startFakeCentral, testSalt } from "./lib/ctos-fake.mjs";

const require = createRequire(import.meta.url);
const { CtosSession, readAddresses, browse } = require("../src/service/ctos.js");

const OBJECTS = {
  "//": { n: "", t: "Root" },
  "//001": { n: "001", t: "IO_Modul", txt: "E/A-Modul 1" },
  "//001/00": { n: "00", t: "P", txt: "Klemmen" },
  "//001/00/00": { n: "00", t: "P", txt: "Klemmen" },
  "//001/00/00/P.01": { n: "P.01", t: "P", txt: "RLT1 Zulufttemperatur" },
  "//001/00/00/P.01/CAI.01": { n: "CAI.01", t: "CAI", txt: "" },
  "//001/00/00/P.01/CAI.01/b": { n: "b", t: "PO", txt: "Zulufttemp.", pv: "21.63", v: 21.625, vut: "°C" },
  "//001/00/00/P.02/CDI.01/k": { n: "k", t: "PO", txt: "Betrieb", pv: "Ein", v: true, vut: "" },
  "//001/00/00/P.09/x": { n: "x", t: "PO", txt: "lang", pv: "ä".repeat(300), v: -123456789012, vut: "" }
};

test("Anmeldung, Werte lesen, Explorer, Schreibsperre", async () => {
  const salt = testSalt();
  const fake = await startFakeCentral({ salt, objects: OBJECTS });
  const s = new CtosSession({ ip: "127.0.0.1", port: fake.port, salts: [salt] });
  try {
    await s.open("service", "geheim");
    assert.equal(s.hostNumber, 12);
    assert.equal(s.language, "de");
    const vals = await readAddresses(s, ["//001/00/00/P.01/CAI.01/b", "//001/00/00/P.02/CDI.01/k", "//001/00/00/P.09/x", "//001/00/00/P.77/b"]);
    assert.deepEqual(vals[0], { a: "//001/00/00/P.01/CAI.01/b", ok: true, pv: "21.63", v: 21.625, unit: "°C", err: undefined });
    assert.equal(vals[1].v, true);
    assert.equal(vals[2].pv.length, 300);
    assert.equal(vals[2].v, -123456789012);
    assert.equal(vals[3].ok, false);
    const b = await browse(s, "//001/00/00/P.01");
    assert.equal(b.items.length, 1);
    assert.equal(b.items[0].a, "//001/00/00/P.01/CAI.01");
    assert.equal(b.items[0].kids, true);
    await assert.rejects(s.request(["as.sav", null, null, "v", 1]), /gesperrt/);
    assert.ok(!fake.log.includes("as.sav"));
  } finally { s.close(); await fake.close(); }
});

test("Falsches Passwort wird erkannt", async () => {
  const salt = testSalt();
  const fake = await startFakeCentral({ salt, objects: OBJECTS });
  const s = new CtosSession({ ip: "127.0.0.1", port: fake.port, salts: [salt] });
  try { await assert.rejects(s.open("service", "falsch"), /Anmeldung abgelehnt/); }
  finally { s.close(); await fake.close(); }
});
