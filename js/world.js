// Weltrenderer: zeichnet die Karte über den 240x160-Bildausschnitt des Spiels hinaus weiter.
//
// Das Spiel (touch_world.c) meldet, wo die Kamera steht und wo Kartentabelle, Kachel-Tabellen und
// Figuren liegen. Dieser Code liest das nur lesend aus dem Emulator-Speicher und baut daraus
// dasselbe Bild, das der Spielchip zeichnen würde - aber für einen größeren Ausschnitt.
//   Kartentabelle -> Metakacheln (ROM) -> 8x8-Kacheln (VRAM) -> Farben (Paletten-Puffer im EWRAM)
// Das echte Spielbild liegt später genau in der Mitte; ein Vergleich beider Bilder (siehe
// check()) zeigt, ob alles stimmt. Falls nicht, wird die Erweiterung einfach nicht benutzt.

export const TW_VERSION = 4;
export const TW_SIZE = 752;

const EWRAM_BASE = 0x02000000;
const EWRAM_SIZE = 0x40000;

// BGR555 -> RGBA (Little-Endian Uint32: R | G<<8 | B<<16 | A<<24)
export const LUT = (() => {
  const t = new Uint32Array(32768);
  for (let c = 0; c < 32768; c++) {
    const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
    // gleiche Umrechnung wie mGBA: (c << 3) | (c >> 2)
    t[c] = ((r << 3) | (r >> 2)) | (((g << 3) | (g >> 2)) << 8) | (((b << 3) | (b >> 2)) << 16) | 0xff000000;
  }
  return t;
})();

// OAM-Formen: [Form][Größe] -> [Breite, Höhe]
const SPR_DIM = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];

/** GBA-BIOS LZ77 (Typ 0x10) entpacken. */
export function lz77(u8, off) {
  const size = (u8[off + 1] | (u8[off + 2] << 8) | (u8[off + 3] << 16)) >>> 0;
  const out = new Uint8Array(size);
  let ip = off + 4, op = 0;
  while (op < size) {
    const flags = u8[ip++];
    for (let i = 7; i >= 0 && op < size; i--) {
      if ((flags >> i) & 1) {
        const b1 = u8[ip++], b2 = u8[ip++];
        const len = (b1 >> 4) + 3;
        const disp = (((b1 & 15) << 8) | b2) + 1;
        for (let k = 0; k < len && op < size; k++, op++) out[op] = out[op - disp];
      } else {
        out[op++] = u8[ip++];
      }
    }
  }
  return out;
}

export class Mem {
  constructor(getMemory) {
    this.getMemory = getMemory;
    this.buf = null;
    this.u8 = null;
    this.u32 = null;
    this.ewram = -1; // Byte-Offset des EWRAM im Heap
    this.rom = -1;
    this.vram = -1;
  }

  refresh() {
    const m = this.getMemory();
    if (!m) return false;
    if (m.buffer !== this.buf) {
      this.buf = m.buffer;
      this.u8 = new Uint8Array(m.buffer);
      this.u32 = new Uint32Array(m.buffer);
    }
    return true;
  }

  r8(a) { return this.u8[this.off(a)]; }
  r16(a) { const o = this.off(a); return this.u8[o] | (this.u8[o + 1] << 8); }
  r32(a) { const o = this.off(a); return (this.u8[o] | (this.u8[o + 1] << 8) | (this.u8[o + 2] << 16) | (this.u8[o + 3] << 24)) >>> 0; }
  s16(a) { const v = this.r16(a); return v & 0x8000 ? v - 0x10000 : v; }

  off(a) {
    switch (a >>> 24) {
      case 2: return this.ewram + (a & 0x3ffff);
      case 6: return this.vram + (a & 0x1ffff);
      case 8: case 9: case 10: case 11: case 12: case 13: return this.rom + (a & 0x1ffffff);
      default: return 0;
    }
  }

  /** Sucht das ROM im Heap (Kopfzeile "POKEMON EMER" + "BPEE" bei 0xA0). */
  findRom() {
    if (!this.refresh()) return false;
    const w = this.u32;
    let i = 0;
    const POKE = 0x454b4f50, MON = 0x204e4f4d, EMER = 0x52454d45, BPEE = 0x45455042;
    while ((i = w.indexOf(POKE, i)) >= 0) {
      if (w[i + 1] === MON && w[i + 2] === EMER && w[i + 3] === BPEE) {
        const base = i * 4 - 0xa0;
        if (base >= 0) { this.rom = base; return true; }
      }
      i++;
    }
    return false;
  }

  /**
   * Sucht den Bildspeicher (VRAM): Das Spiel entpackt die Kachelgrafik des Haupt-Tilesets an dessen
   * Anfang. Wir entpacken dasselbe aus dem ROM und suchen es im Heap.
   * tiles: Uint8Array mit den (entpackten) Kacheln des Haupt-Tilesets.
   */
  /**
   * Grafikspeicher ohne Oberwelt finden: Im Hauptmenü und in der Einführung schreibt das Spiel eine Marke (64 Byte) an das Ende des
   * Objekt-Grafikspeichers (Byte 0x17FC0). Die Marke wird zur Laufzeit berechnet, damit sie nirgends in der ROM steht.
   */
  findVramProbe() {
    if (!this.refresh()) return false;
    const w = this.u32;
    const word = (k) => (Math.imul(k + 1, 0x9e3779b1) ^ 0xa5c3e1f7) >>> 0;
    const first = word(0);
    let i = 0;
    while ((i = w.indexOf(first, i)) >= 0) {
      const at = i++;
      let ok = true;
      for (let k = 1; k < 16 && ok; k++) if (w[at + k] !== word(k)) ok = false;
      if (!ok) continue;
      const base = at * 4 - 0x17fc0;
      if (base < 0 || base + 0x18000 > this.u8.length) continue;
      if (base >= this.ewram && base < this.ewram + EWRAM_SIZE) continue;
      this.vram = base;
      return true;
    }
    return false;
  }

  findVram(tiles, secTiles) {
    if (!this.refresh() || tiles.length < 4096) return false;
    const w = this.u32;
    // Ankerkacheln mit vielen verschiedenen Bytewerten wählen
    const anchors = [];
    const nTiles = Math.min(512, tiles.length >> 5);
    for (let t = 8; t < nTiles && anchors.length < 8; t += 7) {
      const set = new Set();
      for (let k = 0; k < 32; k++) set.add(tiles[t * 32 + k]);
      if (set.size >= 8) anchors.push(t);
    }
    if (!anchors.length) return false;
    const tw = new Uint32Array(tiles.buffer, tiles.byteOffset, tiles.length >> 2);
    const cands = [];
    const a0 = anchors[0];
    const key = tw[a0 * 8];
    let i = 0;
    while ((i = w.indexOf(key, i)) >= 0) {
      const base = i * 4 - a0 * 32;
      i++;
      if (base < 0) continue;
      if (base >= this.ewram && base < this.ewram + EWRAM_SIZE) continue;
      if (base + 0x18000 > this.u8.length) continue;
      let ok = true;
      for (let k = 1; k < 8 && ok; k++) if (w[i - 1 + k] !== tw[a0 * 8 + k]) ok = false;
      if (!ok) continue;
      // übrige Anker
      let hit = 1;
      for (let j = 1; j < anchors.length; j++) {
        const t = anchors[j];
        let same = true;
        for (let k = 0; k < 8; k++) if (w[(base >> 2) + t * 8 + k] !== tw[t * 8 + k]) { same = false; break; }
        if (same) hit++;
      }
      if (hit >= Math.max(2, anchors.length - 2)) cands.push(base);
    }
    this.vramCands = cands;
    if (!cands.length) return false;
    // Bei mehreren Treffern den nehmen, bei dem Haupt- UND Neben-Tileset (ab Kachel 512) übereinstimmen
    const nSec = secTiles ? Math.min(512, secTiles.length >> 5) : 0;
    const sw = secTiles ? new Uint32Array(secTiles.buffer, secTiles.byteOffset, secTiles.length >> 2) : null;
    const count = (base, arr, n, first) => {
      let score = 0;
      for (let t = 0; t < n; t++) {
        let same = true;
        for (let k = 0; k < 8; k++) if (w[(base >> 2) + (first + t) * 8 + k] !== arr[t * 8 + k]) { same = false; break; }
        if (same) score++;
      }
      return score;
    };
    let best = -1, bestScore = -1, bestPri = 0, bestSec = 0;
    for (const base of cands) {
      const p = count(base, tw, nTiles, 0) / nTiles;
      const q = nSec >= 4 ? count(base, sw, nSec, 512) / nSec : 1;
      if (p + q > bestScore) { bestScore = p + q; best = base; bestPri = p; bestSec = q; }
    }
    this.vram = best;
    this.vramScore = bestPri;
    this.vramScoreSec = bestSec;
    if (bestPri > 0.6 && bestSec > 0.6) return true;
    this.vram = -1;
    return false;
  }
}

/** Kampfdaten (touch_battle.h, Offset 548, 180 Bytes). */
function parseBattle(dv, b) {
  const o = 548;
  const bt = {
    active: b[o] === 1,
    scene: b[o + 1],
    count: Math.min(4, b[o + 2]),
    weather: b[o + 3],
    typeFlags: dv.getUint32(o + 4, true),
    safariBalls: b[o + 8],
    intro: b[o + 9] === 1,
    mons: [],
    lvl: null,
  };
  for (let i = 0; i < 4; i++) {
    const q = o + 12 + i * 32;
    bt.mons.push({
      shown: b[q] === 1, side: b[q + 1], pos: b[q + 2], level: b[q + 3], status: b[q + 4], gender: b[q + 5],
      caught: b[q + 6] === 1, hasExp: b[q + 7] === 1,
      species: dv.getUint16(q + 8, true), hp: dv.getUint16(q + 10, true), maxHp: dv.getUint16(q + 12, true),
      exp: dv.getUint16(q + 14, true), name: b.slice(q + 16, q + 28),
    });
  }
  const l = o + 140;
  if (b[l] > 0) {
    const before = [], after = [];
    for (let i = 0; i < 6; i++) { before.push(dv.getUint16(l + 4 + i * 2, true)); after.push(dv.getUint16(l + 16 + i * 2, true)); }
    bt.lvl = { page: b[l], level: b[l + 1], gender: b[l + 2], before, after, name: b.slice(l + 28, l + 40) };
  }
  return bt;
}

export class World {
  /**
   * @param {() => WebAssembly.Memory | null} getMemory
   */
  constructor(getMemory) {
    this.mem = new Mem(getMemory);
    this.snap = null;
    this.state = 'init'; // init | wait | ready | fail
    this.worldAddr = 0;
    this.buf = new Uint8Array(TW_SIZE);
    this.mapKey = '';
    this.pal32 = new Uint32Array(256);
    this.tileCache = null;
    this.voidBorder = false;
    this.lastDiscover = 0;
    this.vramTry = 0;
    this.vramVerify = -1;
    this._tilesByPtr = new Map();
    this.stats = {};
  }

  /** Aus dem Bridge-Schnappschuss: wo liegt der EWRAM / die Weltdaten. */
  attach(bridgeBase, selfAddr, worldAddr) {
    if (!this.mem.refresh()) return;
    if (!selfAddr || (selfAddr >>> 24) !== 2) return;
    this.mem.ewram = bridgeBase - (selfAddr - EWRAM_BASE);
    this.worldAddr = worldAddr;
  }

  get attached() { return this.mem.ewram >= 0 && this.worldAddr !== 0; }

  /** Weltdaten lesen (Seqlock). Liefert true, wenn ein gültiger Schnappschuss vorliegt. */
  read() {
    const m = this.mem;
    if (!this.attached || !m.refresh()) return false;
    const o = m.ewram + (this.worldAddr & 0x3ffff);
    if (o + TW_SIZE > m.u8.length) return false;
    const src = m.u8.subarray(o, o + TW_SIZE);
    const b = this.buf;
    for (let attempt = 0; attempt < 4; attempt++) {
      const s1 = src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24);
      if (s1 & 1) continue;
      b.set(src);
      const s2 = src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24);
      if (s1 !== s2) continue;
      const dv = new DataView(b.buffer);
      if (dv.getUint32(4, true) !== 0x31575445 || dv.getUint16(8, true) !== TW_VERSION) return false;
      const rd = (off) => dv.getUint32(off, true);
      const s = {
        frame: rd(12),
        valid: b[16] === 1,
        screen: b[86], // 1 = Hauptmenü/Einführung (Textfenster auf BG0)
        mapType: b[17],
        weather: b[18],
        flags: b[19],
        camX: dv.getInt16(20, true),
        camY: dv.getInt16(22, true),
        gridW: dv.getInt16(24, true),
        gridH: dv.getInt16(26, true),
        gridPtr: rd(28),
        borderPtr: rd(32),
        priTiles: rd(36), priMeta: rd(40), priAttr: rd(44),
        secTiles: rd(48), secMeta: rd(52), secAttr: rd(56),
        priComp: b[60], secComp: b[61],
        mapGroup: b[62], mapNum: b[63],
        pltt: rd(64),
        playerX: dv.getInt16(68, true),
        playerY: dv.getInt16(70, true),
        tblGfx: rd(72), tblPal: rd(76), tblFacing: rd(80),
        mapGroups: rd(88), connPtr: rd(92),
        plttU: rd(448),
        fadeSel: rd(452),
        fadeColor: dv.getUint16(456, true),
        fadeY: b[458],
        fadeActive: b[459],
        dispcnt: dv.getUint16(460, true),
        bg0cnt: dv.getUint16(462, true),
        bg0hofs: dv.getUint16(464, true),
        bg0vofs: dv.getUint16(466, true),
        bg0Hidden: b[468],
        fadeMode: b[469],
        popupSerial: b[470],
        popupTheme: b[471],
        popupName: b.slice(472, 496),
        npcs: [],
        camHist: [],
      };
      s.wins = [];
      for (let i = 0, n = Math.min(12, b[496]); i < n; i++) s.wins.push({ x: b[500 + i * 4], y: b[501 + i * 4], w: b[502 + i * 4], h: b[503 + i * 4], bg: b[728 + i], id: b[740 + i] });
      s.battle = parseBattle(dv, b);
      for (let i = 0; i < 8; i++) s.camHist.push({ x: dv.getInt16(416 + i * 4, true), y: dv.getInt16(418 + i * 4, true) });
      const n = Math.min(40, b[84]);
      for (let i = 0; i < n; i++) {
        const q = 96 + i * 8;
        s.npcs.push({ x: dv.getInt16(q, true), y: dv.getInt16(q + 2, true), gfx: b[q + 4], dir: b[q + 5], flags: b[q + 6], id: b[q + 7] });
      }
      this.snap = s;
      return true;
    }
    return !!this.snap;
  }

  /**
   * ROM und VRAM finden (einmalig, später bei Kartenwechsel prüfen).
   * Gibt true zurück, wenn gerendert werden kann.
   */
  prepare() {
    const s = this.snap;
    const m = this.mem;
    if (!s || !s.valid) return this.state === 'ready';
    if (m.rom < 0 && !m.findRom()) { this.state = 'fail'; this.failWhy = 'rom'; return false; }
    const key = s.priTiles + ':' + s.secTiles;
    if (key !== this.mapKey) {
      this.mapKey = key;
      // Kachelgrafiken der Tilesets (ROM) laden: für die VRAM-Suche und zur Prüfung.
      // Pro Zeiger nur einmal entpacken (beim Hin- und Herlaufen zwischen zwei Karten sonst jedes Mal).
      const loadTiles = (ptr, comp, n) => {
        const ck = ptr + ':' + comp;
        let d = this._tilesByPtr.get(ck);
        if (!d) {
          const o = m.off(ptr);
          d = comp ? lz77(m.u8, o) : m.u8.slice(o, o + n * 32);
          if (this._tilesByPtr.size > 24) this._tilesByPtr.clear();
          this._tilesByPtr.set(ck, d);
        }
        return d;
      };
      this.priTilesData = loadTiles(s.priTiles, s.priComp, 512);
      this.secTilesData = loadTiles(s.secTiles, s.secComp, 512);
      // Der Bildspeicher liegt immer an derselben Stelle. Beim Kartenwechsel kopiert das Spiel die neuen Kacheln
      // aber erst im nächsten VBlank: ein sofortiger Vergleich schlägt dann fehl, und eine neue Suche kostet viele
      // Bilder Stillstand. Deshalb behalten wir die Adresse und prüfen sie erst nach einigen Bildern erneut.
      this.vramVerify = m.vram >= 0 ? 0 : -1;
    }
    if (m.vram >= 0 && this.vramVerify >= 0) {
      if (this._vramLooksOk(true)) this.vramVerify = -1;
      else if (++this.vramVerify > 30) {
        m.vram = -1;
        this.vramTry = 0;
        this.vramVerify = -1;
      }
    }
    if (m.vram < 0) {
      // Suche (dauert einige 10 ms): höchstens alle 300 ms
      const now = performance.now();
      if (now - this.vramTry < 300) { this.state = 'fail'; this.failWhy = 'vram'; return false; }
      this.vramTry = now;
      if (!m.findVram(this.priTilesData, this.secTilesData)) { this.state = 'fail'; this.failWhy = 'vram'; return false; }
    }
    this.state = 'ready';
    return true;
  }

  /** Stimmt der Bildspeicher an der gemerkten Stelle? priOnly: nur das Haupt-Tileset prüfen (das Neben-Tileset kann gerade erst nachgeladen werden). */
  _vramLooksOk(priOnly) {
    const m = this.mem;
    if (m.vram < 0) return false;
    const w = m.u32;
    const frac = (t, first) => {
      const tw = new Uint32Array(t.buffer, t.byteOffset, t.length >> 2);
      const nt = Math.min(512, t.length >> 5);
      let same = 0, n = 0;
      for (let tile = 1; tile < nt; tile += 3) {
        n++;
        let eq = true;
        for (let k = 0; k < 8; k++) if (w[(m.vram >> 2) + (first + tile) * 8 + k] !== tw[tile * 8 + k]) { eq = false; break; }
        if (eq) same++;
      }
      return n > 0 ? same / n : 1;
    };
    return frac(this.priTilesData, 0) > 0.6 && (priOnly || this.secTilesData.length < 128 || frac(this.secTilesData, 512) > 0.6);
  }

  // ---------- Zeichnen ----------

  /** Muss vor renderCell()/gridRaw() je Bild einmal aufgerufen werden. */
  beginCells(reloadPalettes) {
    const m = this.mem;
    const s = this.snap;
    m.refresh();
    if (reloadPalettes || !this._palLoaded) this._loadPalettes();
    this._gridOff = m.off(s.gridPtr);
    const bo = m.off(s.borderPtr);
    this._borderId = [0, 1, 2, 3].map((k) => (m.u8[bo + k * 2] | (m.u8[bo + k * 2 + 1] << 8)) & 0x3ff);
    // Kennzahl der Randkacheln (Teil der Zellen-Signatur: andere Karte -> anderer Rand -> neu zeichnen)
    this.borderSig = (((this._borderId[0] * 31 + this._borderId[1]) * 31 + this._borderId[2]) * 31 + this._borderId[3]) & 0xfffff;
    this._priMeta = m.off(s.priMeta);
    this._priAttr = m.off(s.priAttr);
    this._secMeta = m.off(s.secMeta);
    this._secAttr = m.off(s.secAttr);
    this._loadConns();
  }

  /**
   * Nachbarkarten (Verbindungen) der aktuellen Karte aus der ROM lesen. Das Spiel selbst hält nur 7 Kacheln
   * der Nachbarkarte im Kartenpuffer; die App zeigt mehr und liest den Rest hier selbst.
   */
  _loadConns() {
    const s = this.snap;
    const m = this.mem;
    const key = s.mapGroups + ':' + s.connPtr + ':' + s.mapGroup + ':' + s.mapNum;
    if (key === this._connKey) return;
    this._connKey = key;
    this._conns = [];
    const isRom = (a) => (a >>> 24) === 8;
    if (!isRom(s.mapGroups) || !isRom(s.connPtr) || m.rom < 0) return;
    try {
      const count = m.r32(s.connPtr);
      const list = m.r32(s.connPtr + 4);
      if (count < 1 || count > 16 || !isRom(list)) return;
      for (let i = 0; i < count; i++) {
        const a = list + i * 12;
        const dir = m.r8(a);
        const offset = m.r32(a + 4) | 0;
        const group = m.r8(a + 8), num = m.r8(a + 9);
        if (dir < 1 || dir > 4) continue;
        const tab = m.r32(s.mapGroups + group * 4);
        if (!isRom(tab)) continue;
        const hdr = m.r32(tab + num * 4);
        if (!isRom(hdr)) continue;
        const layout = m.r32(hdr);
        if (!isRom(layout)) continue;
        const w = m.r32(layout), h = m.r32(layout + 4), map = m.r32(layout + 12);
        if (w < 1 || w > 512 || h < 1 || h > 512 || !isRom(map)) continue;
        this._conns.push({ dir, offset, w, h, off: m.off(map), group, num });
      }
    } catch (e) {
      this._conns = [];
    }
  }

  /**
   * Rohwert einer Kachel außerhalb dessen, was das Spiel selbst bereithält: aus der Nachbarkarte
   * (Richtungen: 1 Süd, 2 Nord, 3 West, 4 Ost). 0xffff = keine Nachbarkarte dort.
   */
  connRaw(gx, gy) {
    const cs = this._conns;
    if (!cs || !cs.length) return 0xffff;
    const s = this.snap;
    const mx = gx - 7, my = gy - 7;
    const W = s.gridW - 15, H = s.gridH - 14;
    const u8 = this.mem.u8;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of cs) {
        let cx, cy;
        if (pass === 0) {
          // Nord/Süd zuerst
          if (c.dir === 2) { if (my >= 0) continue; cx = mx - c.offset; cy = c.h + my; }
          else if (c.dir === 1) { if (my < H) continue; cx = mx - c.offset; cy = my - H; }
          else continue;
        } else {
          if (c.dir === 3) { if (mx >= 0) continue; cx = c.w + mx; cy = my - c.offset; }
          else if (c.dir === 4) { if (mx < W) continue; cx = mx - W; cy = my - c.offset; }
          else continue;
        }
        if (cx < 0 || cy < 0 || cx >= c.w || cy >= c.h) continue;
        const o = c.off + (cy * c.w + cx) * 2;
        return u8[o] | (u8[o + 1] << 8);
      }
    }
    return 0xffff;
  }

  /** Paletten (16 BG-Paletten) aus dem aktuellen Paletten-Puffer holen. */
  _loadPalettes() {
    const m = this.mem;
    const s = this.snap;
    const o = m.off(this.useUnfaded && s.plttU ? s.plttU : s.pltt);
    const u8 = m.u8;
    const p = this.pal32;
    for (let i = 0; i < 256; i++) p[i] = LUT[(u8[o + i * 2] | (u8[o + i * 2 + 1] << 8)) & 0x7fff];
    this._palLoaded = true;
    this.npcCache = new Map();
  }

  /** Rohwert der Kartentabelle (0xffff = außerhalb der Tabelle). */
  gridRaw(gx, gy) {
    const s = this.snap;
    if (gx < 0 || gy < 0 || gx >= s.gridW || gy >= s.gridH) return this.connRaw(gx, gy);
    const o = this._gridOff + (gx + s.gridW * gy) * 2;
    const v = this.mem.u8[o] | (this.mem.u8[o + 1] << 8);
    if (v !== 0x3ff) return v;
    const r = this.connRaw(gx, gy);
    return r === 0xffff ? v : r;
  }

  _metaOff(id) {
    if (id >= 1024) id = 0;
    return id < 512 ? this._priMeta + id * 16 : this._secMeta + (id - 512) * 16;
  }

  _attrOff(id) {
    if (id >= 1024) id = 0;
    return id < 512 ? this._priAttr + id * 2 : this._secAttr + (id - 512) * 2;
  }

  /** Bitmaske der Paletten (0-15), die die Metakachel zeichnet (inkl. der Füllkachel bei Ebenentyp 0). */
  metaPalMask(id) {
    const u8 = this.mem.u8;
    const o = this._metaOff(id);
    let mask = 0;
    for (let k = 0; k < 8; k++) mask |= 1 << (u8[o + k * 2 + 1] >> 4);
    const ao = this._attrOff(id);
    if ((((u8[ao] | (u8[ao + 1] << 8)) >> 12) & 15) === 0) mask |= 1 << 3;
    return mask;
  }

  /** Benutzt die Metakachel eine der als "geändert" markierten 8x8-Kacheln? */
  metaUsesDirty(id, dirty) {
    const u8 = this.mem.u8;
    const o = this._metaOff(id);
    for (let k = 0; k < 8; k++) if (dirty[(u8[o + k * 2] | (u8[o + k * 2 + 1] << 8)) & 0x3ff]) return true;
    return false;
  }

  /**
   * Zeichnet eine 16x16-Zelle in zwei Puffer (stride = Breite in Pixeln, Ursprung ox/oy):
   * lo = Hintergrund + Ebenen unter den Figuren (deckend), up = Ebene über den Figuren (Alpha 0 = leer).
   * Rückgabe: Metakachel-Nummer, oder -1 wenn die Zelle "leer" ist (schwarzer Rand außerhalb des Raums).
   */
  renderCell(cx, cy, lo, up, stride, ox, oy) {
    const m = this.mem;
    const u8 = m.u8;
    const vram = m.vram;
    const pal = this.pal32;
    const v = this.gridRaw(cx, cy);
    let id, border = false;
    if (v === 0x3ff || v === 0xffff) {
      border = true;
      id = this._borderId[((cx + 1) & 1) + (((cy + 1) & 1) << 1)];
    } else id = v & 0x3ff;
    if (border && this.voidBorder) {
      for (let y = 0; y < 16; y++) {
        const r = (oy + y) * stride + ox;
        for (let x = 0; x < 16; x++) { lo[r + x] = 0; up[r + x] = 0; }
      }
      return -1;
    }
    const meta = this._metaOff(id);
    const ao = this._attrOff(id);
    const layer = ((u8[ao] | (u8[ao + 1] << 8)) >> 12) & 15;
    const bd = pal[0];
    for (let y = 0; y < 16; y++) {
      const r = (oy + y) * stride + ox;
      for (let x = 0; x < 16; x++) { lo[r + x] = bd; up[r + x] = 0; }
    }
    const tile = (buf, entry, px, py) => {
      const base = vram + (entry & 0x3ff) * 32;
      const hf = (entry >> 10) & 1, vf = (entry >> 11) & 1;
      const pb = ((entry >> 12) & 15) * 16;
      for (let ty = 0; ty < 8; ty++) {
        const row = base + (vf ? 7 - ty : ty) * 4;
        const o = (oy + py + ty) * stride + ox + px;
        for (let tx = 0; tx < 8; tx++) {
          const sx = hf ? 7 - tx : tx;
          const b = u8[row + (sx >> 1)];
          const ci = sx & 1 ? b >> 4 : b & 15;
          if (ci !== 0) buf[o + tx] = pal[pb + ci];
        }
      }
    };
    const t = (k) => u8[meta + k * 2] | (u8[meta + k * 2 + 1] << 8);
    if (layer === 0) {
      tile(lo, 0x3014, 0, 0); tile(lo, 0x3014, 8, 0); tile(lo, 0x3014, 0, 8); tile(lo, 0x3014, 8, 8);
    }
    tile(lo, t(0), 0, 0); tile(lo, t(1), 8, 0); tile(lo, t(2), 0, 8); tile(lo, t(3), 8, 8);
    if (layer === 1) {
      tile(lo, t(4), 0, 0); tile(lo, t(5), 8, 0); tile(lo, t(6), 0, 8); tile(lo, t(7), 8, 8);
    } else {
      tile(up, t(4), 0, 0); tile(up, t(5), 8, 0); tile(up, t(6), 0, 8); tile(up, t(7), 8, 8);
    }
    // Innenräume: schwarze Pixel gelten als "leer" (der Raum ist kleiner als der Bildschirm);
    // dort zeigt die Bühne stattdessen den weichen Hintergrund
    if (this.voidBorder) {
      for (let y = 0; y < 16; y++) {
        const r = (oy + y) * stride + ox;
        for (let x = 0; x < 16; x++) {
          const c = up[r + x] >>> 24 ? up[r + x] : lo[r + x];
          if ((c & 255) + ((c >> 8) & 255) + ((c >> 16) & 255) <= 9) { lo[r + x] = 0; up[r + x] = 0; }
        }
      }
    }
    return id;
  }

  /** Sind die Randkacheln (außerhalb der Karte) schwarz? Dann sind sie "leer" (Innenräume). */
  computeVoid() {
    const lo = new Uint32Array(256), up = new Uint32Array(256);
    this.voidBorder = false;
    let dark = true;
    for (let k = 0; k < 4 && dark; k++) {
      // Zelle mit Randkachel k (x,y so wählen, dass die Parität stimmt): weit außerhalb der Tabelle
      const cx = -50 + ((k & 1) ^ 1), cy = -50 + ((k >> 1) ^ 1);
      this.renderCell(cx, cy, lo, up, 16, 0, 0);
      for (let i = 0; i < 256; i++) {
        const c = up[i] >>> 24 ? up[i] : lo[i];
        if ((c & 255) + ((c >> 8) & 255) + ((c >> 16) & 255) > 24) { dark = false; break; }
      }
    }
    this.voidBorder = dark;
    return dark;
  }

  /**
   * Bild einer Figur (aus der ROM): { w, h, px (RGBA), dx, dy } mit dx/dy relativ zur linken oberen Ecke
   * der Kachel, auf der sie steht. null, wenn nicht darstellbar.
   */
  npcImage(n) {
    const key = n.gfx + ':' + n.dir;
    let img = this.npcCache.get(key);
    if (img !== undefined) return img;
    img = this._buildNpcImage(n);
    this.npcCache.set(key, img);
    return img;
  }

  _buildNpcImage(n) {
    const m = this.mem;
    const s = this.snap;
    const u8 = m.u8;
    const info = m.r32(s.tblGfx + n.gfx * 4);
    if (!info || info >>> 24 !== 8) return null;
    const width = m.s16(info + 8), height = m.s16(info + 10);
    if (width <= 0 || height <= 0 || width > 64 || height > 64) return null;
    const tag = m.r16(info + 2);
    const anims = m.r32(info + 0x18);
    const images = m.r32(info + 0x1c);
    if (!anims || !images) return null;
    const inanimate = (m.r8(info + 12) >> 6) & 1;
    let animNum = !inanimate && n.dir >= 1 && n.dir <= 4 ? n.dir - 1 : 0;
    let animPtr = m.r32(anims + animNum * 4);
    if (!animPtr || animPtr >>> 24 !== 8) { animNum = 0; animPtr = m.r32(anims); }
    if (!animPtr || animPtr >>> 24 !== 8) return null;
    const want = (width * height) >> 1;
    let frame = m.s16(animPtr);
    let hflip = 0;
    if (frame < 0 || frame > 16) frame = 0;
    else hflip = (m.r8(animPtr + 2) >> 6) & 1;
    let data = m.r32(images + frame * 8);
    if (!data || data >>> 24 !== 8 || m.r32(images + frame * 8 + 4) !== want) {
      // Tabelle hat dieses Bild nicht (z. B. Fahrzeuge): erstes Bild nehmen
      hflip = 0;
      data = m.r32(images);
      if (!data || data >>> 24 !== 8) return null;
    }
    // Palette suchen
    let palPtr = 0;
    for (let i = 0; i < 48; i++) {
      const dptr = m.r32(s.tblPal + i * 8);
      const t = m.r16(s.tblPal + i * 8 + 4);
      if (t === 0x11ff && i > 0 && !dptr) break;
      if (t === tag && dptr) { palPtr = dptr; break; }
    }
    if (!palPtr) return null;
    const po = m.off(palPtr);
    const npal = new Uint32Array(16);
    for (let i = 0; i < 16; i++) npal[i] = LUT[(u8[po + i * 2] | (u8[po + i * 2 + 1] << 8)) & 0x7fff];
    const d = m.off(data);
    // Teil-Sprites (Subsprite-Tabelle): große Figuren sind in mehrere OAM-Stücke zerlegt
    let parts = null;
    const subTbl = m.r32(info + 0x14);
    if (subTbl && subTbl >>> 24 === 8) {
      const cnt = m.r8(subTbl);
      const sp = m.r32(subTbl + 4);
      if (cnt > 0 && cnt <= 16 && sp && sp >>> 24 === 8) {
        parts = [];
        for (let k = 0; k < cnt; k++) {
          const o = sp + k * 4;
          const bits = m.r16(o + 2);
          const dim = SPR_DIM[bits & 3][(bits >> 2) & 3];
          parts.push({ x: (m.r8(o) << 24 >> 24) + (width >> 1), y: (m.r8(o + 1) << 24 >> 24) + (height >> 1), w: dim[0], h: dim[1], t: (bits >> 4) & 0x3ff });
        }
      }
    }
    if (!parts) parts = [{ x: 0, y: 0, w: width, h: height, t: 0 }];
    const px = new Uint32Array(width * height);
    for (const pt of parts) {
      const ptw = pt.w >> 3;
      for (let ly = 0; ly < pt.h; ly++) {
        const oy = pt.y + ly;
        if (oy < 0 || oy >= height) continue;
        for (let lx = 0; lx < pt.w; lx++) {
          const lpx = pt.x + lx;
          const ox = hflip ? width - 1 - lpx : lpx;
          if (ox < 0 || ox >= width) continue;
          const tbase = d + (pt.t + (ly >> 3) * ptw + (lx >> 3)) * 32;
          const b = u8[tbase + (ly & 7) * 4 + ((lx & 7) >> 1)];
          const ci = lx & 1 ? b >> 4 : b & 15;
          if (ci !== 0) px[oy * width + ox] = npal[ci];
        }
      }
    }
    return { w: width, h: height, px, dx: 8 - (width >> 1), dy: 16 - height, canvas: null };
  }

  /**
   * Zeichnet den Kartenausschnitt [wx0, wx0+ow) x [wy0, wy0+oh) (Kartenpixel) in out (RGBA, ow*oh).
   * Zellen "außerhalb" bleiben durchsichtig (Alpha 0). Wird vor allem zum Prüfen/Testen benutzt.
   * opts.sprites: Figuren mitzeichnen (Standard: ja)
   */
  render(out, ow, oh, wx0, wy0, opts = {}) {
    const s = this.snap;
    const m = this.mem;
    if (!s || !s.valid || m.vram < 0 || m.rom < 0) return false;
    this.beginCells(true);
    out.fill(0);
    const cx0 = Math.floor(wx0 / 16), cx1 = Math.floor((wx0 + ow - 1) / 16);
    const cy0 = Math.floor(wy0 / 16), cy1 = Math.floor((wy0 + oh - 1) / 16);
    const lo = new Uint32Array(256), up = new Uint32Array(256);
    const ups = [];
    const blit = (buf, px, py, over) => {
      for (let y = 0; y < 16; y++) {
        const oy = py + y;
        if (oy < 0 || oy >= oh) continue;
        for (let x = 0; x < 16; x++) {
          const ox = px + x;
          if (ox < 0 || ox >= ow) continue;
          const c = buf[y * 16 + x];
          if (over ? c >>> 24 : true) out[oy * ow + ox] = c;
        }
      }
    };
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const r = this.renderCell(cx, cy, lo, up, 16, 0, 0);
        if (r < 0) continue;
        const px = cx * 16 - wx0, py = cy * 16 - wy0;
        blit(lo, px, py, false);
        ups.push({ px, py, buf: up.slice() });
      }
    }
    if (opts.sprites !== false) {
      for (const n of s.npcs) {
        const img = this.npcImage(n);
        if (!img) continue;
        const sx = n.x * 16 + img.dx - wx0, sy = n.y * 16 + img.dy - wy0;
        for (let y = 0; y < img.h; y++) {
          const oy = sy + y;
          if (oy < 0 || oy >= oh) continue;
          for (let x = 0; x < img.w; x++) {
            const ox = sx + x;
            if (ox < 0 || ox >= ow) continue;
            const c = img.px[y * img.w + x];
            if (c >>> 24) out[oy * ow + ox] = c;
          }
        }
      }
    }
    for (const u of ups) blit(u.buf, u.px, u.py, true);
    return true;
  }
}
