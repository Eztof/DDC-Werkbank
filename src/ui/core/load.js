/* =========================================================================
   Dateien einsammeln: Ordner, ZIP, Einzeldateien
   ========================================================================= */
async function readZip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), out = {};
  let eo = -1;
  for (let i = buf.byteLength - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; } }
  if (eo < 0) throw new Error("Keine gültige ZIP-Datei.");
  const cnt = dv.getUint16(eo + 10, true); let off = dv.getUint32(eo + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < cnt; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nlen));
    off += 46 + nlen + elen + clen;
    if (name.endsWith("/")) continue;
    const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnlen + lelen;
    const comp = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = comp.slice();
    else if (method === 8) {
      const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else continue;
    out[name] = data;
  }
  return out;
}

export async function entriesFromDrop(items) {
  const files = [];
  const read = (entry, path) => new Promise(res => {
    if (entry.isFile) entry.file(f => { f._path = path + f.name; files.push(f); res(); }, () => res());
    else if (entry.isDirectory) {
      const rd = entry.createReader(), all = [];
      const batch = () => rd.readEntries(async es => {
        if (!es.length) { await Promise.all(all.map(e => read(e, path + entry.name + "/"))); res(); }
        else { all.push(...es); batch(); }
      }, () => res());
      batch();
    } else res();
  });
  const roots = [];
  for (const it of items) { const e = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (e) roots.push(e); }
  await Promise.all(roots.map(e => read(e, "")));
  return files;
}

/* Bytes → Text: UTF-8, sonst Windows-1252 (DDC3000-Sicherungen) */
export function decodeBytes(u8) {
  if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) u8 = u8.subarray(3);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); }
  catch (e) { return new TextDecoder("windows-1252").decode(u8); }
}

/* Was ist das für eine Datei? */
function sniffKind(name, text) {
  const n = name.toLowerCase();
  const head = text.slice(0, 4000);
  if (/^\s*\{\\rtf/.test(head) && /(TYP=DDC3|NR=\d+\s*;\s*TYP=|\bAI\s+P=)/.test(text.slice(0, 20000))) return "ddc3000";
  if (/^\s*Z\s+NR=\s*\d+\s*;\s*TYP=/m.test(head)) return "ddc3000";
  if (/<D4PML[\s>]/.test(head)) return "d4pml";
  if (/<([\w-]+:)?Maintenance[\s>]/.test(head) || n.endsWith(".wtgml")) return "wtgml";
  return null;
}
const WANT_EXT = /\.(xml|d4pml|wwf|wtgml|rtf|txt|dat)$/i;
const SKIP_ZIP = /^(pidata|security|lonconf|trend|graphic)/i;

function labelOf(path) {
  const parts = path.split("/").filter(Boolean);
  const file = parts.pop() || path;
  for (let i = parts.length - 1; i >= 0; i--) if (!/^\d{4}-\d{2}-\d{2}/.test(parts[i])) return parts[i];
  if (parts.length) return parts[parts.length - 1];
  return file.replace(/\.(xml|d4pml|wwf|rtf|txt)$/i, "");
}

export async function collectInputs(files) {
  const found = [];   // {kind, label, name, text}
  const consider = (name, path, text) => {
    const kind = sniffKind(name, text);
    if (kind) found.push({ kind, label: kind === "wtgml" ? name : labelOf(path), name, path, text });
  };
  for (const f of files) {
    const path = f._path || f.webkitRelativePath || f.name;
    const lower = f.name.toLowerCase();
    try {
      if (lower.endsWith(".zip")) {
        if (SKIP_ZIP.test(f.name)) continue;
        const zip = await readZip(await f.arrayBuffer());
        for (const [zname, data] of Object.entries(zip)) {
          const base = zname.split("/").pop();
          if (!WANT_EXT.test(base)) continue;
          consider(base, f.name.replace(/\.zip$/i, "") + "/" + zname, decodeBytes(data));
        }
      } else if (WANT_EXT.test(lower) || !/\./.test(lower)) {
        if (f.size > 60 * 1024 * 1024) continue;
        consider(f.name, path, decodeBytes(new Uint8Array(await f.arrayBuffer())));
      }
    } catch (e) { console.warn("Datei übersprungen", f.name, e); }
  }
  return found;
}

