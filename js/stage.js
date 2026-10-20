// Bühne: setzt die Karte über das 240x160-Spielbild hinaus fort, bis der ganze Bildschirm voll ist.
//
// Aufbau pro Bild:
//   1. Schnappschuss der Weltdaten aus dem Spiel lesen (world.js)
//   2. Kartenzellen (16x16) in einen Ring-Zwischenspeicher zeichnen, falls neu im Blick oder geändert
//   3. Zwischenspeicher + Figuren + das ECHTE Spielbild auf eine kleine "Bühne" im Original-Pixelmaß
//      legen und sauber (scharf-bilinear) auf den Bildschirm vergrößern
//
// Das echte Spielbild liegt immer obenauf (Spielfigur, Wetter, Textfenster ...). Die erweiterte Karte
// zeigt nur, was "daneben" ist. Stimmt etwas nicht (Kampf, Überblendung, Höhle, Regen ...), meldet
// update() false und die App benutzt den alten Rand (view.js).

const CELL = 16;
const RWC = 24; // Ring: Zellen in x
const RHC = 48; // Ring: Zellen in y
const RW = RWC * CELL;
const RH = RHC * CELL;
const SENT = 0x7fffffff;
const GBA_W = 240;
const GBA_H = 160;

const F_CAVE = 1, F_FLASH = 2, F_DARK = 4;
// Wetter, bei dem das Spielbild mit der Karte übereinstimmt (keine Regentropfen, Nebel usw.)
const OK_WEATHER = new Set([0, 1, 2, 11, 12]);

// Nur die Paletten 0..12 gehören zu den Kartenkacheln; 13..15 sind Textfenster (ändern sich bei jedem Dialog / Kartennamen)
const PAL_WORDS = 104;

const mod = (a, n) => ((a % n) + n) % n;

export class Stage {
  /**
   * @param {{world: import('./world.js').World, canvas: HTMLCanvasElement, getAttach: () => ({base:number,selfAddr:number,worldAddr:number}|null)}} o
   */
  constructor(o) {
    this.world = o.world;
    this.cv = o.canvas;
    this.octx = this.cv.getContext('2d', { alpha: true });
    this.getAttach = o.getAttach;
    this.isFading = o.isFading || (() => false);
    this.enabled = true;
    this.info = 'init';
    this.active = false;

    this.loCv = document.createElement('canvas');
    this.upCv = document.createElement('canvas');
    this.loCv.width = this.upCv.width = RW;
    this.loCv.height = this.upCv.height = RH;
    this.loCtx = this.loCv.getContext('2d');
    this.upCtx = this.upCv.getContext('2d');
    this.loImg = new ImageData(RW, RH);
    this.upImg = new ImageData(RW, RH);
    this.lo32 = new Uint32Array(this.loImg.data.buffer);
    this.up32 = new Uint32Array(this.upImg.data.buffer);
    this.slotX = new Int32Array(RWC * RHC).fill(SENT);
    this.slotY = new Int32Array(RWC * RHC).fill(SENT);
    this.slotSig = new Int32Array(RWC * RHC);
    this.slotMeta = new Int32Array(RWC * RHC).fill(-1);

    this.sCv = document.createElement('canvas'); // Bühne im Original-Pixelmaß
    this.sCtx = this.sCv.getContext('2d', { alpha: true });
    this.tCv = document.createElement('canvas'); // ganzzahlig vergrößert
    this.tCtx = this.tCv.getContext('2d', { alpha: true });
    this.fCv = document.createElement('canvas'); // Spielbild mit weichem Rand
    this.fCv.width = GBA_W;
    this.fCv.height = GBA_H;
    this.fCtx = this.fCv.getContext('2d', { alpha: true });
    this.featherCv = document.createElement('canvas');
    this.featherCv.width = GBA_W;
    this.featherCv.height = GBA_H;
    this._buildFeather();

    this.lag = 1;
    this.gOffX = 0; // Ring-Zelle = Gitter-Zelle + gOff (bleibt beim Übertritt in eine Nachbarkarte erhalten)
    this.gOffY = 0;
    this.prevInfo = null; // letzte gezeichnete Karte (für den Übertritt)
    this.lastShift = null; // Verschiebung des letzten Übertritts (Zellen) und Bildnummer
    this.holdN = 0; // Bilder, die die Bühne ohne frische Zellen weiterläuft
    this.fade = null; // Überblendung des Spiels: { a (0..1), color (RGB555) } oder null
    this.fadeHist = new Array(8).fill(null); // Überblendung der letzten Bilder (nach Bildnummer & 7)
    this.blackish = false; // Spielbild (fast) schwarz: Lage und Zoom dürfen springen
    this.black = false; // Spielbild ist schwarz (Kartenwechsel): Bühne bleibt schwarz stehen
    this.transient = false; // die Bühne ist nur kurz weg (Kartenwechsel o. ä.)
    this.lastActive = 0; // Zeitpunkt (ms), zu dem die Bühne zuletzt lief
    this.layoutKey = '';
    this.stable = 0;
    this.palSnap = new Uint32Array(128);
    this.vramSnap = new Uint32Array(8192);
    this.dirtyTiles = new Uint8Array(1024);
    this.lastFrame = -1;
    this.lastMove = 0;
    this.camPrev = null;
    this.frameCount = 0;
    this.calTick = 0;
    this.interiorZoom = 1;
    this.q = 0; // Qualitätsstufe (0 = beste)
    this.cur = null; // Schnappschuss, der zum angezeigten Spielbild passt
    this.stats = { cells: 0, ms: 0, missing: 0, lag: 1, sad: 0 };
    this.dpr = 1;
    this.k = 1;
    this.outW = 0;
    this.outH = 0;
  }

  _buildFeather() {
    const c = this.featherCv.getContext('2d');
    const img = c.createImageData(GBA_W, GBA_H);
    const F = 5; // Zeilen für den weichen Übergang
    for (let y = 0; y < GBA_H; y++) {
      const e = Math.min(y, GBA_H - 1 - y);
      const a = e >= F ? 255 : Math.round(((e + 0.5) / F) * 255);
      for (let x = 0; x < GBA_W; x++) {
        const i = (y * GBA_W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
        img.data[i + 3] = a;
      }
    }
    c.putImageData(img, 0, 0);
  }

  /** Größe der Ausgabefläche (CSS-Pixel). */
  resize(view) {
    this.view = view;
    this.dpr = Math.min(window.devicePixelRatio || 1, [2, 1.6, 1.25][this.q || 0]);
    const W = view.W, H = view.H;
    this.outW = Math.max(1, Math.round(W * this.dpr));
    this.outH = Math.max(1, Math.round(H * this.dpr));
    if (this.cv.width !== this.outW || this.cv.height !== this.outH) {
      this.cv.width = this.outW;
      this.cv.height = this.outH;
      this.dirtyOut = true; // Zeichenfläche ist jetzt leer: sofort neu zeichnen (sonst blitzt ein leeres Bild auf)
    }
    // Bühne so groß, dass sie bei der kleinsten Vergrößerung (volle Breite) den Bildschirm deckt
    const scMin = Math.max(0.5, W / GBA_W);
    const sw = GBA_W + 8;
    const sh = Math.ceil(H / scMin) + 8;
    this.sCv.width = sw;
    this.sCv.height = sh;
    this.k = Math.max(1, Math.min([4, 3, 2][this.q || 0], Math.ceil(scMin * this.dpr)));
    this.tCv.width = sw * this.k;
    this.tCv.height = sh * this.k;
    this.geoKey = '';
  }

  /**
   * Zeitmessung pro Bild (ms). Ist das Gerät dauerhaft zu langsam, wird die Ausgabe
   * schrittweise gröber (weniger Pixel), damit das Spiel flüssig bleibt.
   */
  perf(ms) {
    this.ema = (this.ema || ms) * 0.95 + ms * 0.05;
    this.perfN = (this.perfN || 0) + 1;
    if (this.perfN > 120 && this.ema > 11 && (this.q || 0) < 2) {
      this.q = (this.q || 0) + 1;
      this.perfN = 0;
      this.ema = 0;
      if (this.view) this.resize(this.view);
    }
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) this.active = false;
  }

  // ---------- Ring-Zwischenspeicher ----------
  _resetRing() {
    this.gOffX = 0;
    this.gOffY = 0;
    this.lastShift = null;
    this.slotX.fill(SENT);
    this.slotY.fill(SENT);
    this.slotMeta.fill(-1);
    this.dirtyTiles.fill(0);
    this.vramFresh = false;
    this.stable = 0;
    this.lo32.fill(0);
    this.up32.fill(0);
    this.loCtx.clearRect(0, 0, RW, RH);
    this.upCtx.clearRect(0, 0, RW, RH);
  }

  _invalidateAll() {
    this.slotX.fill(SENT);
    this.slotY.fill(SENT);
  }

  /** Welche der 13 Hintergrundpaletten haben sich seit dem letzten Aufruf geändert? (Bitmaske, 0 = keine) */
  _palChanged() {
    const w = this.world;
    const m = w.mem;
    const o = m.off(w.useUnfaded && w.snap.plttU ? w.snap.plttU : w.snap.pltt);
    let mask = 0;
    const sn = this.palSnap;
    if ((o & 3) === 0) {
      const u = m.u32;
      const b = o >> 2;
      for (let i = 0; i < PAL_WORDS; i++) {
        const v = u[b + i];
        if (v !== sn[i]) { sn[i] = v; mask |= 1 << (i >> 3); }
      }
    } else {
      const u8 = m.u8;
      for (let i = 0; i < PAL_WORDS; i++) {
        const v = (u8[o + i * 4] | (u8[o + i * 4 + 1] << 8) | (u8[o + i * 4 + 2] << 16) | (u8[o + i * 4 + 3] << 24)) >>> 0;
        if (v !== sn[i]) { sn[i] = v; mask |= 1 << (i >> 3); }
      }
    }
    return mask;
  }

  /**
   * Zellen ungültig machen, die eine der geänderten Paletten benutzen. Ändert sich die Hintergrundfarbe (Palette 0)
   * oder fast alles (Überblendung, Wetter), werden alle Zellen neu gezeichnet. Bei einem Wechsel des zweiten Tilesets
   * ändern sich nur die Paletten 6-12: Zellen mit Kacheln aus dem ersten Tileset bleiben gültig.
   */
  _invalidatePal(mask) {
    let n = 0;
    for (let m2 = mask; m2; m2 &= m2 - 1) n++;
    if ((mask & 1) || n > 7) return this._invalidateAll();
    const w = this.world;
    for (let slot = 0; slot < RWC * RHC; slot++) {
      if (this.slotX[slot] === SENT) continue;
      const id = this.slotMeta[slot];
      if (id < 0) continue;
      if (id >= 512 || (w.metaPalMask(id) & mask)) this.slotX[slot] = SENT;
    }
  }

  /** Das zweite Tileset wechselt: Zellen mit dessen Metakacheln (Nr. 512 und höher) sind veraltet. */
  _invalidateSecondary() {
    for (let slot = 0; slot < RWC * RHC; slot++) {
      if (this.slotMeta[slot] >= 512) this.slotX[slot] = SENT;
    }
  }

  /** Kachelgrafik im VRAM geändert (Wasser, Blumen ...)? Betroffene Zellen ungültig machen. */
  _checkVram() {
    const w = this.world;
    const m = w.mem;
    if (m.vram < 0 || (m.vram & 3)) return;
    const u = m.u32;
    const b = m.vram >> 2;
    const sn = this.vramSnap;
    const dirty = this.dirtyTiles;
    let any = false;
    if (!this.vramFresh) {
      for (let i = 0; i < 8192; i++) sn[i] = u[b + i];
      this.vramFresh = true;
      return;
    }
    for (let i = 0; i < 8192; i++) {
      const v = u[b + i];
      if (v !== sn[i]) { sn[i] = v; dirty[i >> 3] = 1; any = true; }
    }
    if (!any) return;
    for (let slot = 0; slot < RWC * RHC; slot++) {
      const id = this.slotMeta[slot];
      if (id >= 0 && this.slotX[slot] !== SENT && w.metaUsesDirty(id, dirty)) this.slotX[slot] = SENT;
    }
    dirty.fill(0);
  }

  /**
   * Zellen [cx0..cx1] x [cy0..cy1] gültig machen (neu zeichnen, falls nötig).
   * Gibt die Zahl der Zellen zurück, die in diesem Bild nicht mehr fertig wurden.
   */
  _ensure(cx0, cy0, cx1, cy1, budgetMs) {
    const w = this.world;
    const list = []; // Zellen, die an dieser Stelle noch gar nicht (oder eine andere Zelle) gezeichnet sind: zuerst
    const stale = []; // Zellen an der richtigen Stelle, deren Bild nur veraltet ist (Wasser, Blumen ...)
    const gx = this.gOffX, gy = this.gOffY;
    for (let cy = cy0; cy <= cy1; cy++) {
      const ry = mod(cy + gy, RHC) * RWC;
      for (let cx = cx0; cx <= cx1; cx++) {
        const slot = ry + mod(cx + gx, RWC);
        let sig = w.gridRaw(cx, cy);
        // Randzellen: Muster und Kacheln hängen von Lage und Karte ab
        if (sig === 0xffff || sig === 0x3ff) sig = 0x10000 + (((cx + 1) & 1) | (((cy + 1) & 1) << 1)) + (w.borderSig << 2);
        if (this.slotX[slot] !== cx + gx || this.slotY[slot] !== cy + gy) list.push(cx, cy, slot, sig);
        else if (this.slotSig[slot] !== sig) stale.push(cx, cy, slot, sig);
      }
    }
    const nWrong = list.length >> 2;
    const nStale = stale.length >> 2;
    this.stats.stale = nStale;
    if (!nWrong && !nStale) { this.stats.wrong = 0; return 0; }
    // von der Mitte nach außen
    const mx = (cx0 + cx1) / 2, my = (cy0 + cy1) / 2;
    const order = (l) => {
      const n = l.length >> 2;
      if (n <= 24) return l;
      const idx = Array.from({ length: n }, (_, i) => i);
      const dist = (i) => Math.abs(l[i * 4] - mx) + Math.abs(l[i * 4 + 1] - my);
      idx.sort((a, b) => dist(a) - dist(b));
      const out = [];
      for (const i of idx) out.push(l[i * 4], l[i * 4 + 1], l[i * 4 + 2], l[i * 4 + 3]);
      return out;
    };
    const all = order(list).concat(order(stale));
    const t0 = performance.now();
    // Veraltete Zellen dürfen höchstens einen kleinen Teil der Zeit des Bildes verbrauchen
    const staleMs = Math.min(budgetMs, 3);
    let done = 0, doneWrong = 0;
    const lo = this.lo32, up = this.up32;
    const n = nWrong + nStale;
    const few = []; // Lage der ersten Zellen dieses Bildes (für das Hochladen einzelner Zellen)
    for (let i = 0; i < n; i++) {
      if (i > 0 && (i & 7) === 0) {
        const el = performance.now() - t0;
        if (el > (i < nWrong ? budgetMs : staleMs)) {
          if (i < nWrong) break;
          break;
        }
      }
      const cx = all[i * 4], cy = all[i * 4 + 1], slot = all[i * 4 + 2], sig = all[i * 4 + 3];
      const rx = mod(cx + gx, RWC) * CELL, ry = mod(cy + gy, RHC) * CELL;
      const id = w.renderCell(cx, cy, lo, up, RW, rx, ry);
      if (done < 8) few.push(rx, ry);
      this.slotX[slot] = cx + gx;
      this.slotY[slot] = cy + gy;
      this.slotSig[slot] = sig;
      this.slotMeta[slot] = id;
      done++;
      if (i < nWrong) doneWrong++;
    }
    // Hochladen: viele Zellen auf einmal (ganzer Ring ~1 ms) ist viel billiger als jede einzeln (je ~50 µs)
    if (done > 8) {
      this.loCtx.putImageData(this.loImg, 0, 0);
      this.upCtx.putImageData(this.upImg, 0, 0);
    } else {
      for (let i = 0; i < few.length; i += 2) {
        this.loCtx.putImageData(this.loImg, 0, 0, few[i], few[i + 1], CELL, CELL);
        this.upCtx.putImageData(this.upImg, 0, 0, few[i], few[i + 1], CELL, CELL);
      }
    }
    this.stats.cells += done;
    this.stats.wrong = nWrong - doneWrong;
    return n - done;
  }

  _pix(wx, wy) {
    wx += this.gOffX * CELL;
    wy += this.gOffY * CELL;
    const cx = Math.floor(wx / CELL), cy = Math.floor(wy / CELL);
    const slot = mod(cy, RHC) * RWC + mod(cx, RWC);
    if (this.slotX[slot] !== cx || this.slotY[slot] !== cy) return -1;
    const ri = mod(wy, RH) * RW + mod(wx, RW);
    const u = this.up32[ri];
    return u >>> 24 ? u : this.lo32[ri];
  }

  // ---------- Abgleich mit dem angezeigten Bild ----------
  /** Kamera, wie sie vor `lag` Bildern war (das Spiel meldet die letzten 8). */
  _camAt(s, lag) {
    const h = s.camHist;
    const c = h[(s.frame - lag) & 7];
    if (lag <= 0) return c;
    // Übertritt in eine Nachbarkarte: Einträge vor dem Sprung liegen im alten Koordinatensystem
    let x = c.x, y = c.y;
    const sh = this.lastShift;
    let prev = h[s.frame & 7];
    for (let k = 1; k <= lag; k++) {
      const e = h[(s.frame - k) & 7];
      if (Math.abs(e.x - prev.x) > 48 || Math.abs(e.y - prev.y) > 48) {
        if (sh && s.frame - sh.frame < 24) {
          x -= sh.x * CELL;
          y -= sh.y * CELL;
          prev = { x: e.x - sh.x * CELL, y: e.y - sh.y * CELL };
          continue;
        }
        return h[(s.frame - k + 1) & 7]; // unbekannter Sprung: neuesten gültigen Wert nehmen
      }
      prev = e;
    }
    return { x, y };
  }

  /**
   * Zwischen dem Spielstand, den wir lesen, und dem Bild, das gerade im Canvas steht, liegen
   * ein paar Bilder Verzögerung. Beim Laufen verschiebt sich die Karte dadurch. Wir probieren
   * deshalb mehrere Verzögerungen aus und nehmen die, bei der die Ränder des echten Bildes
   * am besten zum Zwischenspeicher passen.
   */
  _calibrate(view, s) {
    const fd = view.frameData().data;
    const rows = [0, 1, 2, 3, 156, 157, 158, 159];
    this.dbg = [];
    let best = -1, bestSad = Infinity, curSad = Infinity;
    const seen = new Set();
    for (let lag = 0; lag < 8; lag++) {
      const cam = this._camAt(s, lag);
      const key = cam.x + ',' + cam.y;
      if (seen.has(key) && lag !== this.lag) continue;
      seen.add(key);
      let sad = 0, cnt = 0;
      for (const r of rows) {
        for (let x = 0; x < GBA_W; x += 3) {
          const p = this._pix(cam.x + x, cam.y + r);
          if (p < 0) continue;
          const i = (r * GBA_W + x) * 4;
          sad += Math.abs((p & 255) - fd[i]) + Math.abs(((p >> 8) & 255) - fd[i + 1]) + Math.abs(((p >> 16) & 255) - fd[i + 2]);
          cnt++;
        }
      }
      if (cnt < 100) continue;
      sad /= cnt;
      this.dbg.push({ lag, sad: Math.round(sad * 10) / 10, cnt, cx: cam.x, cy: cam.y });
      if (lag === this.lag) curSad = sad;
      if (sad < bestSad) { bestSad = sad; best = lag; }
    }
    if (best >= 0 && best !== this.lag && bestSad + 1.5 < curSad) this.lag = best;
    this.stats.lag = this.lag;
    this.stats.sad = bestSad;
  }

  // ---------- Hauptschritt ----------
  _off(why, transient) {
    this.info = why;
    this.active = false;
    this.transient = !!transient;
    this.black = false;
    this.blackish = false;
    return false;
  }

  /**
   * Kurze Störungen (Karte wechselt, Zellen werden neu gezeichnet): die Bühne läuft mit dem Zwischenspeicher weiter,
   * statt auf die Normalansicht umzuschalten (das wäre ein sichtbares Flackern). Nicht bei Überblendungen und nicht,
   * wenn die Bühne vorher gar nicht aktiv war.
   */
  _hold(why) {
    if (this.active && this.holdN < 60) {
      if (this.frameNew) this.holdN++;
      this.info = why + ' (gehalten)';
      this._setCur(this.world.snap);
      return true;
    }
    return this._off(why, true);
  }

  /** Überblendung des Spiels aus dem Schnappschuss: null = keine, false = nicht darstellbar, sonst { a: 0..1, color: RGB555 }. */
  _fadeOf(s) {
    if (s.fadeActive && s.fadeSel) this.fadeSel = s.fadeSel;
    else if (!s.fadeY && !s.fadeActive) this.fadeSel = 0;
    const y = s.fadeY;
    if (!y && !s.fadeActive) return null;
    if (s.fadeMode === 2) return false; // Hardware-Überblendung (Kampfübergang)
    // Am Ende einer Überblendung meldet das Spiel keine Paletten mehr: die zuletzt betroffenen gelten weiter
    if ((this.fadeSel & 0x1fff) !== 0x1fff) return false;
    return { a: Math.min(1, y / 16), color: s.fadeColor & 0x7fff };
  }

  _frameBlack(view) {
    const d = view.frameData().data;
    for (let i = 0; i < d.length; i += 148) if (d[i] > 14 || d[i + 1] > 14 || d[i + 2] > 14) return false;
    return true;
  }

  /**
   * Die Karte hat gewechselt. Beim Übertritt in eine Nachbarkarte (Verbindung) bleibt der Zwischenspeicher erhalten:
   * die Zellen werden nur auf das neue Koordinatensystem verschoben. Sonst (Tür, Sprung, Laden) wird neu begonnen.
   */
  _onLayout(s, lk) {
    const w = this.world;
    const p = this.prevInfo;
    this.layoutKey = lk;
    let c = null;
    if (p && (p.group !== s.mapGroup || p.num !== s.mapNum)) c = (p.conns || []).find((q) => q.group === s.mapGroup && q.num === s.mapNum);
    if (!c) {
      this._resetRing();
      this.voidDone = false;
      return;
    }
    // Ursprung der neuen Karte in Zellen der alten (Süd: darunter, Nord: darüber, West/Ost: daneben)
    let dx = 0, dy = 0;
    if (c.dir === 1) { dx = c.offset; dy = p.h; }
    else if (c.dir === 2) { dx = c.offset; dy = -c.h; }
    else if (c.dir === 3) { dx = -c.w; dy = c.offset; }
    else { dx = p.w; dy = c.offset; }
    this.gOffX += dx;
    this.gOffY += dy;
    this.lastShift = { x: dx, y: dy, frame: s.frame };
    this.camPrev = null;
    if (p.pri !== s.priTiles) {
      // anderes Haupt-Tileset: alle Zellen gelten als veraltet (das alte Bild bleibt stehen, bis sie neu sind)
      this._invalidateAll();
      this.vramFresh = false;
    } else if (p.sec !== s.secTiles) {
      // nur das zweite Tileset wechselt (Stadt <-> Route): nur dessen Zellen sind veraltet. Geänderte Kacheln
      // und Paletten erkennen _checkVram() und _palChanged() von selbst.
      this._invalidateSecondary();
    }
    this.voidDone = false;
    this.holdN = 0;
  }

  /** Pro Bild aufrufen. true = die erweiterte Karte kann gezeichnet werden (draw()). */
  update(view) {
    if (!this.enabled) return this._off('aus');
    if (!view.portrait) return this._off('quer');
    const att = this.getAttach();
    if (!att) return this._off('keine Weltdaten');
    const w = this.world;
    w.attach(att.base, att.selfAddr, att.worldAddr);
    if (!w.read()) return this._off('lesen', true);
    const s = w.snap;
    const frameChanged = s.frame !== this.lastFrame;
    this.frameNew = frameChanged;
    if (frameChanged) this.lastFrame = s.frame;
    // Überblendung (Tür, Kartenwechsel): die Karte dunkelt gemeinsam mit dem Spielbild ab
    const fdNow = this._fadeOf(s);
    if (frameChanged) this.fadeHist[s.frame & 7] = { frame: s.frame, fd: fdNow };
    if (!s.valid) {
      this.stable = 0;
      // Kartenwechsel: Das Spielbild ist schwarz. Die Bühne bleibt schwarz stehen, bis die neue Karte da ist.
      if (this.active && this.holdN < 400 && this._frameBlack(view)) {
        if (frameChanged) this.holdN++;
        this.black = true;
        this.blackish = true;
        this.info = 'schwarz (Kartenwechsel)';
        this.lastActive = performance.now();
        return true;
      }
      return this._off('keine Oberwelt', true);
    }
    if (!w.prepare()) return this._hold('vorbereiten: ' + (w.failWhy || '?'));
    if (s.flags & (F_CAVE | F_FLASH | F_DARK)) return this._off('dunkle Karte');
    if (!OK_WEATHER.has(s.weather)) return this._off('Wetter ' + s.weather);
    if (fdNow === false) return this._off('Überblendung', true);
    this.black = false;
    this.fdNow = fdNow;
    // Während einer Überblendung zeichnen wir mit den ungedimmten Farben und legen die Überblendung darüber
    const flip = w.useUnfaded !== !!fdNow;
    w.useUnfaded = !!fdNow;

    const lk = [s.gridPtr, s.borderPtr, s.priTiles, s.secTiles, s.gridW, s.gridH, s.connPtr, s.mapGroup, s.mapNum].join(':');
    if (lk !== this.layoutKey) this._onLayout(s, lk);
    if (frameChanged || flip) {
      const pc = this._palChanged();
      if (pc) { this.stable = 0; this._invalidatePal(pc); }
      else if (frameChanged && this.stable < 1000) this.stable++;
    }
    if (this.stable < 4) { w.beginCells(true); this._rememberMap(s); return this._hold('Farben ändern sich'); }
    w.beginCells(flip || (frameChanged && this.stable === 4));
    this._rememberMap(s);
    if (!this.voidDone) {
      const was = w.voidBorder;
      w.computeVoid();
      this.voidDone = true;
      if (w.voidBorder !== was) this._invalidateAll();
    }
    if (frameChanged) this._checkVram();

    // Verzögerung bestimmen
    const moved = this.camPrev && (this.camPrev.x !== s.camX || this.camPrev.y !== s.camY);
    this.camPrev = { x: s.camX, y: s.camY };
    if (moved) this.lastMove = s.frame;
    this.nowSnap = s;
    this._setCur(s);

    // sichtbarer Bereich in Kartenpixeln
    const g = this._geometry(view, this.cur);
    if (!g) return this._off('Bildschirm zu hoch');
    const t0 = performance.now();
    const missing = this._ensure(g.cx0, g.cy0, g.cx1, g.cy1, this.stable === 4 || fdNow ? 12 : 6);
    this.stats.ms = performance.now() - t0;
    this.stats.missing = missing;
    // Nur Zellen, die an ihrer Stelle noch fehlen, sind ein Problem. Veraltete (Wasser-Animation) zeichnen wir nach
    // und zeigen so lange die vorige Fassung: das fällt nicht auf, ein Rückfall auf die Normalansicht aber schon.
    if (this.stats.wrong > 48) return this._hold('Karte wird aufgebaut');
    if (fdNow) {
      const fit = this._fitFade(view, fdNow);
      if (fit) this.fade = fit;
    }

    if (!fdNow && frameChanged && s.frame - this.lastMove < 10 && ++this.calTick % 3 === 0) {
      this._calibrate(view, s);
      this._setCur(s);
    }
    // Innenraum kleiner als der Bildschirm: Hinweis für den Zoom
    if (w.voidBorder) {
      const iw = Math.max(1, s.gridW - 15) * CELL;
      this.interiorZoom = Math.max(1, Math.min(1.6, GBA_W / (iw + 24)));
    } else this.interiorZoom = 1;
    this.info = 'aktiv';
    this.active = true;
    this.transient = false;
    this.blackish = !!this.fade && this.fade.a >= 0.85;
    this.lastActive = performance.now();
    this.holdN = 0;
    return true;
  }

  /** Karte merken (für den Übertritt in die Nachbarkarte), auch wenn die Bühne gerade nur hält. */
  _rememberMap(s) {
    this.prevInfo = { group: s.mapGroup, num: s.mapNum, w: s.gridW - 15, h: s.gridH - 14, conns: this.world._conns, pri: s.priTiles, sec: s.secTiles };
  }

  /**
   * Stärke der Überblendung aus dem echten Bild ablesen: am oberen/unteren Rand vergleichen wir die Farben des Spielbilds
   * mit der (ungedimmten) gezeichneten Karte. Frame = Karte * (1 - a) + Zielfarbe * a. Der Median ist unempfindlich
   * gegen Figuren und Kartennamen am Rand. So stimmt die Überblendung auch, wenn das Bild dem Schnappschuss hinterherhinkt.
   */
  _fitFade(view, fd) {
    const col = fd.color;
    const tgt = [((col & 31) << 3) | ((col & 31) >> 2), (((col >> 5) & 31) << 3) | (((col >> 5) & 31) >> 2), (((col >> 10) & 31) << 3) | (((col >> 10) & 31) >> 2)];
    const data = view.frameData().data;
    const cam = this.cur;
    const est = [];
    for (const r of [0, 1, 2, 3, 156, 157, 158, 159]) {
      for (let x = 0; x < GBA_W; x += 3) {
        const p = this._pix(cam.camX + x, cam.camY + r);
        if (p <= 0 || p >>> 24 === 0) continue;
        const i = (r * GBA_W + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const ring = (p >> (8 * ch)) & 255;
          const den = ring - tgt[ch];
          if (den > -48 && den < 48) continue;
          est.push((ring - data[i + ch]) / den);
        }
      }
    }
    if (est.length < 30) return null;
    est.sort((a, b) => a - b);
    const a = est[est.length >> 1];
    return { a: Math.max(0, Math.min(1, a)), color: col, fit: true };
  }

  /**
   * Pixel des Spielbilds, an denen die gezeichnete Karte "leer" ist (Raum kleiner als der Bildschirm).
   * Das ersetzt die Suche nach schwarzen Flächen im Spielbild: beim Aus-/Einblenden werden alle Pixel dunkel,
   * die Karte weiß aber, welche wirklich leer sind.
   */
  voidFlags() {
    const w = this.world;
    const cur = this.cur;
    if (!this.active || this.black || !cur || !w.voidBorder) return null;
    if (!this.vflags) this.vflags = new Uint8Array(GBA_W * GBA_H);
    const out = this.vflags;
    const gx = this.gOffX * CELL, gy = this.gOffY * CELL;
    for (let y = 0; y < GBA_H; y++) {
      const wy = cur.camY + y + gy;
      const cy = Math.floor(wy / CELL);
      const ry = mod(wy, RH) * RW;
      for (let x = 0; x < GBA_W; x++) {
        const wx = cur.camX + x + gx;
        const cx = Math.floor(wx / CELL);
        const slot = mod(cy, RHC) * RWC + mod(cx, RWC);
        if (this.slotX[slot] !== cx || this.slotY[slot] !== cy) { out[y * GBA_W + x] = 0; continue; }
        const ri = ry + mod(wx, RW);
        out[y * GBA_W + x] = this.lo32[ri] === 0 && this.up32[ri] >>> 24 === 0 ? 1 : 0;
      }
    }
    return out;
  }

  /** Überblendung, die zum angezeigten Bild passt (das Bild hinkt dem Schnappschuss `lag` Bilder hinterher). */
  _fadeAt(s, lag) {
    const e = this.fadeHist[(s.frame - lag) & 7];
    if (e && e.frame === s.frame - lag && e.fd !== false) return e.fd;
    return this.fdNow || null;
  }

  _setCur(s) {
    const c = this._camAt(s, this.lag);
    this.cur = { camX: c.x, camY: c.y, npcs: s.npcs, frame: s.frame };
    this.fade = this._fadeAt(s, this.lag);
  }

  _geometry(view, cur) {
    const r = view.rect;
    const sc = r.w / GBA_W;
    const fu = Math.ceil(r.x / sc);
    const fv = Math.ceil(r.y / sc);
    const ou = r.x - fu * sc;
    const ov = r.y - fv * sc;
    const sw = Math.ceil((view.W - ou) / sc) + 1;
    const sh = Math.ceil((view.H - ov) / sc) + 1;
    if (sw > this.sCv.width || sh > this.sCv.height || sw > RW - 4 * CELL || sh > RH - 4 * CELL) return null;
    const wx0 = cur.camX - fu, wy0 = cur.camY - fv;
    return {
      sc, fu, fv, ou, ov, sw, sh, wx0, wy0,
      cx0: Math.floor(wx0 / CELL) - 1, cx1: Math.floor((wx0 + sw - 1) / CELL) + 1,
      cy0: Math.floor(wy0 / CELL) - 1, cy1: Math.floor((wy0 + sh - 1) / CELL) + 1,
    };
  }

  _blitRing(ctx, cv, wx0, wy0, sw, sh) {
    let y = 0;
    while (y < sh) {
      const ry = mod(wy0 + y, RH);
      const hh = Math.min(sh - y, RH - ry);
      let x = 0;
      while (x < sw) {
        const rx = mod(wx0 + x, RW);
        const ww = Math.min(sw - x, RW - rx);
        ctx.drawImage(cv, rx, ry, ww, hh, x, y, ww, hh);
        x += ww;
      }
      y += hh;
    }
  }

  /** Bühne zusammensetzen und auf den Bildschirm legen. */
  draw(view) {
    this.dirtyOut = false;
    if (this.black) {
      const o = this.octx;
      o.globalCompositeOperation = 'source-over';
      o.fillStyle = '#000';
      o.fillRect(0, 0, this.outW, this.outH);
      return;
    }
    const cur = this.cur;
    if (!cur) return;
    const g = this._geometry(view, cur);
    if (!g) return;
    const { sc, fu, fv, ou, ov, sw, sh, wx0, wy0 } = g;
    const w = this.world;
    const c = this.sCtx;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.sCv.width, this.sCv.height);

    // 1. Karte unter den Figuren
    this._blitRing(c, this.loCv, wx0 + this.gOffX * CELL, wy0 + this.gOffY * CELL, sw, sh);
    // 2. Figuren
    for (const n of cur.npcs) {
      const img = w.npcImage(n);
      if (!img) continue;
      const x = n.x * CELL + img.dx - wx0;
      const y = n.y * CELL + img.dy - wy0;
      if (x + img.w < 0 || y + img.h < 0 || x >= sw || y >= sh) continue;
      if (!img.canvas) {
        const cv = document.createElement('canvas');
        cv.width = img.w;
        cv.height = img.h;
        const id = new ImageData(new Uint8ClampedArray(img.px.buffer.slice(img.px.byteOffset, img.px.byteOffset + img.px.byteLength)), img.w, img.h);
        cv.getContext('2d').putImageData(id, 0, 0);
        img.canvas = cv;
      }
      c.drawImage(img.canvas, x, y);
    }
    // 3. Karte über den Figuren
    this._blitRing(c, this.upCv, wx0 + this.gOffX * CELL, wy0 + this.gOffY * CELL, sw, sh);
    // 3b. Überblendung des Spiels (Tür, Kartenwechsel) über die gezeichnete Karte legen
    const fd = this.fade;
    if (fd && fd.a > 0) {
      const col = fd.color;
      const r = ((col & 31) << 3) | ((col & 31) >> 2), g8 = (((col >> 5) & 31) << 3) | (((col >> 5) & 31) >> 2), b8 = (((col >> 10) & 31) << 3) | (((col >> 10) & 31) >> 2);
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = `rgba(${r},${g8},${b8},${fd.a})`;
      c.fillRect(0, 0, sw, sh);
      c.globalCompositeOperation = 'source-over';
    }
    // 4. echtes Spielbild (weicher Rand oben/unten)
    const f = this.fCtx;
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, GBA_W, GBA_H);
    f.drawImage(view.getFrameImage(), 0, 0);
    f.globalCompositeOperation = 'destination-in';
    f.drawImage(this.featherCv, 0, 0);
    f.globalCompositeOperation = 'source-over';
    c.drawImage(this.fCv, fu, fv);

    // 5. scharf-bilinear auf den Bildschirm
    const k = this.k;
    const t = this.tCtx;
    t.clearRect(0, 0, sw * k, sh * k);
    t.imageSmoothingEnabled = false;
    t.drawImage(this.sCv, 0, 0, sw, sh, 0, 0, sw * k, sh * k);
    const o = this.octx;
    o.clearRect(0, 0, this.outW, this.outH);
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = 'high';
    o.drawImage(this.tCv, 0, 0, sw * k, sh * k, ou * this.dpr, ov * this.dpr, sw * sc * this.dpr, sh * sc * this.dpr);
  }
}
