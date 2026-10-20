/* =========================================================================
   Auslieferung bauen: dist/DDC-Werkbank/ (exe + ui + LIESMICH) und ZIP.
   Die .exe enthält den Dienst als Klartext (kein Bytecode – sonst V8-Fehler
   auf manchen Windows-Rechnern).
   ========================================================================= */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist", "DDC-Werkbank");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });

fs.rmSync(path.join(ROOT, "dist"), { recursive: true, force: true });
run("node", ["tools/build.mjs"]);
run("npx", ["pkg", "src/service/server.js", "--targets", "node22-win-x64", "--no-bytecode", "--public", "--public-packages", "*",
  "--output", path.join(DIST, "DDC-Werkbank.exe")]);
fs.mkdirSync(path.join(DIST, "ui"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "DDC-Werkbank", "ui", "DDC-Werkbank.html"), path.join(DIST, "ui", "DDC-Werkbank.html"));
fs.copyFileSync(path.join(ROOT, "DDC-Werkbank", "LIESMICH.txt"), path.join(DIST, "LIESMICH.txt"));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const zip = path.join(ROOT, "dist", "DDC-Werkbank-" + version + ".zip");
if (process.platform === "win32") run("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${DIST}' -DestinationPath '${zip}'`]);
else execFileSync("zip", ["-qr", zip, "DDC-Werkbank"], { cwd: path.join(ROOT, "dist"), stdio: "inherit" });
console.log("fertig: " + path.relative(ROOT, zip));
