# P90-Protokoll – Kieback&Peter DDC3000 (RS232)

Stand: November 2026. Grundlage sind die Analyse von **SPClientDDC.exe** (K&P „DDC Sende-/Empfangsmodul“, MBS Software, V2.70) und echte Mitschnitte an zwei **DDC3200** mit Firmware **6.740**:
- einer DDC ohne Programm (Zentrale 1),
- einer DDC mit Programm (Zentrale 2: 12 Regelkreise, 17 Busmodule).

Kennzeichnung der Sicherheit:
- **[bestätigt]**: an der echten DDC beobachtet.
- **[rekonstruiert]**: aus SPClientDDC abgeleitet, an der DDC noch nicht geprüft.

---

## 1. Hardware und Schnittstelle

| | |
|---|---|
| Anschluss DDC3200 | Klemme **58 = TX** (DDC sendet), **59 = RX** (DDC empfängt), **60 = GND** (Datenblatt 2.50-10.200-01) |
| An 9-poligen PC-Stecker | 58 → Pin 2 (RxD), 59 → Pin 3 (TxD), 60 → Pin 5 (GND) |
| Format | **9600 Baud, 8N1**, keine Flusssteuerung, DTR und RTS an **[bestätigt]** (genau so öffnet SPClientDDC den Port) |
| Baudrate | DDC-Parameter **4600 „P90 Baudrate“** (Menü 69). Wert 2 entspricht 9600. |
| Weitere DDC-Parameter (Menü 69) | 2051 „P90 Mode“, 4599 „P90 Protokoll“. Zähler: 1264 „P90 Frames defekt“, 1265/1266 Rx/Tx-Frames je Sekunde, 1268/1269 Rx/Tx-Frames OK |
| Durchsatz | ca. **10 Blöcke/s** bei 9600 Baud (je Block ein ACK-Wechsel) **[bestätigt]** |

## 2. Sicherungsschicht

### 2.1 Steuerzeichen [bestätigt]
Steuerzeichen kommen **immer als Paar `16 xx`** (SYN + Zeichen):

| Bytes | Name | Bedeutung |
|---|---|---|
| `16 05` | ENQ | „Bist du bereit?“. Die DDC antwortet `16 14` |
| `16 06` | ACK | Block empfangen, Prüfsumme ok |
| `16 12` | DC2 | Beschäftigt, bitte warten. Der Sender fragt alle 2 s mit ENQ nach |
| `16 14` | DC4 | Bereit. Ein ausstehender Block wird erneut gesendet |
| `16 15` | NAK | Block fehlerhaft, bitte wiederholen |

### 2.2 Datenblock [bestätigt]
```
02  <Text>  [0D]  03  <CRC als 4 Hex-Zeichen, Großbuchstaben>  1A
STX                ETX                                          SUB
```
- **CRC-16/XMODEM:** Polynom 0x1021, Startwert 0, nicht gespiegelt. Berechnet über alle Bytes von STX bis einschließlich ETX, also auch über ein eventuelles CR. Prüfwert: `CRC("123456789") = 31C3`.
- Die **DDC** hängt vor ETX ein `0D` an. **SPClientDDC** sendet ohne CR. Die DDC akzeptiert beides.
- Statt ETX kann **ETB (`17`)** stehen. Das bedeutet „Fortsetzung folgt“ (von SPClientDDC ausgewertet, bei der DDC3200 nicht beobachtet).
- **Zeichensatz der Texte: CP850 (DOS).** Beispiele: `0x9A` = Ü, `0x81` = ü, `0xE1` = ß.
- Beispiel (echt): `02 "G0 0000 000000000000000 32 96 6.740 A 1 2 DDC001" 0D 03 "EA8A" 1A`

### 2.3 Zeilenformat [rekonstruiert, von der DDC3200 nicht benutzt]
`<2 Hex-Zeichen Bytesumme der Textzeichen> <Text> 0D`

### 2.4 Quittungsregeln [bestätigt]
- **Jeder empfangene Block wird sofort quittiert:** `16 06`, bei falscher Prüfsumme `16 15`.
- Die DDC sendet bei Listen den **nächsten Block erst nach dem ACK**.
- Ohne ACK wiederholt die DDC den Block **nach ca. 2,05 s**. Nach **3 Versuchen** gibt sie auf und bricht die laufende Liste ab. Genau so lässt sich eine Liste gefahrlos abbrechen: Quittungen aussetzen, bis 8 s Ruhe ist.
- Eigene Blöcke: auf ACK warten (3 s). Bei NAK oder Zeitüberschreitung wiederholen, insgesamt 4 Versuche (wie SPClientDDC).

### 2.5 Unaufgeforderte Blöcke der DDC [bestätigt]
- **`G0 0000 000000000000000 32 96 6.740 A 1 2 DDC001`**: Die DDC meldet sich alle **3 Minuten** an (3 Versuche im Abstand von 2 s, solange niemand antwortet).
- **`Z5 1.1.0 03.11.26 15:19`**: Datum und Uhrzeit, **jede Minute**, sobald ein Terminal angemeldet ist.
- Beide werden quittiert, gehören aber nicht zur Antwort auf eine laufende Anfrage.

## 3. Sitzung

### 3.1 Anmeldung [bestätigt]
```
PC : G0 0000 Terminalprog.__ 128 0 1.04 A 0.0.0 2 KPT001     (Kennung von SPClientDDC)
DDC: G1 0000 000000000000000 32 96 6.740 A 2 2 DDC001
```
Felder der DDC-Kennung (gedeutet):
- `32 96`: Gerätegruppe und -typ (DDC3200)
- `6.740`: Firmware
- `A 2 2`: das mittlere Feld entspricht der Zentralenadresse
- `DDC001`: Name

SPClientDDC antwortet mit `G1 …` statt `G0 …`, wenn das 3. Feld der DDC-Kennung `80` ist.

### 3.2 Adressen [bestätigt]
- Format **`a.z.g`**, z. B. `1.2.701`:
  - **a**: bisher immer 1
  - **z**: Zentralenadresse (Drehschalter)
  - **g**: Gerät
- Geräte:
  - `0` = Zentrale selbst
  - `1…20` = Regelkreise (Typen FESTWERT, LÜFTUNG, HEIZUNG)
  - `701…716` = SBM am Schaltschrankbus
  - `801…` = FBM am Feldbus
- **Kurzform `z.g`** (ohne `a`) wird ebenfalls verstanden: `p0 2.0 *` ist gleichbedeutend mit `p0 1.2.0 *`.
- **Parameter:** `<Buchstabe?><Nummer>/<Index>`, z. B. `5100/1`, `k4/1`, `N/2`, `M28/01`. Index 1 lässt SPClientDDC beim Senden weg.
- **`*`** ist ein Platzhalter. Wo er nicht erlaubt ist, antwortet die DDC mit `Z6 110 …` und gibt die verstandene Adresse zurück, z. B. `p0 1.*.* */*`.

### 3.3 Ende und Fehler [bestätigt]
- Jede Liste endet mit **`Z6 000 <Befehl> <Adresse>`**. `000` bedeutet ok.
- `Z6 <Code≠000> …` ist ein Fehler. Beobachtet: **110**, ungültige oder nicht erlaubte Adresse.
- **`Z2 <Code> …`** ist ein Formatfehler. Beobachtet: **048** bei `m0 *`.
- Bei `T0` endet die Liste mit `Z6 <letzte Adresse> <Gruppe> <Typ> <Status>`. Das ist die Wiederholung des letzten Geräts und gehört zur Liste.
- SPClientDDC schickt selbst `Z2 <Code> <Text>` an die DDC, wenn es einen Rahmen nicht versteht.

## 4. Lesebefehle [bestätigt]

| Anfrage | Antwort(en) | Inhalt |
|---|---|---|
| `T0 *.0` | `t1 1.2.0 32 96 00` … `Z6 …` | alle Zentralen am Zentralenbus |
| `T0 2.*` | `t1 1.2.1 31 110 00`, `t1 1.2.701 30 124 00` … | alle Geräte der Zentrale 2 (Adresse, Gruppe, Typ, Status) |
| `m0 2.0 *` | `m1 1.2.0 117/3 03` … `Z6 000 m0 1.2.0 */*` | aktive Menüs mit Instanz |
| `p0 2.0 *` | `p1 1.2.0 5100/1 28.5 108 0F 00 WT Becken…` … `Z6 000 p0 …` | Parameterwerte eines Geräts |
| `P0 1.1.0 4600` | `P1 1.1.0 4600/1 2 0F 04` | einzelner Parameter |
| `D0 <z>  *` (zwei Leerzeichen) | `D1 32 …` (≈1590 Zeilen) | Parameterdefinitionen der Firmware |
| `D2 <z> *` | `D3 32 …` (≈315) | Menüdefinitionen |
| `D4 <z> *` | `D5 …` (≈89) | Gerätetypen |
| `t0 *.0` | wie T0 | Variante, SPClientDDC nutzt beide |

### 4.1 Aufbau einer `p1`-Zeile
`p1 <Adresse> <Parameter>/<Index> <Wert …> <Einheit> <Attribut> <Status> [Klartext]`

Beispiele:
- `p1 1.2.1 5100/1 28.5 108 0F 00 WT Beckenwasser Temp. Beckenwasser Soll` (Einheit 108 = °C, mit Klartext)
- `p1 1.2.0 2150/1 002.710 B7/01 N AND 002.000 M28/01 N --- 0F 00` (Verknüpfung: Quelle 1 = Zentrale 2, Gerät 710, Parameter B7/01, nicht invertiert, AND …)
- `p1 1.2.0 T1/1 002.000 M5/01 N E 00:00:05/00:00:00 0F 00` (Timer)
- `p1 1.2.0 1014/1 00:00-24:00 --- --- --- 0F 00` (Nutzzeit)
- `p1 1.2.0 N/1 1 0F 00 Schwimmb.WWB Wochenprogramm`
- `p1 1.1.0 b2/1 ???? 0 0F 20` (Status 20: Wert ungültig, z. B. Fühlerbruch)
- Texte stehen in Anführungszeichen: `p1 1.1.0 2141/1 "01712521002" 0F 00`

`p0` liefert offenbar nur Parameter, die vom Standardwert abweichen oder für die Sicherung relevant sind. Bei der DDC ohne Programm fehlten z. B. 4599 und 2051. `P0` liefert jeden einzelnen Parameter.

### 4.2 Definitionen
- **`D1 <Gruppe> <Parameter|Bereich> <Typ> <Format> <Max> <Min> <Vorgabe> <Einheit> <Attribut> 0F 0000 <Name>`**
  - Beispiel: `D1 32 5181 1 0A 30.00 5.00 17.00 108 01 0F 0000 TR min`
  - Bereiche wie `635-637` oder `H7-H8`. Ein `%(1)` im Namen wird durch den Index ersetzt.
- **Attribut-Bit 0x40 = Istwert/Meldung (nur lesen).** Von 3364 Werten der programmierten DDC sind 1378 Istwerte. Sie dürfen beim Einspielen **nicht** zurückgeschrieben werden.
- Typ und Attribut ergeben eindeutig das Token der Schnellparametrierung (.wwf). An einer echten .wwf mit rund 2000 Parametern ohne Ausnahme geprüft:

| D1-Typ | Attribut 0x40 gesetzt | sonst |
|---|---|---|
| 1, 2, 3, 14, 20 (analog/Zeit) | **AI** analoger Istwert | **AX** analoger Sollwert |
| 10, 13 (digital) | **DM** digitale Meldung | **DS** digitaler Sollwert |
| 4 | – | **TX** Text |
| 31, 34 | – | **V** Verknüpfung |
| 32 | – | **T** Timer |
| 33 | – | **L** Lampe |

- **`D3 <Gruppe> <Menü> … <Anzahl> <Parameterliste> <Name>`**, z. B. `D3 32 69 00 01 1 000 024 4599-4600 2051 … Systemmenü`
- **`D5 <Gruppe> <Typ> 1 1 <Anzahl> <Menü>/<max. Instanzen> … <Name>`**, z. B. `D5 30 124 … SBM45`, `D5 31 110 … LÜFTUNG`

## 5. Ablauf der Sicherung (umgesetzt in `src/ui/p90/backup.js`) [bestätigt]
1. Anmelden (`G0 …` → `G1 …`).
2. `T0 *.0` → alle Zentralen.
3. Je Zentrale `T0 <z>.*` → alle Geräte.
4. Je Gerät `m0 <z>.<g> *` und `p0 <z>.<g> *`.
5. Optional je Zentrale `D0 <z>  *`, `D2 <z> *`, `D4 <z> *`.

Messwert: Die programmierte DDC mit 30 Geräten und Definitionen brauchte rund 13 Minuten.

### 5.1 Sicherungsdatei (`.p90`, UTF-8)
```
# P90-Sicherung (Kieback&Peter DDC3000)
# Erstellt: 3.11.2026, 16:31:10
# Kennung: G1 0000 000000000000000 32 96 6.740 A 2 2 DDC001
# Geräte: 30
# Zeichensatz: UTF-8 (Klartexte der DDC aus CP850 umgewandelt)

[Gerät 1.2.0 DDC3200 32 96]
m1 1.2.0 224/1 03
…
p1 1.2.0 899/1 6.740 0 0F 00
…
# Ende m0: Z6 000 m0 1.2.0 */* | Ende p0: Z6 000 p0 1.2.0 */*

[Definitionen 1.2.0 D0 Parameterdefinitionen]
D1 32 1 20 00 24:59 00:00 07:00 0 81 0F 0000 Mo-BEGINN1
…
# Fertig nach 766 s, ohne Fehler
```
- Die Zeilen `m1`/`p1` sind **unverändert die Antworten der DDC** und damit dasselbe, was SPClientDDC in eine .PRO-Datei schreibt.
- Ältere Dateien aus dem HTML-Tool enthalten statt UTF-8 die rohen CP850-Bytes als Zeichen U+0080–U+00FF. `parseBackup()` erkennt das am fehlenden Zeichensatz-Kopf und wandelt um.

## 6. Einspielen – rekonstruiert, NICHT umgesetzt, NICHT an der DDC geprüft
Ablauf in SPClientDDC (Funktion „PRO-Datei senden“, 0x430C90):
1. **`G6 <Adresse> <Gruppe> <Typ>`**, z. B. `G6 1.2.0 32 96`: Gerät für die Parametrierung anhalten. Bei Fehler bricht SPClientDDC ab („Konnte Gerät für Parametrierung nicht anhalten“).
2. **Jede Zeile der Sicherung als Block senden.** Zulässige Zeilenarten: `t1`/`T1`, `m1`/`M1`, `p1`/`P1`, `P8`, `W0`, `W8`; alle anderen werden ignoriert („Frame ignoriert“).
   - Die Zeile wird zerlegt und neu aufgebaut, dabei fällt Index `/1` weg.
   - Nach jeder Zeile wartet SPClientDDC auf die Antwort. **Code 64** heißt beschäftigt: die Zeile bis zu 5-mal wiederholen. Jeder andere Code ungleich 0 ist ein Fehler (Rückfrage „erneut senden?“).
   - **Alle 50 Zeilen** schickt SPClientDDC ein **`Z0`** (Statusabfrage). Bekommt es `Z0`, antwortet es selbst mit `Z1 00 00 00 00`.
3. **`G5 <Adresse> <Gruppe> <Typ>`**: Gerät wieder starten.

> Achtung, Deutung von G5/G6: Scheitert `G6`, zeigt SPClientDDC „Konnte Gerät für Parametrierung nicht anhalten“. Deshalb steht hier G6 = Anhalten, G5 = Starten. Die internen Debug-Texte des Programms („Stop Device“ nach G5, „Start Device“ nach G6) lassen sich auch umgekehrt lesen. Vor einer Umsetzung an einer unkritischen DDC prüfen.

Offene Punkte vor einer Umsetzung:
- **Antwort der DDC auf einen Schreibbefehl ist unbekannt.** Der vorbereitete Schreibtest im HTML-Tool klärt das: Wert mit `P0` lesen, mit `p1` unverändert zurückschreiben, wieder lesen.
- Istwerte (Attribut 0x40) beim Einspielen auslassen.
- Die Option „Neu, bestehende Daten werden vorher gelöscht“ ist nicht geklärt. Bekannt ist nur „Additiv“, also überschreiben.
- Bedeutung von `P7`/`P8`, `W0`/`W8` unklar. SPClientDDC verwendet sie beim Auslesen, `W8` mit Text `80`.
- `G5`/`G6` müssen sicher zusammenpassen: Wenn das Einspielen mittendrin abbricht, muss trotzdem `G5` gesendet werden, sonst bleibt die Zentrale angehalten.

## 7. Weitere Befehlskürzel in SPClientDDC
Gefunden, Bedeutung nur teilweise bekannt:

| Kürzel | Bedeutung |
|---|---|
| G0/G1 | Kennung |
| G4–G6 | Gerät; vermutlich G6 = Anhalten, G5 = Starten (siehe Abschnitt 6) |
| G8 | `G8 %s` |
| I9 | ? |
| M0/M1, M6, M8, m0/m1 | Menüs |
| P0/P1, p0–p3, P4/P5, P7/P8 | Parameter |
| S1, S2, S7 | ? |
| T0/T1, t0/t1 | Typ/Geräte |
| T9 | ? |
| W0, W2–W6, W8/W9 | ? |
| Z0/Z1 | Status |
| Z2 | Fehler |
| Z4/Z5 | Uhrzeit |
| Z6 | Ende |
| Z9 | Übertragung abbrechen |
| D0–D5 | Definitionen |

## 8. Bezug zur Schnellparametrierung
- **.wwf** = „Arbeitsdatei (Windows-Format)“. Es ist RTF mit Token-Zeilen:
  - `Z` Zentrale, `B` Gerät, `K NR=` Kreis/Modul, `M NR=117/3; AKTIV=1` Menü
  - `AX P=…; W=…`, `DS`, `AI`, `DM`, `TX`, `V`, `T`, `L` (Parameter)
  - `N` Wochenprogramm, `J` Jahresprogramm, `GT=` Klartext
- Die Schnellparametrierung übersetzt die .wwf in eine **.PRO-Datei**, und SPClientDDC sendet diese. Beim Auslesen läuft es umgekehrt: Die .PRO wird in die .wwf „eingetragen“.
- Eine Umwandlung `.p90 → .wwf` ist mit den Definitionen (Abschnitt 4.2) machbar, aber noch nicht gebaut.
