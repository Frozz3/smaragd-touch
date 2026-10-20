// Menüdaten aus dem Spiel (src/touch_menu.c) lesen und Namen, Beschreibungen und Bilder aus dem ROM holen.
//
// Das Spiel meldet, welcher Bildschirm aktiv ist (Beutel, Team, ...) und was darin steht. Namen, Texte und
// Grafiken liest diese Datei direkt aus dem ROM-Abbild im Emulator-Speicher - nur lesend.

import { decodeGameString } from './data.js';
import { lz77, LUT } from './world.js';

export const TM_VERSION = 2;
export const TM_SIZE = 2416;
const TM_MAGIC = 0x314d5445; // "ETM1"
const EWRAM_BASE = 0x02000000;

export const SCREEN = { NONE: 0, BAG: 1, PARTY: 2, SUMMARY: 3, TRAINER: 4, DEX: 5, SHOP: 6 };
export const BAG_SUB = { OTHER: 0, LIST: 1, CONTEXT: 2, QTY: 3, SWITCH: 4, SWAP: 5, WAIT: 6 };
export const PARTY_SUB = { OTHER: 0, LIST: 1, CONTEXT: 2 };
export const DEX_SUB = { OTHER: 0, LIST: 1, SCROLL: 2, INFO: 3 };
export const PAGE_SUB = { OTHER: 0, IDLE: 1, BACK: 2 };
export const SHOP_SUB = { OTHER: 0, HUB: 1, LIST: 2, MSG: 3, QTY: 4 };
export const ITEMMENU_SHOP = 3; // Beutel-Ort "PokéMart" (Verkaufen)

// Tabellen im ROM (Reihenfolge wie in touch_menu.c)
const T = {
  ITEMS: 0, ITEM_ICONS: 1, SPECIES_NAMES: 2, MOVE_NAMES: 3, BATTLE_MOVES: 4, MOVE_DESCS: 5, ABILITY_NAMES: 6,
  ABILITY_DESCS: 7, MON_ICONS: 8, MON_ICON_PAL_IDX: 9, MON_ICON_PALS: 10, MON_FRONT: 11, MON_PALS: 12,
  MON_SHINY_PALS: 13, SPECIES_INFO: 14, SPECIES_NATIONAL: 15, SPECIES_HOENN: 16, DEX_ENTRIES: 17, NATURE_NAMES: 18,
};
const D = {
  ITEM_STRIDE: 0, ITEM_PRICE_OFF: 1, ITEM_DESC_OFF: 2, ITEM_NAME_LEN: 3, SPECIES_NAME_STRIDE: 4, MOVE_NAME_STRIDE: 5,
  ABILITY_NAME_STRIDE: 6, BM_STRIDE: 7, BM_POWER_OFF: 8, BM_TYPE_OFF: 9, BM_ACC_OFF: 10, BM_PP_OFF: 11, SI_STRIDE: 12,
  SI_TYPES_OFF: 13, SI_ABILITIES_OFF: 14, ITEMS_COUNT: 15, NUM_SPECIES: 16, MOVES_COUNT: 17,
  DEX_STRIDE: 18, DEX_HEIGHT_OFF: 19, DEX_WEIGHT_OFF: 20, DEX_DESC_OFF: 21, DEX_CAT_LEN: 22, NATIONAL_COUNT: 23,
};

const OFF_LABELS = 32, OFF_TBL = 224, OFF_DIM = 320, OFF_PAYLOAD = 368;
const LABELS = 12, LABEL_LEN = 16, BAG_MAX = 66, BAG_NAME = 20, MSG_LEN = 192;

export class MenuReader {
  /** @param {import('./world.js').Mem} mem */
  constructor(mem) {
    this.mem = mem;
    this.buf = new Uint8Array(TM_SIZE);
    this.dv = new DataView(this.buf.buffer);
    this.last = null;
    this.lastFrame = -1;
    this.tblKey = '';
    this.tbl = null;
    this.dim = null;
  }

  /** Liest die Struktur (Seqlock). menuAddr: GBA-Adresse, ewram muss in mem bekannt sein. */
  read(menuAddr) {
    const m = this.mem;
    if (!menuAddr || (menuAddr >>> 24) !== 2 || m.ewram < 0 || !m.refresh()) return null;
    const o = m.ewram + (menuAddr & 0x3ffff);
    if (o + TM_SIZE > m.u8.length) return null;
    const src = m.u8.subarray(o, o + TM_SIZE);
    const b = this.buf;
    for (let attempt = 0; attempt < 4; attempt++) {
      const s1 = src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24);
      if (s1 & 1) continue;
      b.set(src);
      const s2 = src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24);
      if (s1 !== s2) continue;
      return this._parse();
    }
    return this.last;
  }

  _parse() {
    const dv = this.dv, b = this.buf;
    if (dv.getUint32(4, true) !== TM_MAGIC || dv.getUint16(8, true) !== TM_VERSION || dv.getUint16(10, true) !== TM_SIZE) {
      this.last = null;
      return null;
    }
    const frame = dv.getUint32(12, true);
    if (frame === this.lastFrame && this.last) return this.last;
    this.lastFrame = frame;

    // Tabellen ändern sich nie - nur beim ersten Mal lesen
    if (!this.tbl) {
      this.tbl = [];
      for (let i = 0; i < 24; i++) this.tbl.push(dv.getUint32(OFF_TBL + i * 4, true));
      this.dim = [];
      for (let i = 0; i < 24; i++) this.dim.push(dv.getUint16(OFF_DIM + i * 2, true));
    }

    const screen = b[16];
    const out = {
      frame, screen, sub: b[17],
      labelCount: b[18], labelWin: b[19],
      labelFrame: dv.getUint32(20, true),
      payloadFrame: dv.getUint32(24, true),
      labels: null, bag: null, party: null, dex: null, summary: null, trainer: null, shop: null,
    };
    if (out.labelCount > 0) {
      out.labels = [];
      for (let i = 0; i < Math.min(LABELS, out.labelCount); i++) {
        out.labels.push(decodeGameString(b.subarray(OFF_LABELS + i * LABEL_LEN, OFF_LABELS + (i + 1) * LABEL_LEN)));
      }
    }
    if (screen === SCREEN.BAG) out.bag = this._parseBag(OFF_PAYLOAD, out.sub);
    else if (screen === SCREEN.PARTY) out.party = this._parseParty(OFF_PAYLOAD, out.sub);
    else if (screen === SCREEN.DEX) out.dex = this._parseDex(OFF_PAYLOAD, out.sub);
    else if (screen === SCREEN.SUMMARY) out.summary = this._parseSummary(OFF_PAYLOAD, out.sub);
    else if (screen === SCREEN.TRAINER) out.trainer = this._parseTrainer(OFF_PAYLOAD, out.sub);
    else if (screen === SCREEN.SHOP) out.shop = this._parseShop(OFF_PAYLOAD, out.sub);
    this.last = out;
    return out;
  }


  _parseShop(p, sub) {
    const dv = this.dv, b = this.buf;
    const u16 = (o) => dv.getUint16(p + o, true);
    const n = Math.min(40, b[p + 2]);
    const sh = {
      sub, martType: b[p + 1], count: n, sel: u16(4), qtyCur: u16(6), qtyMax: u16(8), item: u16(10),
      money: dv.getUint32(p + 12, true), items: [], msg: decodeGameString(b.subarray(p + 256, p + 256 + 114)),
    };
    for (let i = 0; i < n; i++) sh.items.push({ id: u16(16 + i * 2), price: u16(96 + i * 2), owned: u16(176 + i * 2) });
    return sh;
  }

  _parseSummary(p, sub) {
    const dv = this.dv, b = this.buf;
    const u16 = (o) => dv.getUint16(p + o, true);
    return {
      sub, page: b[p + 1], mode: b[p + 2], curMon: b[p + 3], maxMon: b[p + 4], isEgg: !!b[p + 5], level: b[p + 6], ailment: b[p + 7],
      species: u16(8), item: u16(10), hp: u16(12), maxHp: u16(14),
      stat: [u16(16), u16(18), u16(20), u16(22), u16(24)],
      exp: dv.getUint32(p + 28, true), expNext: dv.getUint32(p + 32, true),
      moves: [u16(36), u16(38), u16(40), u16(42)],
      pp: [b[p + 44], b[p + 45], b[p + 46], b[p + 47]], ppMax: [b[p + 48], b[p + 49], b[p + 50], b[p + 51]],
      ability: b[p + 52], nature: b[p + 53], gender: b[p + 54], friendship: b[p + 55], otGender: b[p + 56], metLevel: b[p + 57],
      ribbons: b[p + 58], shiny: !!b[p + 59], otId: u16(60),
      nick: decodeGameString(b.subarray(p + 64, p + 76)), ot: decodeGameString(b.subarray(p + 76, p + 86)),
    };
  }

  _parseTrainer(p, sub) {
    const dv = this.dv, b = this.buf;
    const u16 = (o) => dv.getUint16(p + o, true);
    return {
      sub, gender: b[p + 1], stars: b[p + 2], hasDex: !!b[p + 3], badges: b[p + 4], hasHof: !!b[p + 5], hasLink: !!b[p + 6],
      hasTrades: !!b[p + 7], hasBt: !!b[p + 8], isHoenn: !!b[p + 9],
      dex: u16(12), id: u16(14), hours: u16(16), minutes: u16(18), hofH: u16(20), hofM: u16(22), hofS: u16(24), trades: u16(26),
      linkWins: u16(28), linkLosses: u16(30), btWins: u16(32), btStraight: u16(34), contests: u16(36), blocks: u16(38),
      money: dv.getUint32(p + 40, true), name: decodeGameString(b.subarray(p + 44, p + 54)),
    };
  }

  _parseDex(p, sub) {
    const dv = this.dv;
    const d = {
      sub, mode: this.buf[p + 1], order: this.buf[p + 2], selScreen: this.buf[p + 3],
      count: Math.min(dv.getUint16(p + 4, true), 386), sel: dv.getUint16(p + 6, true),
      seen: dv.getUint16(p + 8, true), own: dv.getUint16(p + 10, true),
      infoDex: dv.getUint16(p + 12, true), infoSeen: !!(this.buf[p + 14] & 1), infoOwned: !!(this.buf[p + 14] & 2),
      search: !!this.buf[p + 15], list: [],
    };
    for (let i = 0; i < d.count; i++) {
      const v = dv.getUint16(p + 16 + i * 2, true);
      d.list.push({ dex: v & 0x3fff, seen: !!(v & 0x4000), owned: !!(v & 0x8000) });
    }
    return d;
  }

  _parseParty(p, sub) {
    const dv = this.dv, b = this.buf;
    const party = {
      menuType: b[p], action: b[p + 1], cursor: dv.getInt8(p + 2), count: b[p + 3], chooseHalf: !!b[p + 4],
      slot2: dv.getInt8(p + 5), msgOpen: !!b[p + 6], mons: [],
      prompt: decodeGameString(b.subarray(p + 152, p + 152 + 60)),
      msg: decodeGameString(b.subarray(p + 212, p + 212 + MSG_LEN)),
      ctx: null, sub,
    };
    for (let i = 0; i < 6; i++) {
      const o = p + 8 + i * 24;
      const species = dv.getUint16(o, true);
      if (!species) { party.mons.push(null); continue; }
      party.mons.push({
        species, hp: dv.getUint16(o + 2, true), maxHp: dv.getUint16(o + 4, true), level: b[o + 6], status: b[o + 7],
        item: dv.getUint16(o + 8, true), gender: b[o + 10], egg: !!(b[o + 11] & 1),
        name: decodeGameString(b.subarray(o + 12, o + 24)),
      });
    }
    const n = Math.min(8, b[p + 404]);
    if (sub === PARTY_SUB.CONTEXT && n > 0) {
      party.ctx = [];
      for (let i = 0; i < n; i++) party.ctx.push(decodeGameString(b.subarray(p + 405 + i * 16, p + 405 + (i + 1) * 16)));
    }
    return party;
  }

  _parseBag(p, sub) {
    const dv = this.dv, b = this.buf;
    const bag = {
      pocket: b[p], location: b[p + 1], count: b[p + 2], hasCancel: !!b[p + 3],
      sel: dv.getInt16(p + 4, true), registered: dv.getUint16(p + 6, true),
      qtyCur: dv.getUint16(p + 8, true), qtyMax: dv.getUint16(p + 10, true),
      items: [], valid: sub === BAG_SUB.LIST || sub === BAG_SUB.CONTEXT || sub === BAG_SUB.QTY,
      qtyKind: b[p + 1728], msgOpen: !!b[p + 1729], msg: '', ctx: null, money: dv.getUint32(p + 2020, true),
    };
    const ctxN = Math.min(6, b[p + 1922]);
    if (sub === BAG_SUB.CONTEXT && ctxN > 0) {
      bag.ctx = [];
      for (let i = 0; i < ctxN; i++) bag.ctx.push(decodeGameString(b.subarray(p + 1923 + i * 16, p + 1923 + (i + 1) * 16)));
    }
    bag.msg = decodeGameString(b.subarray(p + 1730, p + 1730 + MSG_LEN));
    if (!bag.valid) return bag;
    const n = Math.min(BAG_MAX, bag.count);
    for (let i = 0; i < n; i++) {
      bag.items.push({
        id: dv.getUint16(p + 12 + i * 2, true),
        qty: dv.getUint16(p + 144 + i * 2, true),
        move: dv.getUint16(p + 276 + i * 2, true),
        name: decodeGameString(b.subarray(p + 408 + i * BAG_NAME, p + 408 + (i + 1) * BAG_NAME)),
        cancel: bag.hasCancel && i === n - 1,
      });
    }
    return bag;
  }
}

// ---------------------------------------------------------------------------

/** 4bpp-Kacheln (Zeile für Zeile angeordnet) -> Canvas. pal: Uint32Array(16) RGBA, Index 0 = durchsichtig */
function tilesToCanvas(bytes, off, tilesW, tilesH, pal) {
  const w = tilesW * 8, h = tilesH * 8;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  for (let ty = 0; ty < tilesH; ty++) {
    for (let tx = 0; tx < tilesW; tx++) {
      const t = (ty * tilesW + tx) * 32 + off;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x += 2) {
          const v = bytes[t + y * 4 + (x >> 1)];
          const lo = v & 15, hi = v >> 4;
          const o = (ty * 8 + y) * w + tx * 8 + x;
          px[o] = lo ? pal[lo] : 0;
          px[o + 1] = hi ? pal[hi] : 0;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function palFromBytes(bytes, off) {
  const pal = new Uint32Array(16);
  for (let i = 0; i < 16; i++) pal[i] = LUT[(bytes[off + i * 2] | (bytes[off + i * 2 + 1] << 8)) & 0x7fff];
  return pal;
}

export class GameData {
  /** @param {import('./world.js').Mem} mem */
  constructor(mem) {
    this.mem = mem;
    this.t = null;
    this.d = null;
    this.c = new Map();
  }

  setTables(tbl, dim) {
    const key = tbl.join(',') + '|' + dim.join(',');
    if (key === this.key) return;
    this.key = key;
    this.t = tbl;
    this.d = dim;
    this.c.clear();
  }

  get ready() { return !!this.t && this.mem.rom >= 0; }

  _memo(key, fn) {
    if (this.c.has(key)) return this.c.get(key);
    if (!this.ready) return null;
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v !== null && v !== undefined) this.c.set(key, v);
    return v;
  }

  /** Text im ROM (ab Adresse) lesen */
  str(addr, max = 200, opt) {
    const m = this.mem;
    if (!addr || !m.refresh()) return '';
    const o = m.off(addr);
    let n = 0;
    while (n < max && m.u8[o + n] !== 0xff) n++;
    return decodeGameString(m.u8.subarray(o, o + n + 1), opt);
  }

  /** Tabellen-Eintrag: Text fester Länge */
  _fixed(base, stride, idx, max) {
    const m = this.mem;
    const o = m.off(base + idx * stride);
    let n = 0;
    while (n < max && m.u8[o + n] !== 0xff) n++;
    return decodeGameString(m.u8.subarray(o, o + n + 1));
  }

  itemName(id) {
    return this._memo('in' + id, () => this._fixed(this.t[T.ITEMS], this.d[D.ITEM_STRIDE], id, this.d[D.ITEM_NAME_LEN]));
  }
  itemDesc(id) {
    return this._memo('id' + id, () => this.str(this.mem.r32(this.t[T.ITEMS] + id * this.d[D.ITEM_STRIDE] + this.d[D.ITEM_DESC_OFF])));
  }
  itemPrice(id) {
    return this._memo('ip' + id, () => this.mem.r16(this.t[T.ITEMS] + id * this.d[D.ITEM_STRIDE] + this.d[D.ITEM_PRICE_OFF]));
  }

  moveName(id) {
    return this._memo('mn' + id, () => this._fixed(this.t[T.MOVE_NAMES], this.d[D.MOVE_NAME_STRIDE], id, this.d[D.MOVE_NAME_STRIDE] - 1));
  }
  moveDesc(id) {
    return this._memo('md' + id, () => this.str(this.mem.r32(this.t[T.MOVE_DESCS] + (id - 1) * 4)));
  }
  /** {type, power, acc, pp} */
  moveInfo(id) {
    return this._memo('mi' + id, () => {
      const base = this.t[T.BATTLE_MOVES] + id * this.d[D.BM_STRIDE];
      const m = this.mem;
      return { type: m.r8(base + this.d[D.BM_TYPE_OFF]), power: m.r8(base + this.d[D.BM_POWER_OFF]), acc: m.r8(base + this.d[D.BM_ACC_OFF]), pp: m.r8(base + this.d[D.BM_PP_OFF]) };
    });
  }

  speciesName(id) {
    return this._memo('sn' + id, () => this._fixed(this.t[T.SPECIES_NAMES], this.d[D.SPECIES_NAME_STRIDE], id, this.d[D.SPECIES_NAME_STRIDE] - 1));
  }

  abilityName(id) {
    return this._memo('an' + id, () => this._fixed(this.t[T.ABILITY_NAMES], this.d[D.ABILITY_NAME_STRIDE], id, this.d[D.ABILITY_NAME_STRIDE] - 1));
  }
  abilityDesc(id) {
    return this._memo('ad' + id, () => this.str(this.mem.r32(this.t[T.ABILITY_DESCS] + id * 4)));
  }
  natureName(id) {
    return this._memo('nn' + id, () => this.str(this.mem.r32(this.t[T.NATURE_NAMES] + id * 4), 20));
  }

  /** Art zu einer nationalen Pokédex-Nummer (0 = unbekannt) */
  dexSpecies(dex) {
    if (!this.ready || !dex) return 0;
    if (!this.natMap) {
      const m = this.mem;
      if (!m.refresh()) return 0;
      const n = this.d[D.NUM_SPECIES];
      const map = new Map();
      for (let sp = 1; sp < n; sp++) {
        const nat = m.r16(this.t[T.SPECIES_NATIONAL] + (sp - 1) * 2);
        if (nat && !map.has(nat)) map.set(nat, sp);
      }
      if (map.size < 100) return 0; // ROM noch nicht lesbar
      this.natMap = map;
    }
    return this.natMap.get(dex) || 0;
  }

  /** Nummer im Hoenn-Pokédex (0 = keine) */
  hoennNum(species) {
    return this._memo('hn' + species, () => this.mem.r16(this.t[T.SPECIES_HOENN] + (species - 1) * 2));
  }

  /** {category, height (dm), weight (hg), desc} eines Pokédex-Eintrags */
  dexEntry(dex) {
    return this._memo('de' + dex, () => {
      const base = this.t[T.DEX_ENTRIES] + dex * this.d[D.DEX_STRIDE];
      const m = this.mem;
      if (!m.refresh()) return null;
      return {
        category: this._fixed(base, 1, 0, this.d[D.DEX_CAT_LEN]),
        height: m.r16(base + this.d[D.DEX_HEIGHT_OFF]),
        weight: m.r16(base + this.d[D.DEX_WEIGHT_OFF]),
        desc: this.str(m.r32(base + this.d[D.DEX_DESC_OFF]), 600),
      };
    });
  }

  /** [Typ1, Typ2] einer Art */
  speciesTypes(species) {
    return this._memo('st' + species, () => {
      const base = this.t[T.SPECIES_INFO] + species * this.d[D.SI_STRIDE] + this.d[D.SI_TYPES_OFF];
      return [this.mem.r8(base), this.mem.r8(base + 1)];
    });
  }

  /** Vorderansicht (64x64) einer Art als Bild-Adresse oder null */
  monFront(species) {
    return this._memo('mf' + species, () => {
      const m = this.mem;
      if (!m.refresh() || !species) return null;
      const imgPtr = m.r32(this.t[T.MON_FRONT] + species * 8);
      const palPtr = m.r32(this.t[T.MON_PALS] + species * 8);
      if (!imgPtr || !palPtr) return null;
      const tiles = lz77(m.u8, m.off(imgPtr));
      const pal = lz77(m.u8, m.off(palPtr));
      return tilesToCanvas(tiles, 0, 8, 8, palFromBytes(pal, 0)).toDataURL();
    });
  }

  /** Item-Symbol (24x24) als Bild-Adresse (data:-URL) oder null */
  itemIcon(id) {
    return this._memo('ii' + id, () => {
      const m = this.mem;
      if (!m.refresh()) return null;
      const entry = this.t[T.ITEM_ICONS] + id * 8;
      const tilesPtr = m.r32(entry), palPtr = m.r32(entry + 4);
      if (!tilesPtr || !palPtr) return null;
      const tiles = lz77(m.u8, m.off(tilesPtr));
      const pal = lz77(m.u8, m.off(palPtr));
      return tilesToCanvas(tiles, 0, 3, 3, palFromBytes(pal, 0)).toDataURL();
    });
  }

  /** Pokémon-Symbol (32x32, erstes Bild) als Bild-Adresse oder null */
  monIcon(species) {
    return this._memo('mc' + species, () => {
      const m = this.mem;
      if (!m.refresh() || !species) return null;
      const imgPtr = m.r32(this.t[T.MON_ICONS] + species * 4);
      const palIdx = m.r8(this.t[T.MON_ICON_PAL_IDX] + species);
      const palPtr = m.r32(this.t[T.MON_ICON_PALS] + palIdx * 8);
      if (!imgPtr || !palPtr) return null;
      return tilesToCanvas(m.u8, m.off(imgPtr), 4, 4, palFromBytes(m.u8, m.off(palPtr))).toDataURL();
    });
  }
}
