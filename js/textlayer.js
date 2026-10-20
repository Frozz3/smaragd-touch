// Textebene: Die Textfenster der Oberwelt (Dialoge, Ja/Nein, Geldfenster ...) liegen im Spiel auf der Bildebene BG0.
// Auf dem Hochkant-Handy sitzt das Spielbild mitten auf dem Bildschirm, ein Dialog stünde also mitten im Bild.
// Deshalb zeichnet das Spiel BG0 nicht mehr selbst (die App schaltet das über ein Steuerbyte ein), sondern die App liest
// die Bildebene aus dem Grafikspeicher und legt
//   - den Dialog (breites Fenster ganz unten) als Karte im Stil der Oberfläche an den unteren Bildschirmrand,
//   - alle anderen Fenster (Geld, Spielerinfo ...) als gleich gestaltete Karten an ihrer Originalstelle über das Spielbild.
// Gezeichnet wird nur der Inhalt der Fenster (Text); Rahmen und Hintergrund des Spiels ersetzt die Karte (CSS .gba-win).
// Der Kartenname („ROUTE 101“) kommt als eigenes Banner.
//
// Hört die App auf, den Herzschlag zu senden (Tab im Hintergrund, Querformat ...), zeichnet das Spiel wieder alles selbst.

import { LUT } from './world.js';
import { decodeGameString } from './data.js';

const GBA_W = 240;
const GBA_H = 160;
const C_HIDE_BG0 = 1;
const C_OWN_POPUP = 2;
const C_BATTLE_OWN = 4;
const XPAD0 = 125; // Steuerbyte (Offset in der TouchBridge)
const XPAD1 = 126; // Herzschlag
const VRAM_WORDS = 8192; // 32 KB: Kacheln und Karte der Textebene

export class TextLayer {
  /**
   * @param {{world, input, stage, root: HTMLElement, frameCv: HTMLCanvasElement, cards: HTMLElement, banner: HTMLElement,
   *          ctx: {sheetOn: () => boolean, sheetKind: () => string, mode: () => string}}} o
   */
  constructor(o) {
    this.world = o.world;
    this.input = o.input;
    this.stage = o.stage;
    this.root = o.root;
    this.frameCv = o.frameCv;
    this.box = o.cards;
    this.banner = o.banner;
    this.ext = o.ctx;
    this.enabled = true;
    this.fctx = this.frameCv.getContext('2d');
    this.cards = []; // Karten (Dialog + weitere Fenster)

    this.beat = 0;
    this.ctl = 0;
    this.ready = false;
    this.hidSince = -1;
    this.probeAt = -1000;
    this.menuMode = false;
    this.dockOn = false;
    this.drawOn = false;
    this.popSerial = -1;
    this.bannerTimer = 0;
    this.battleOn = false; // von der Kampfansicht gesetzt: das Spiel soll im Kampf nur Sprites auf Magenta zeichnen

    // Zwischenspeicher der Bildebene (256 x 256, Karte der Textebene)
    this.bgCv = document.createElement('canvas');
    this.bgCv.width = 256;
    this.bgCv.height = 512;
    this.bgCtx = this.bgCv.getContext('2d');
    this.bgImg = new ImageData(256, 512);
    this.bg32 = new Uint32Array(this.bgImg.data.buffer);
    this.occ = new Uint8Array(2048); // Kachel enthält sichtbare Pixel
    this.pidx = new Uint8Array(256 * 512); // Palettenplatz je Pixel (Palette * 16 + Farbe), 0 = durchsichtig
    this.rows = 32; // Höhe der Textebene in Kacheln (Oberwelt 32, Kampf 64)
    this.battleMode = false;
    this.pal = new Uint32Array(256);
    this.vsn = new Uint32Array(VRAM_WORDS);
    this.csnB = new Uint32Array(4096); // Kampf: Kacheln (16 KB) ...
    this.msnB = new Uint32Array(1024); // ... und Karte (32 x 64)
    this.psn = new Uint32Array(128);
    this.regKey = '';
    this.vramOk = false;
    this.dirty = true;
    this.ver = 0;
    this.frameKey = '';
    this.frameAny = false;

    // Zwischenstufen für die Ausgabe
    this.fSrc = document.createElement('canvas'); // Fenster im Spielbild (240 x 160, mit Scroll)
    this.fSrc.width = GBA_W;
    this.fSrc.height = GBA_H;
    this.fSrcCtx = this.fSrc.getContext('2d');
    this.fImg = new ImageData(GBA_W, GBA_H);
    this.f32 = new Uint32Array(this.fImg.data.buffer);
    this.wTmp = document.createElement('canvas'); // Fensterinhalt (Originalgröße)
    this.wTmpCtx = this.wTmp.getContext('2d');

    this.dock = null; // Dialogfenster { x, y, w, h } in Kacheln, oder null
    this.lastShown = { frame: false };
    this.sheetH = 0;
    this.sheetTick = 0;
    this.dpr = 1;
  }

  setEnabled(on) {
    this.enabled = !!on;
  }

  // ---------- Steuerbyte ----------
  _write(ctl, beat) {
    const br = this.input.bridge;
    const mem = br.getMemory();
    if (!mem || br.base < 0) return;
    const u8 = new Uint8Array(mem.buffer);
    u8[br.base + XPAD0] = ctl;
    u8[br.base + XPAD1] = beat;
    this.input.beatFrame = this.input.frame;
  }

  /** Pro Bild aufrufen (nach stage.update). */
  update(view) {
    const w = this.world;
    const inp = this.input;
    const bridgeOk = inp.hasBridge && inp.bridge.base >= 0;
    let want = this.enabled && view.portrait && bridgeOk;
    let s = null;
    if (want) {
      // Die Weltdaten liest normalerweise die Bühne; ist sie aus, lesen wir selbst
      if (!this.stage.enabled || !w.snap) {
        const snap = inp.snap;
        if (snap && snap.selfAddr && snap.worldAddr) {
          w.attach(inp.bridge.base, snap.selfAddr, snap.worldAddr);
          w.read();
        }
      }
      s = w.snap;
      if (!s) want = false;
    }
    const menuScreen = want && s.screen === 1; // Hauptmenü / Einführung: Textfenster ohne Oberwelt
    if (want && s.valid && w.mem.vram < 0 && !this.stage.active) {
      // Grafikspeicher noch nicht gefunden (Bühne aus): selbst suchen
      if (w.mem.rom < 0 || w.mem.vram < 0) w.prepare();
    } else if (menuScreen && w.mem.vram < 0 && !s.valid) {
      // Noch keine Oberwelt gesehen: die Marke des Spiels im Grafikspeicher suchen (höchstens alle 20 Bilder)
      if (s.frame - this.probeAt >= 20 || s.frame < this.probeAt) { this.probeAt = s.frame; w.mem.findVramProbe(); }
    }
    const vramOk = want && w.mem.vram >= 0 && (w.mem.vram & 3) === 0;
    this.vramOk = vramOk;
    const inB = !!inp.snap && inp.snap.inBattle;
    const bt = s && s.battle;
    // Im Kampf zeichnet das Spiel nur noch Sprites; Textfenster (Meldungen) kommen aus der Textebene des Kampfs
    const battleMode = vramOk && !!s && inB && !!bt && bt.active && this.battleOn;
    this.battleMode = battleMode;
    this.menuMode = menuScreen && !inB;
    const canDraw = vramOk && !!s && ((s.valid && !inB) || battleMode || (menuScreen && !inB));
    // Steuerbyte: nur wenn wir wirklich zeichnen können (sonst bleibt alles wie im Original)
    const ctl = vramOk ? C_HIDE_BG0 | C_OWN_POPUP | (this.battleOn ? C_BATTLE_OWN : 0) : 0;
    this.beat = (this.beat + 1) & 255;
    this._write(ctl, this.beat);
    this.ctl = ctl;

    if (!canDraw) {
      this.hidSince = -1;
      this._hideAll();
      return;
    }
    // Erst zeichnen, wenn das Spiel die Textebene wirklich ausgeblendet hat (und das Bild nachgezogen ist)
    if (!battleMode && !s.bg0Hidden) {
      this.hidSince = -1;
      this._hideAll();
      return;
    }
    if (this.hidSince < 0) this.hidSince = s.frame;
    this._banner(s);
    if (s.frame - this.hidSince < 4) {
      this._hideAll();
      return;
    }
    this._refresh(s, view);
  }

  // ---------- Kartenname ----------
  _banner(s) {
    if (this.popSerial < 0) {
      this.popSerial = s.popupSerial;
      return;
    }
    if (s.popupSerial === this.popSerial) return;
    this.popSerial = s.popupSerial;
    const name = decodeGameString(s.popupName);
    if (!name) return;
    const b = this.banner;
    b.dataset.theme = String(s.popupTheme);
    b.querySelector('b').textContent = name;
    b.classList.remove('on');
    void b.offsetWidth; // Animation neu starten
    b.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.remove('on'), 3200);
  }

  // ---------- Bildebene lesen ----------
  _refresh(s, view) {
    const m = this.world.mem;
    m.refresh();
    const cnt = s.bg0cnt;
    const battle = this.battleMode;
    const size = (cnt >> 14) & 3;
    const key = [cnt, s.bg0hofs, s.bg0vofs, s.dispcnt & 0xff, battle ? 'B' : '', s.wins.map((q) => q.x + ',' + q.y + ',' + q.w + ',' + q.h).join(';')].join('|');
    let changed = this.dirty || key !== this.regKey;
    this.regKey = key;
    // Größe/Farbtiefe, die wir nicht kennen: nichts zeichnen (das Spiel hat BG0 aber trotzdem ausgeblendet)
    if ((cnt & 0x80) || (battle ? size !== 2 && size !== 0 : size !== 0)) {
      this._hideAll();
      return;
    }
    const rows = size === 2 ? 64 : 32;
    if (rows !== this.rows) { this.rows = rows; changed = true; }
    const charBase = ((cnt >> 2) & 3) * 0x4000;
    const mapBase = ((cnt >> 8) & 31) * 0x800;
    const u32 = m.u32;
    if (battle) {
      // Kacheln der Textfenster liegen in den ersten 512 Kacheln des Kachelblocks; die Karte ist 32 x 64
      if (charBase + 0x4000 > 0x18000 || mapBase + rows * 64 > 0x18000) { this._hideAll(); return; }
      const cb = (m.vram + charBase) >> 2, mb = (m.vram + mapBase) >> 2;
      const cs = this.csnB, ms = this.msnB;
      for (let i = 0; i < 4096; i++) { const v = u32[cb + i]; if (v !== cs[i]) { cs[i] = v; changed = true; } }
      const mw = rows * 16;
      for (let i = 0; i < mw; i++) { const v = u32[mb + i]; if (v !== ms[i]) { ms[i] = v; changed = true; } }
    } else {
      const lo = Math.min(charBase, mapBase);
      if (lo + VRAM_WORDS * 4 > 0x18000) {
        this._hideAll();
        return;
      }
      // Grafikspeicher und Paletten auf Änderungen prüfen
      const vb = (m.vram + lo) >> 2;
      const sn = this.vsn;
      if (this.lastLo !== lo) { this.lastLo = lo; changed = true; }
      for (let i = 0; i < VRAM_WORDS; i++) {
        const v = u32[vb + i];
        if (v !== sn[i]) { sn[i] = v; changed = true; }
      }
    }
    const po = m.off(s.pltt);
    const u8 = m.u8;
    const pl = this.psn;
    for (let i = 0; i < 128; i++) {
      const v = (u8[po + i * 4] | (u8[po + i * 4 + 1] << 8) | (u8[po + i * 4 + 2] << 16) | (u8[po + i * 4 + 3] << 24)) >>> 0;
      if (v !== pl[i]) { pl[i] = v; changed = true; }
    }
    if (changed) {
      this._renderBg(s, m, charBase, mapBase, po);
      this.dirty = false;
    }
    // Hauptmenü/Einführung: das Spiel legt alle Fenster vorab an, gezeichnet sind nur einige. Ein Fenster zählt, wenn
    // mindestens zwei Fünftel seiner Kacheln sichtbare Pixel haben (ein Rand, der in ein leeres Fenster hineinragt, genügt nicht).
    if (this.menuMode) s.wins = s.wins.filter((q) => this._fill(q) >= 0.4);
    if (changed) {
      this._layout(s);
      this._dockTextVer = -1;
    }
    this._compose(s, view, changed);
  }

  /** Karte der Textebene -> RGBA (256 x 256). */
  _renderBg(s, m, charBase, mapBase, po) {
    const u8 = m.u8;
    const pal = this.pal;
    for (let i = 0; i < 256; i++) pal[i] = LUT[(u8[po + i * 2] | (u8[po + i * 2 + 1] << 8)) & 0x7fff];
    const out = this.bg32;
    const pidx = this.pidx;
    const occ = this.occ;
    const vram = m.vram;
    const mapO = vram + mapBase;
    const chrO = vram + charBase;
    const rows = this.rows;
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < 32; tx++) {
        const mo = mapO + (ty * 32 + tx) * 2;
        const te = u8[mo] | (u8[mo + 1] << 8);
        const idx = te & 0x3ff;
        const hf = (te >> 10) & 1;
        const vf = (te >> 11) & 1;
        const pb = (te >> 12) * 16;
        const co = chrO + idx * 32;
        let any = 0;
        for (let py = 0; py < 8; py++) {
          const sy = vf ? 7 - py : py;
          const row = co + sy * 4;
          const dst = (ty * 8 + py) * 256 + tx * 8;
          for (let px = 0; px < 8; px++) {
            const sx = hf ? 7 - px : px;
            const byte = u8[row + (sx >> 1)];
            const ci = sx & 1 ? byte >> 4 : byte & 15;
            if (ci) { out[dst + px] = pal[pb + ci]; pidx[dst + px] = pb + ci; any = 1; } else { out[dst + px] = 0; pidx[dst + px] = 0; }
          }
        }
        occ[ty * 32 + tx] = any;
      }
    }
    this.bgCtx.putImageData(this.bgImg, 0, 0);
  }

  /** Das breite Fenster ganz unten ist der Dialog. */
  /** Anteil der Kacheln eines Fensters, die sichtbare Pixel enthalten */
  _fill(q) {
    let n = 0;
    for (let y = 0; y < q.h; y++) {
      const ty = (q.y + y) % this.rows;
      for (let x = 0; x < q.w; x++) if (this.occ[ty * 32 + ((q.x + x) & 31)]) n++;
    }
    return n / Math.max(1, q.w * q.h);
  }

  _isDialog(q) {
    return q.w >= 20 && q.y + q.h >= 18;
  }

  /** Welches Fenster ist der Dialog (unten)? Alle anderen bleiben im Spielbild. */
  _layout(s) {
    let d = null;
    for (const q of s.wins) {
      if (this._isDialog(q)) {
        if (!d) d = { x: q.x, y: q.y, w: q.w, h: q.h };
        else {
          const x1 = Math.max(d.x + d.w, q.x + q.w), y1 = Math.max(d.y + d.h, q.y + q.h);
          d.x = Math.min(d.x, q.x); d.y = Math.min(d.y, q.y); d.w = x1 - d.x; d.h = y1 - d.y;
        }
      }
    }
    this.dock = d;
  }

  /** Enthält das Dialogfenster Text? (Hintergrund des Fensters zählt nicht: im Kampf liegt das Fenster immer da.) */
  _dockHasContent() {
    const d = this.dock;
    if (!d) return false;
    if (this._dockTextVer !== this.ver || this._dockTextFor !== d) {
      this._dockTextVer = this.ver;
      this._dockTextFor = d;
      this._dockText = this._textPixels(d);
    }
    return this._dockText > 0;
  }

  _textPixels(q) {
    const W = q.w * 8, H = q.h * 8;
    const pidx = this.pidx;
    const hMask = this.rows * 8;
    const cnt = new Uint16Array(256);
    for (let y = 0; y < H; y++) {
      const row = ((q.y * 8 + y) % hMask) * 256;
      for (let x = 0; x < W; x++) cnt[pidx[row + ((q.x * 8 + x) & 255)]]++;
    }
    let bgKey = 0, best = 0;
    for (let i = 1; i < 256; i++) if (cnt[i] > best) { best = cnt[i]; bgKey = i; }
    const paper = best > W * H * 0.4 ? bgKey : 0;
    let n = 0;
    for (let i = 1; i < 256; i++) if (i !== paper) n += cnt[i];
    return n;
  }

  _show(frame) {
    if (frame !== this.lastShown.frame) { this.frameCv.style.display = frame ? 'block' : 'none'; this.lastShown.frame = frame; }
  }

  /** Alle Karten ab Nummer n ausblenden. */
  _cardsFrom(n) {
    for (let i = n; i < this.cards.length; i++) {
      const c = this.cards[i];
      if (c.shown) { c.el.style.display = 'none'; c.shown = false; }
    }
  }

  _hideAll() {
    this._show(false);
    this._cardsFrom(0);
    if (this.dockOn) { this.dockOn = false; this.root.classList.remove('tx-dock'); }
  }

  _card(i) {
    while (this.cards.length <= i) {
      const el = document.createElement('div');
      el.className = 'gba-win txcard';
      el.style.display = 'none';
      const cv = document.createElement('canvas');
      el.appendChild(cv);
      this.box.appendChild(el);
      this.cards.push({ el, cv, ctx: cv.getContext('2d'), key: '', pos: '', shown: false, dock: false });
    }
    return this.cards[i];
  }

  /**
   * Inhalt eines Fensters (ohne Rahmen) auf die Karte zeichnen. Der Hintergrund des Fensters (häufigste Farbe im Inneren)
   * wird durchsichtig, so scheint die Karte durch; Text und Schatten behalten ihre Farben.
   */
  _drawWin(card, q, k) {
    const W = q.w * 8, H = q.h * 8;
    const bg = this.bg32, pidx = this.pidx;
    const hMask = this.rows * 8;
    const cnt = new Uint16Array(256);
    let total = 0;
    for (let y = 0; y < H; y++) {
      const row = (((q.y * 8 + y) % hMask) * 256);
      for (let x = 0; x < W; x++) {
        const key = pidx[row + ((q.x * 8 + x) & 255)];
        if (key) { cnt[key]++; total++; }
      }
    }
    let bgKey = 0, best = 0;
    for (let i = 1; i < 256; i++) if (cnt[i] > best) { best = cnt[i]; bgKey = i; }
    const paper = best > W * H * 0.4 ? bgKey : 0;
    const img = new ImageData(W, H);
    const o = new Uint32Array(img.data.buffer);
    for (let y = 0; y < H; y++) {
      const row = (((q.y * 8 + y) % hMask) * 256);
      for (let x = 0; x < W; x++) {
        const i = row + ((q.x * 8 + x) & 255);
        const key = pidx[i];
        o[y * W + x] = key && key !== paper ? bg[i] : 0;
      }
    }
    // Helles Papier (Standardfenster): graue Schrift kräftiger und im Ton der Oberfläche, farbige Zeichen bleiben.
    // Dunkles Papier (Kampfmeldungen: weiße Schrift mit grauem Schatten): Schrift dunkel, Schatten hell - passend zur hellen Karte.
    let mode = 0;
    if (this.battleMode) mode = 2; // Kampfmeldungen: immer weiße Schrift mit grauem Schatten (Papier ist hier ein mittleres Blaugrau)
    else if (paper) {
      const pc = this.pal[paper] >>> 0;
      const pl = ((pc & 255) * 3 + ((pc >> 8) & 255) * 6 + ((pc >> 16) & 255)) / 10;
      mode = pl > 190 ? 1 : pl < 110 ? 2 : 0;
    }
    if (mode) {
      for (let i = 0; i < o.length; i++) {
        const c = o[i];
        if (!c) continue;
        const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40) {
          // das rote Weiter-Zeichen der Kampfmeldungen im Ton der Schrift
          if (mode === 2 && r > 180 && g < 90 && b < 90) o[i] = 0xff303f4f;
          continue;
        }
        const l = (r * 3 + g * 6 + b) / 10;
        const ink = mode === 1 ? l < 130 : l >= 150;
        o[i] = (255 << 24) | (ink ? 0x3f3030 : 0xc8b8b8) >>> 0;
      }
    }
    if (this.wTmp.width !== W || this.wTmp.height !== H) { this.wTmp.width = W; this.wTmp.height = H; }
    this.wTmpCtx.putImageData(img, 0, 0);
    const cv = card.cv;
    if (cv.width !== W * k || cv.height !== H * k) { cv.width = W * k; cv.height = H * k; }
    const c = card.ctx;
    c.clearRect(0, 0, cv.width, cv.height);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.wTmp, 0, 0, W, H, 0, 0, cv.width, cv.height);
  }

  // ---------- Ausgabe ----------
  _compose(s, view, changed) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sheetOn = this.ext.sheetOn();
    const kind = this.ext.sheetKind();
    const d = this.dock;
    const hasDock = !!d && this._dockHasContent() && kind !== 'bubble' && kind !== 'msg';
    if (changed) this.ver++;
    const kF = Math.max(2, Math.min(6, Math.ceil((view.rect.w / GBA_W) * dpr)));
    // Fenster, deren Einträge die App gerade als Auswahl zeigt (Ja/Nein usw.), werden ausgeblendet; andere (Spielerinfo beim Speichern,
    // Geld ...) erscheinen als Karten an ihrer Stelle im Spielbild.
    const hidden = sheetOn ? this._menuWindows(s) : [];

    // 1. Reste der Textebene, die zu keinem Fenster gehören (Rahmenteile u. ä.), wie bisher im Spielbild
    if (this.battleMode) {
      this.frameAny = false;
      this.frameKey = '';
    } else {
      const owned = this._owned(s);
      const key = this.ver + ':' + kF + ':' + owned.sig;
      if (key !== this.frameKey) {
        this.frameKey = key;
        const f32 = this.f32;
        const bg = this.bg32;
        const hofs = s.bg0hofs & 255, vofs = s.bg0vofs & 255;
        let any = false;
        for (let y = 0; y < GBA_H; y++) {
          const by = (y + vofs) & 255;
          const row = by * 256;
          const ty = by >> 3;
          for (let x = 0; x < GBA_W; x++) {
            const bx = (x + hofs) & 255;
            const c = owned.mask[ty * 32 + (bx >> 3)] ? 0 : bg[row + bx];
            f32[y * GBA_W + x] = c;
            if (c) any = true;
          }
        }
        this.frameAny = any;
        if (any) {
          this.fSrcCtx.putImageData(this.fImg, 0, 0);
          const cv = this.frameCv;
          if (cv.width !== GBA_W * kF) { cv.width = GBA_W * kF; cv.height = GBA_H * kF; }
          const c = this.fctx;
          c.clearRect(0, 0, cv.width, cv.height);
          c.imageSmoothingEnabled = false;
          c.drawImage(this.fSrc, 0, 0, GBA_W, GBA_H, 0, 0, cv.width, cv.height);
        }
      }
    }
    const frameVisible = !!this.frameAny;

    // 2. Karten: zuerst die Fenster im Spielbild, dann der Dialog unten
    let n = 0;
    const scF = view.rect.w / GBA_W;
    const hofs = s.bg0hofs & 255, vofs = s.bg0vofs & 255;
    for (const q of s.wins) {
      if (this._isDialog(q) || hidden.includes(q)) continue;
      const card = this._card(n++);
      const key = this.ver + ':' + kF + ':' + q.x + ',' + q.y + ',' + q.w + ',' + q.h;
      if (key !== card.key) { card.key = key; this._drawWin(card, q, kF); }
      const pad = Math.max(4, Math.round(scF * 3));
      const px = view.rect.x + (q.x * 8 - hofs) * scF, py = view.rect.y + (q.y * 8 - vofs) * scF;
      const pos = [Math.round(px), Math.round(py), Math.round(scF * 100), q.w, q.h, pad].join(':');
      if (pos !== card.pos) {
        card.pos = pos;
        card.el.className = 'gba-win txcard small';
        card.el.style.padding = pad + 'px ' + (pad + 2) + 'px';
        card.el.style.left = px - pad - 5 + 'px';
        card.el.style.top = py - pad - 5 + 'px';
        card.el.style.right = 'auto';
        card.el.style.bottom = 'auto';
        card.cv.style.width = q.w * 8 * scF + 'px';
        card.cv.style.height = q.h * 8 * scF + 'px';
      }
      if (!card.shown) { card.el.style.display = 'block'; card.shown = true; }
    }
    if (hasDock) {
      const card = this._card(n++);
      const kD = Math.max(2, Math.min(6, Math.ceil((view.W / GBA_W) * dpr)));
      const key = this.ver + ':' + kD + ':' + d.x + ',' + d.y + ',' + d.w + ',' + d.h;
      if (key !== card.key) { card.key = key; this._drawWin(card, d, kD); }
      // Lage: unten mittig, über dem Aktionsfenster und mit Sicherheitsabstand
      const bSheet = this.battleMode && (this.ext.mode() === 'battleAction' || this.ext.mode() === 'battleMove');
      if (sheetOn || bSheet) {
        if (this.sheetTick++ % 6 === 0 || !this.sheetH) this.sheetH = this._sheetHeight();
      } else this.sheetH = 0;
      const cardW = Math.min(view.W - 20, 560);
      const sc = (cardW - 2 * 15) / (d.w * 8);
      const pos = ['dock', Math.round(cardW), d.w, d.h, this.sheetH, bSheet ? 1 : 0].join(':');
      if (pos !== card.pos) {
        card.pos = pos;
        card.el.className = 'gba-win txcard dock';
        card.el.style.padding = '9px 12px';
        card.el.style.width = cardW + 'px';
        card.el.style.left = (view.W - cardW) / 2 + 'px';
        card.el.style.top = 'auto';
        card.el.style.bottom = bSheet ? `${12 + this.sheetH}px` : `calc(var(--safe-bottom, 0px) + ${12 + this.sheetH}px)`;
        card.cv.style.width = d.w * 8 * sc + 'px';
        card.cv.style.height = d.h * 8 * sc + 'px';
      }
      if (!card.shown) { card.el.style.display = 'block'; card.shown = true; }
    }
    this._cardsFrom(n);
    this._show(frameVisible);
    // Der Knopf unten links ("+") würde sonst den Text der Dialogkarte verdecken (Einführung, Spezialbildschirme)
    const dockOn = hasDock && n > 0;
    if (dockOn !== this.dockOn) { this.dockOn = dockOn; this.root.classList.toggle('tx-dock', dockOn); }
  }

  /** Kacheln, die zu Fenstern gehören (Fenster samt Rahmen): dort zeichnet die Textebene nichts mehr. */
  _owned(s) {
    const sig = s.wins.map((q) => q.x + ',' + q.y + ',' + q.w + ',' + q.h).join(';');
    if (this._ownSig === sig) return this._own;
    const mask = new Uint8Array(1024);
    for (const q of s.wins) {
      const x0 = Math.max(0, q.x - 2), y0 = Math.max(0, q.y - 1), x1 = Math.min(31, q.x + q.w + 1), y1 = Math.min(31, q.y + q.h);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) mask[ty * 32 + tx] = 1;
    }
    this._ownSig = sig;
    this._own = { mask, sig };
    return this._own;
  }

  /** Fenster, in denen die Menüeinträge der App liegen. */
  _menuWindows(s) {
    const sn = this.input.snap;
    if (!sn || sn.ui !== 1 || !sn.rects || !sn.rects.length) return [];
    const out = [];
    for (const q of s.wins) {
      if (this._isDialog(q)) continue;
      const x0 = Math.max(0, q.x - 1), y0 = Math.max(0, q.y - 1), x1 = Math.min(31, q.x + q.w), y1 = Math.min(31, q.y + q.h);
      if (sn.rects.some((r) => {
        const cx = (r.x + r.w / 2) / 8, cy = (r.y + r.h / 2) / 8;
        return cx >= x0 && cx <= x1 + 1 && cy >= y0 && cy <= y1 + 1;
      })) out.push(q);
    }
    return out;
  }

  _sheetHeight() {
    const el = document.getElementById('actSheet');
    if (el && el.classList.contains('on')) return Math.round(el.getBoundingClientRect().height);
    if (this.battleMode) {
      const b = document.getElementById('battle');
      if (b) return Math.round(b.getBoundingClientRect().height);
    }
    return 0;
  }
}
