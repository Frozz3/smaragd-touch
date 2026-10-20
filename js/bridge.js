// Liest die "TouchBridge"-Struktur direkt aus dem Speicher des Emulators.
// Das Gegenstück im Spiel ist src/touch_bridge.c (Format muss zusammenpassen).

import { decodeGameString } from './data.js';

export const TB_VERSION = 3;
export const TB_SIZE = 160;

export const UI = { NONE: 0, MENU: 1, BATTLE_ACTION: 2, BATTLE_MOVE: 3, PARTY: 4, KEYBOARD: 5, OPTIONS: 6 };
export const FLAG = {
  FIELD_FREE: 1 << 0,
  WRAP: 1 << 1,
  OUTSIDE_B: 1 << 2,
  START_MENU: 1 << 3,
  IN_BATTLE: 1 << 4,
  OVERWORLD: 1 << 5,
  BATTLE_MAIN: 1 << 6,
  FADING: 1 << 7,
};
export const XTYPE = { NONE: 0, BATTLE: 1, BATTLE_MOVE: 2, NAMING: 3 };

// Aktionsnummern im Startmenü (Reihenfolge wie in src/start_menu.c)
export const START_ACTION = {
  POKEDEX: 0,
  POKEMON: 1,
  BAG: 2,
  POKENAV: 3,
  PLAYER: 4,
  SAVE: 5,
  OPTION: 6,
  EXIT: 7,
  RETIRE_SAFARI: 8,
  PLAYER_LINK: 9,
  REST_FRONTIER: 10,
  RETIRE_FRONTIER: 11,
  PYRAMID_BAG: 12,
};

export class Bridge {
  /** @param {() => WebAssembly.Memory | null} getMemory */
  constructor(getMemory) {
    this.getMemory = getMemory;
    this.base = -1; // Byte-Adresse der Struktur im Emulator-Heap
    this.lastScan = 0;
    this.buf = new Uint8Array(TB_SIZE);
    this.last = null;
  }

  /** Sucht die Struktur im Heap (einmal nach dem Laden der ROM nötig). */
  find() {
    const mem = this.getMemory();
    if (!mem) return false;
    const w = new Uint32Array(mem.buffer);
    const cands = [];
    this.oldVersion = false;
    let i = 0;
    // Das Magic "ETB1" liegt bei Offset 4 der (4-Byte-ausgerichteten) Struktur
    while ((i = w.indexOf(0x31425445, i)) >= 0) {
      const pos = i * 4;
      const heap = new Uint8Array(mem.buffer, pos, 8);
      if (heap[4] === TB_VERSION && heap[5] === 0 && heap[6] === (TB_SIZE & 255) && heap[7] === TB_SIZE >> 8) {
        cands.push(pos - 4);
      } else if ((heap[4] === 1 || heap[4] === 2) && heap[5] === 0) {
        this.oldVersion = true; // ROM mit alter Schnittstelle
      }
      i++;
    }
    this.lastScan = performance.now();
    this.cands = cands;
    if (cands.length === 0) return false;
    this.base = cands[0];
    if (cands.length === 1) return true;
    // Es gibt Kopien (z. B. im Rewind-Puffer des Emulators). Die echte Struktur
    // erkennt man daran, dass ihr Frame-Zähler läuft.
    this.pending = cands.map((c) => ({ base: c, frame: this._frameAt(c) }));
    return true;
  }

  _frameAt(base) {
    const mem = this.getMemory();
    const dv = new DataView(mem.buffer, base, TB_SIZE);
    return dv.getUint32(12, true);
  }

  /** Nach find(): wählt unter mehreren Treffern den mit laufendem Frame-Zähler. */
  resolve() {
    if (!this.pending) return this.base >= 0;
    let best = null;
    for (const p of this.pending) {
      const now = this._frameAt(p.base);
      const d = (now - p.frame) >>> 0;
      if (d > 0 && d < 100000 && (!best || d > best.d)) best = { base: p.base, d };
    }
    if (best) {
      this.base = best.base;
      this.pending = null;
      return true;
    }
    return false;
  }

  isValid() {
    if (this.base < 0) return false;
    const mem = this.getMemory();
    if (!mem) return false;
    const h = new Uint8Array(mem.buffer, this.base + 4, 4);
    return h[0] === 0x45 && h[1] === 0x54 && h[2] === 0x42 && h[3] === 0x31;
  }

  /** Liefert einen konsistenten Schnappschuss oder null. */
  read() {
    const mem = this.getMemory();
    if (!mem || this.base < 0) return null;
    const src = new Uint8Array(mem.buffer, this.base, TB_SIZE);
    const dv = new DataView(this.buf.buffer);
    for (let attempt = 0; attempt < 4; attempt++) {
      const s1 = src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24);
      if (s1 & 1) continue; // gerade beim Schreiben
      this.buf.set(src);
      const s2 = src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24);
      if (s1 !== s2) continue;
      if (dv.getUint32(4, true) !== 0x31425445) return null;
      const snap = {
        frame: dv.getUint32(12, true),
        ui: this.buf[16],
        count: this.buf[17],
        cursor: this.buf[18],
        cols: this.buf[19] || 1,
        flags: this.buf[20],
        startCount: this.buf[21],
        startActions: Array.from(this.buf.subarray(22, 22 + Math.min(10, this.buf[21]))),
        rects: [],
      };
      for (let i = 0; i < Math.min(12, snap.count); i++) {
        const o = 34 + i * 4;
        snap.rects.push({ x: this.buf[o], y: this.buf[o + 1], w: this.buf[o + 2], h: this.buf[o + 3] });
      }
      const xtype = this.buf[84];
      snap.xtype = xtype;
      snap.kb = null;
      snap.opt = null;
      snap.info = null;
      snap.name = null; // Namenseingabe (schon während des Ladens gemeldet, auch wenn die Tastatur noch nichts annimmt)
      if (xtype === XTYPE.NAMING) {
        const chars = [];
        for (let i = 0; i < 16 && this.buf[88 + i] !== 0xff; i++) chars.push(this.buf[88 + i]);
        snap.name = { tpl: this.buf[104], gender: this.buf[105], max: this.buf[85] || 10, species: dv.getUint16(86, true), chars };
      }
      if (snap.ui === UI.KEYBOARD) {
        snap.kb = {
          columns: snap.count,
          cx: snap.cursor,
          cy: this.buf[19],
          page: this.buf[124],
          colX: Array.from(this.buf.subarray(108, 108 + Math.min(12, snap.count))),
        };
        snap.cols = 1;
        snap.rects = [];
      } else if (snap.ui === UI.OPTIONS) {
        snap.opt = { values: Array.from(this.buf.subarray(108, 114)) };
      } else if (xtype === XTYPE.BATTLE || xtype === XTYPE.BATTLE_MOVE) {
        const info = {
          level: this.buf[85],
          species: dv.getUint16(86, true),
          hp: dv.getUint16(120, true),
          maxHp: dv.getUint16(122, true),
          name: decodeGameString(this.buf.subarray(108, 119)),
          moves: [], pp: [], maxPp: [], types: [],
        };
        if (xtype === XTYPE.BATTLE_MOVE) {
          for (let i = 0; i < 4; i++) {
            info.moves.push(dv.getUint16(88 + i * 2, true));
            info.pp.push(this.buf[96 + i]);
            info.maxPp.push(this.buf[100 + i]);
            info.types.push(this.buf[104 + i]);
          }
        }
        snap.info = info;
      }
      snap.selfAddr = dv.getUint32(128, true);
      snap.worldAddr = dv.getUint32(132, true);
      snap.menuAddr = dv.getUint32(136, true);
      snap.inBattle = !!(snap.flags & FLAG.IN_BATTLE);
      snap.fieldFree = !!(snap.flags & FLAG.FIELD_FREE);
      snap.wrap = !!(snap.flags & FLAG.WRAP);
      snap.outsideB = !!(snap.flags & FLAG.OUTSIDE_B);
      snap.startMenu = !!(snap.flags & FLAG.START_MENU);
      snap.fading = !!(snap.flags & FLAG.FADING);
      this.last = snap;
      return snap;
    }
    return this.last;
  }
}
