/* =========================================================================
   Serielle Schnittstelle im Browser (Web Serial, Chrome/Edge).
   Einstellungen wie im K&P-Programm SPClientDDC: 8N1, keine Flusssteuerung,
   DTR und RTS an. Baudrate = DDC-Parameter 4600 (meist 9600).
   Ergebnis ist ein Transport für P90Link.
   ========================================================================= */
export const serialSupported = () => typeof navigator !== "undefined" && !!navigator.serial;

/* bekannte Ports beschriften (USB-Kennung, Hersteller ist im Browser nicht sichtbar) */
const VENDORS = { 0x067b: "Prolific", 0x0403: "FTDI", 0x10c4: "Silicon Labs", 0x1a86: "CH340", 0x2341: "Arduino" };
export function portLabel(port, i) {
  const inf = (port.getInfo && port.getInfo()) || {};
  if (inf.usbVendorId == null) return "Port " + (i + 1) + " (seriell)";
  const v = VENDORS[inf.usbVendorId] || "USB " + inf.usbVendorId.toString(16).padStart(4, "0");
  return "Port " + (i + 1) + " · " + v + (inf.usbProductId != null ? " " + inf.usbProductId.toString(16).padStart(4, "0") : "");
}

export async function knownPorts() { return serialSupported() ? navigator.serial.getPorts() : []; }
export async function pickPort() { return navigator.serial.requestPort(); }

export async function openSerial(port, { baudRate = 9600 } = {}) {
  try { await port.open({ baudRate, dataBits: 8, parity: "none", stopBits: 1, flowControl: "none", bufferSize: 65536 }); }
  catch (e) {
    if (!/already open/i.test(e.message || "")) throw new Error("Port lässt sich nicht öffnen: " + e.message + " (von einem anderen Programm belegt?)");
  }
  try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (e) { /* nicht jeder Adapter */ }
  const listeners = new Set();
  let keep = true, reader = null;
  const loop = (async () => {
    while (keep && port.readable) {
      reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) for (const fn of listeners) fn(value);
        }
      } catch (e) { console.warn("Seriell lesen:", e.message); }   // z. B. BufferOverrunError – weiterlesen
      finally { try { reader.releaseLock(); } catch (e) { /* schon frei */ } }
    }
  })();
  return {
    port,
    async write(bytes) { const w = port.writable.getWriter(); try { await w.write(bytes); } finally { w.releaseLock(); } },
    on(ev, fn) { if (ev === "data") listeners.add(fn); },
    removeListener(ev, fn) { listeners.delete(fn); },
    async close() {
      keep = false;
      try { if (reader) await reader.cancel(); } catch (e) { /* egal */ }
      await loop;
      try { await port.close(); } catch (e) { /* schon zu */ }
    }
  };
}
