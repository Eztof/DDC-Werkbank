/* Wartungsdoku öffnen und direkt speichern:
   - über die Werkbank-.exe (Dienst liest/schreibt die .wtgml selbst) – mit echtem Dienst und echter Datei
   - Dateidialog des Browsers scheitert (Abbruch, keine Antwort, Rückfrage hängt) → nie still
   - Dienst-Routen: nur für die eigene Seite, nur .wtgml, Konflikt bei fremder Änderung */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const D = require("../src/service/dateien.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html");
const FIX = f => path.join(ROOT, "test", "fixtures", f);
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "wb-wd-"));
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

test("Dienst: Ordner, Lesen, Schreiben – nur .wtgml, nur eigene Seite, Konflikt erkannt", async () => {
  const dir = tmpDir(), file = path.join(dir, "wartung_a.wtgml");
  fs.copyFileSync(FIX("beispiel-wartung.wtgml"), file);
  fs.writeFileSync(path.join(dir, "notiz.txt"), "x"); fs.mkdirSync(path.join(dir, "Unterordner")); fs.mkdirSync(path.join(dir, ".versteckt"));

  /* nur die eigene Seite */
  const ok = { host: "localhost:47902", "x-werkbank": "1", "sec-fetch-site": "same-origin" };
  assert.equal(D.erlaubt(ok, 47902), true);
  assert.equal(D.erlaubt({ ...ok, host: "127.0.0.1:47902" }, 47902), true);
  assert.equal(D.erlaubt({ ...ok, "x-werkbank": undefined }, 47902), false, "ohne eigenen Kopf");
  assert.equal(D.erlaubt({ ...ok, origin: "http://boese.example" }, 47902), false, "fremde Herkunft");
  assert.equal(D.erlaubt({ ...ok, origin: "null" }, 47902), false, "Herkunft null");
  assert.equal(D.erlaubt({ ...ok, host: "boese.example:47902" }, 47902), false, "DNS-Rebinding");
  assert.equal(D.erlaubt({ ...ok, "sec-fetch-site": "cross-site" }, 47902), false);

  const L = (await D.liste(dir));
  assert.equal(L.ok, true);
  assert.deepEqual(L.dateien.map(d => d.name), ["wartung_a.wtgml"], "nur .wtgml");
  assert.deepEqual(L.ordner.map(d => d.name), ["Unterordner"]);
  assert.equal(L.eltern, path.dirname(dir));
  assert.equal((await D.liste(file)).datei, file, "Pfad einer Datei → ihr Ordner + Datei");
  assert.equal((await D.liste("relativ")).ok, false);
  assert.equal((await D.liste(path.join(dir, "gibtsnicht"))).ok, false);
  assert.ok((await D.orte()).length >= 1);

  const R = (await D.lesen(file));
  assert.equal(R.ok, true);
  const text = Buffer.from(R.data, "base64").toString("utf8");
  assert.match(text, /<Maintenance /);
  assert.equal((await D.lesen(path.join(dir, "notiz.txt"))).ok, false, "andere Dateien nicht lesen");

  const neu = text.replace("</Maintenance>", "<!-- geändert -->\n</Maintenance>");
  assert.equal((await D.schreiben({ pfad: path.join(dir, "notiz.txt"), text: neu })).ok, false, "nur .wtgml schreiben");
  assert.equal((await D.schreiben({ pfad: path.join(dir, "neu.wtgml"), text: neu })).ok, false, "keine neuen Dateien anlegen");
  assert.equal((await D.schreiben({ pfad: file, text: "irgendwas", mtime: R.mtime })).ok, false, "nur Wartungsdokus schreiben");
  const W = (await D.schreiben({ pfad: file, text: neu, mtime: R.mtime }));
  assert.equal(W.ok, true);
  assert.equal(fs.readFileSync(file, "utf8"), neu);
  assert.deepEqual(fs.readdirSync(dir).filter(f => /wbtmp/.test(f)), [], "keine Hilfsdatei bleibt liegen");
  /* außerhalb geändert → nicht überschreiben, außer ausdrücklich */
  fs.utimesSync(file, new Date(), new Date(Date.now() + 60000));
  const K = (await D.schreiben({ pfad: file, text, mtime: W.mtime }));
  assert.equal(K.ok, false); assert.equal(K.konflikt, true);
  assert.equal(fs.readFileSync(file, "utf8"), neu);
  assert.equal((await D.schreiben({ pfad: file, text, mtime: W.mtime, force: true })).ok, true);
  assert.equal(fs.readFileSync(file, "utf8"), text);
});

test("Wartungsdoku über die .exe: öffnen, ändern → steht in der Datei; fremde Änderung wird gemeldet", async () => {
  const base = tmpDir(), docs = path.join(base, "Wartung 2026"), file = path.join(docs, "wartung_test.wtgml");
  fs.mkdirSync(docs); fs.copyFileSync(FIX("beispiel-wartung.wtgml"), file);
  fs.mkdirSync(path.join(base, "ui")); fs.copyFileSync(HTML, path.join(base, "ui", "DDC-Werkbank.html"));
  const port = await freePort();
  const svc = spawn(process.execPath, [path.join(ROOT, "src", "service", "server.js")], { env: { ...process.env, WERKBANK_PORT: String(port), WERKBANK_DIR: base }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((res, rej) => { svc.stdout.on("data", d => { if (/Oberfläche/.test(String(d))) res(); }); svc.on("exit", c => rej(new Error("Dienst beendet: " + c))); setTimeout(() => rej(new Error("Dienst startet nicht")), 10000); });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("dialog", d => d.accept());
    await page.goto("http://localhost:" + port + "/");
    await page.click(".nav-item[data-view='wartung']");
    await page.click("button:has-text('Über die .exe öffnen') >> nth=0");
    await page.waitForSelector(".wdsvc");
    await page.fill(".wdsvc input.in", docs);
    await page.press(".wdsvc input.in", "Enter");
    await page.click(".wdsvc-it.file:has-text('wartung_test.wtgml')");
    await page.waitForFunction(() => /Verknüpft mit wartung_test\.wtgml \(über die Werkbank-\.exe\)/.test((document.querySelector("#wdStatus") || {}).textContent || ""));
    assert.equal(await page.$(".wdsvc"), null, "Auswahl schließt sich nach dem Öffnen");

    /* ändern → wird von selbst in die Datei geschrieben */
    await page.click(".rail .rail-item >> nth=0");
    await page.fill(".wd-zustand textarea", "Über die exe gespeichert");
    const onDisk = async re => { for (let i = 0; i < 60; i++) { if (re.test(fs.readFileSync(file, "utf8"))) return true; await page.waitForTimeout(100); } return false; };
    assert.ok(await onDisk(/<body>Über die exe gespeichert<\/body>/), "Änderung steht nicht in der Datei");
    await page.waitForFunction(() => /gespeichert \d/.test(document.querySelector("#wdStatus").textContent));
    assert.match(fs.readFileSync(file, "utf8"), /^<\?xml[^>]*\?>\s*<Maintenance /);
    assert.deepEqual(fs.readdirSync(docs), ["wartung_test.wtgml"]);

    /* Datei außerhalb geändert → Meldung statt Überschreiben; „Trotzdem speichern“ schreibt */
    fs.utimesSync(file, new Date(), new Date(Date.now() + 60000));
    await page.fill(".wd-zustand textarea", "zweite Änderung");
    await page.waitForFunction(() => /außerhalb der Werkbank geändert/.test(document.querySelector("#wdStatus").textContent));
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /zweite Änderung/);
    await page.click("#wdStatus button:has-text('Trotzdem speichern')");
    assert.ok(await onDisk(/<body>zweite Änderung<\/body>/));

    /* Pfad einer Datei einfügen (mit Anführungszeichen wie „Als Pfad kopieren“) → öffnet direkt */
    await page.click("button:has-text('Über die .exe öffnen') >> nth=0");
    await page.fill(".wdsvc input.in", '"' + file + '"');
    await page.press(".wdsvc input.in", "Enter");
    await page.waitForFunction(() => /keine Änderungen/.test((document.querySelector("#wdStatus") || {}).textContent || ""));
    assert.match(await page.evaluate(() => DDCWerkbank.wartung.text()), /zweite Änderung/);

    /* ohne den eigenen Kopf gibt der Dienst nichts heraus */
    assert.equal(await page.evaluate(() => fetch("/api/wd/orte").then(r => r.status)), 403);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    svc.kill();
  }
});

test("Dateidialog des Browsers scheitert → Meldung statt Stille; Rückfrage hält das Öffnen nicht auf", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const wtgml = fs.readFileSync(FIX("beispiel-wartung.wtgml"), "utf8");
    await page.addInitScript(text => {
      window.__mode = "abort";
      window.showOpenFilePicker = () => {
        if (window.__mode === "abort") return Promise.reject(new DOMException("The user aborted a request.", "AbortError"));
        if (window.__mode === "hang") return new Promise(() => {});
        /* Datei kommt, aber die Rückfrage „Änderungen speichern?“ wird nie beantwortet */
        return Promise.resolve([{ kind: "file", name: "wartung_x.wtgml", getFile: async () => new File([text], "wartung_x.wtgml", { lastModified: 5 }),
          requestPermission: () => new Promise(() => {}) }]);
      };
    }, wtgml);
    await page.goto("file://" + HTML);
    await page.click(".nav-item[data-view='wartung']");
    const open = () => page.click("button:has-text('Wartungsdoku öffnen') >> nth=0");
    await open();
    await page.waitForSelector(".toast:has-text('Keine Datei geöffnet')");
    await page.evaluate(() => { window.__mode = "hang"; });
    await open();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));       // Dialog zu, Fenster wieder vorn
    await page.waitForSelector(".toast:has-text('liefert die gewählte Datei nicht')", { timeout: 9000 });
    await page.evaluate(() => { window.__mode = "prompt"; });
    await open();
    await page.waitForFunction(() => /wartung_x\.wtgml · nur lesen/.test((document.querySelector("#wdStatus") || {}).textContent || ""));
    assert.ok(await page.$(".rail .rail-item"), "Dokument ist offen, obwohl die Rückfrage noch aussteht");
    assert.equal(await page.$("button:has-text('Über die .exe öffnen')"), null, "ohne .exe kein zweiter Weg angeboten");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
