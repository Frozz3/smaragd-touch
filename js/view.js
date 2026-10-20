// Zeichnet das Spielbild (240x160) und einen weichen Rand drumherum.
//
// Das Spiel rechnet fest mit 240x160 Pixeln. Ein echtes Hochformat gibt es deshalb nicht.
// Damit der Bildschirm trotzdem nicht schwarz bleibt, wird das Bild in voller Breite
// gezeigt und oben/unten durch eine gespiegelte, weichgezeichnete und abgedunkelte
// Fortsetzung des Spielbilds ergänzt ("Ambient-Rand").
//
// Optional (Einstellung "Zoom") vergrößert sich das Bild beim freien Laufen leicht und
// zoomt bei Dialogen, Menüs und Kämpfen wieder auf volle Breite zurück.

import { FrameTap } from './frametap.js';

const src_ok = (c) => c.width > 0;
const GBA_W = 240;
const GBA_H = 160;

export class View {
  /**
   * @param {{view: HTMLCanvasElement, src: HTMLCanvasElement, ambient: HTMLCanvasElement, root: HTMLElement}} o
   */
  constructor(o) {
    this.view = o.view;
    this.src = o.src;
    this.tap = new FrameTap(o.emu || { getMemory: () => null }, () => this._slowFrame());
    this.amb = o.ambient;
    this.root = o.root;
    this.ctx = this.view.getContext('2d', { alpha: true });
    this.actx = this.amb.getContext('2d', { alpha: false });
    this.tmp = document.createElement('canvas');
    this.tctx = this.tmp.getContext('2d', { alpha: false });

    // Schwarze Raumränder (kleine Innenräume zeichnet das Spiel mit schwarzem Rand) werden
    // durch die weiche Hintergrund-Fortsetzung ersetzt.
    this.edgeOn = false; // von der Oberfläche gesetzt: nur in der Spielwelt
    this.maskActive = false;
    this.scanCv = document.createElement('canvas');
    this.scanCv.width = GBA_W;
    this.scanCv.height = GBA_H;
    this.sctx = this.scanCv.getContext('2d', { willReadFrequently: true });
    this.maskCv = document.createElement('canvas');
    this.maskCv.width = GBA_W;
    this.maskCv.height = GBA_H;
    this.mctx = this.maskCv.getContext('2d');
    this.fillCv = document.createElement('canvas');
    this.fillCv.width = GBA_W;
    this.fillCv.height = GBA_H;
    this.fctx = this.fillCv.getContext('2d');
    this.maskImg = this.mctx.createImageData(GBA_W, GBA_H);
    this.fillImg = this.fctx.createImageData(GBA_W, GBA_H);
    this.edgeM = new Uint8Array(GBA_W * GBA_H);
    this.edgeV = new Uint8Array(GBA_W * GBA_H);
    this.edgeQ = new Int32Array(GBA_W * GBA_H);

    // Gerahmtes Spielbild (mit Maske) für die Bühne
    this.maskedCv = document.createElement('canvas');
    this.maskedCv.width = GBA_W;
    this.maskedCv.height = GBA_H;
    this.maskedCtx = this.maskedCv.getContext('2d');

    this.stage = null;
    this.worldOn = false;
    this.shiftY = 0; // Verschiebung des Spielbilds nach unten/oben, wenn die Karte den Bildschirm füllt
    this.worldAnchor = 0.45; // Höhe (Anteil der Bildschirmhöhe), auf der die Spielfigur steht
    this.battleSheet = 0; // >0: Kampf – Höhe des Menü-Panels unten (px), das Spielbild rückt darüber

    this.smooth = true;
    this.ambientOn = true;
    this.zoomSetting = 1; // 1 = aus, sonst Faktor beim freien Laufen
    this.zoomTarget = 1;
    this.zoom = 1;
    this.running = false;
    this.frameNo = 0;
    this.W = 0;
    this.H = 0;
    this.rect = { x: 0, y: 0, w: 0, h: 0 }; // aktuelles Spielbild in CSS-Pixeln (inkl. Zoom)
    this.base = { x: 0, y: 0, w: 0, h: 0 }; // Spielbild ohne Zoom
    this.listeners = [];
    // Sicherheitsabstände (Notch, Home-Balken) auslesen
    this.probe = document.createElement('div');
    this.probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(this.probe);
    this._loop = this._loop.bind(this);
    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
  }

  onLayout(fn) { this.listeners.push(fn); }

  setTextLayer(t) { this.textLayer = t; }

  setBattle(b) { this.battle = b; }

  /** Kampf in der App: Spielbild, Rand und Bühne sind verdeckt - nicht zeichnen. */
  setBattleOwn(on) {
    this.battleOwn = !!on;
    if (!on) { this._fd = null; this._fdNo = -1; this.drawAmbient(); }
  }

  setStage(stage) {
    this.stage = stage;
    stage.resize(this);
  }

  /** Kampf: Menü-Panel (Höhe h in px, 0 = aus) ersetzt die alten Kampf-Fenster im unteren Teil des Spielbilds. */
  setBattleSheet(h) {
    this.battleSheet = h;
  }

  safeBottom() { return parseFloat(getComputedStyle(this.probe).paddingBottom) || 0; }

  /** Aktuelles Spielbild als Pixeldaten (höchstens einmal pro Bildschirm-Bild ausgelesen). */
  frameData() {
    if (this.tap.locked) {
      const d = this.tap.data(this.frameNo);
      if (d) return d;
    }
    return this._slowFrame();
  }

  /** Alter Weg: Canvas des Emulators auslesen (wartet auf die Grafikkarte, deshalb nur als Notbehelf). */
  _slowFrame() {
    if (this._fdNo !== this.frameNo || !this._fd) {
      this.sctx.drawImage(this.src, 0, 0, GBA_W, GBA_H);
      this._fd = this.sctx.getImageData(0, 0, GBA_W, GBA_H);
      this._fdNo = this.frameNo;
    }
    return this._fd;
  }

  /** Quelle des Spielbilds zum Zeichnen: direkt aus dem Speicher des Emulators, sonst dessen Canvas. */
  liveSrc() {
    if (this.tap.locked) {
      const c = this.tap.canvas(this.frameNo);
      if (c) return c;
    }
    return this.src;
  }

  /** Spielbild für die Bühne: schwarze Raumränder (falls erkannt) durchsichtig. */
  getFrameImage() {
    const live = this.liveSrc();
    if (!this.maskActive) return live;
    const c = this.maskedCtx;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, GBA_W, GBA_H);
    c.drawImage(live, 0, 0);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(this.maskCv, 0, 0);
    c.globalCompositeOperation = 'source-over';
    return this.maskedCv;
  }

  // ---------- Geometrie ----------
  resize() {
    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    this.W = W;
    this.H = H;
    const portrait = H >= W * 1.05;
    let gw, gh;
    if (portrait) {
      gw = W;
      gh = (W * GBA_H) / GBA_W;
    } else {
      gh = H;
      gw = (H * GBA_W) / GBA_H;
      if (gw > W) { gw = W; gh = (W * GBA_H) / GBA_W; }
    }
    // Vertikale Lage: etwas oberhalb der Mitte, damit unten Platz für Daumen bleibt
    let top;
    if (portrait) {
      const safeTop = parseFloat(getComputedStyle(this.probe).paddingTop) || 0;
      top = (H - gh) * 0.4;
      top = Math.max(top, safeTop + 56);
      top = Math.min(top, H - gh - 120);
      top = Math.max(top, 0);
    } else {
      top = (H - gh) / 2;
    }
    this.base = { x: (W - gw) / 2, y: top, w: gw, h: gh };
    this.portrait = portrait;

    // Auflösung der Zeichenfläche (für den größten Zoom, damit nichts matschig wird)
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const zmax = Math.max(1, this.zoomSetting);
    const pw = Math.min(2200, Math.max(GBA_W, Math.round(gw * zmax * dpr)));
    const ph = Math.round((pw * GBA_H) / GBA_W);
    if (this.view.width !== pw || this.view.height !== ph) {
      this.view.width = pw;
      this.view.height = ph;
    }
    const k = Math.max(1, Math.ceil(pw / GBA_W));
    this.tmp.width = GBA_W * k;
    this.tmp.height = GBA_H * k;

    // CSS-Größe der Zeichenfläche: Basisgröße * zmax, wird per Transform auf den Zoom skaliert
    this.zmax = zmax;
    this.view.style.width = gw * zmax + 'px';
    this.view.style.height = gh * zmax + 'px';
    this.view.style.left = this.base.x - (gw * (zmax - 1)) / 2 + 'px';
    this.view.style.top = this.base.y - (gh * (zmax - 1)) / 2 + 'px';

    // Ambient-Zeichenfläche: klein, wird per CSS weich hochskaliert
    const as = 6; // CSS-Pixel pro Ambient-Pixel
    this.amb.width = Math.max(8, Math.ceil(W / as));
    this.amb.height = Math.max(8, Math.ceil(H / as));
    this.ambScale = this.amb.width / W;

    if (this.stage) this.stage.resize(this);
    this._applyZoom(true);
    this._publish();
    this.drawAmbient();
  }

  setZoomSetting(z) {
    this.zoomSetting = z;
    this.resize();
  }

  setEdgeKey(on) {
    on = !!on;
    if (on === this.edgeOn) return;
    this.edgeOn = on;
    if (!on) this.maskActive = false;
  }

  /**
   * Sucht schwarze Flächen, die vom Bildrand aus zusammenhängen (= Raum kleiner als der Bildschirm).
   * Sie werden im Spielbild durchsichtig; der Hintergrund bekommt dort eine abgedunkelte
   * Fortsetzung der angrenzenden Farben statt Schwarz.
   */
  _scanEdges() {
    const W = GBA_W, H = GBA_H, N = W * H;
    const d = this.frameData().data;
    const m = this.edgeM;
    m.fill(0);
    const st = this.edgeQ;
    let sp = 0;
    // Läuft die Bühne, gelten nur Pixel als leer, die auch in der gezeichneten Karte leer sind (wichtig beim Ein-/Ausblenden)
    const vm = this.stage ? this.stage.voidFlags() : null;
    const black = vm
      ? (i) => vm[i] === 1 && d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] <= 9
      : (i) => d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] <= 9;
    const push = (i) => {
      if (m[i] === 0 && black(i)) { m[i] = 1; st[sp++] = i; }
    };
    for (let x = 0; x < W; x++) { push(x); push(N - W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    let count = 0;
    while (sp > 0) {
      const i = st[--sp];
      count++;
      const x = i % W;
      if (x > 0) push(i - 1);
      if (x < W - 1) push(i + 1);
      if (i >= W) push(i - W);
      if (i < N - W) push(i + W);
    }
    // Zu wenig (normales Bild) oder fast alles (Ein-/Ausblenden): nichts ersetzen
    if (count < N * 0.025 || count > N * 0.97) {
      this.maskActive = false;
      return;
    }
    // Maske (Alpha 0 = durchsichtig)
    const mi = this.maskImg.data;
    for (let i = 0; i < N; i++) mi[i * 4 + 3] = m[i] ? 0 : 255;
    this.mctx.putImageData(this.maskImg, 0, 0);
    // Fortsetzung: Farbe des nächsten nicht-schwarzen Pixels, leicht abgedunkelt
    const fd = this.fillImg.data;
    const v = this.edgeV;
    const q = this.edgeQ; // der Stapel wird nicht mehr gebraucht
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) {
      if (!m[i]) {
        v[i] = 1;
        fd[i * 4] = d[i * 4]; fd[i * 4 + 1] = d[i * 4 + 1]; fd[i * 4 + 2] = d[i * 4 + 2]; fd[i * 4 + 3] = 255;
        q[tail++] = i;
      } else v[i] = 0;
    }
    const grow = (i, j) => {
      if (v[j] === 0) {
        v[j] = 1;
        fd[j * 4] = fd[i * 4]; fd[j * 4 + 1] = fd[i * 4 + 1]; fd[j * 4 + 2] = fd[i * 4 + 2]; fd[j * 4 + 3] = 255;
        q[tail++] = j;
      }
    };
    while (head < tail) {
      const i = q[head++];
      const x = i % W;
      if (x > 0) grow(i, i - 1);
      if (x < W - 1) grow(i, i + 1);
      if (i >= W) grow(i, i - W);
      if (i < N - W) grow(i, i + W);
    }
    for (let i = 0; i < N; i++) {
      if (m[i]) {
        fd[i * 4] = fd[i * 4] * 0.7; fd[i * 4 + 1] = fd[i * 4 + 1] * 0.7; fd[i * 4 + 2] = fd[i * 4 + 2] * 0.7;
      }
    }
    this.fctx.putImageData(this.fillImg, 0, 0);
    this.maskActive = true;
  }

  /** Zoom-Ziel setzen (1 = volle Breite). */
  setZoomTarget(active) {
    // Im Querformat füllt das Bild schon die ganze Höhe: kein Zoom
    // Kleine Innenräume: so weit heranzoomen, dass der Raum die Breite füllt (Stage meldet den Wert)
    const extra = this.worldOn && this.stage ? this.stage.interiorZoom || 1 : 1;
    this.zoomTarget = active && this.portrait ? Math.max(this.zoomSetting, extra) : 1;
  }

  _applyZoom(force) {
    const z = this.zoom;
    const dy = this.shiftY;
    this.view.style.transform = `translate(0px, ${dy}px) scale(${z / this.zmax})`;
    const b = this.base;
    const w = b.w * z;
    const h = b.h * z;
    this.rect = { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2 + dy, w, h };
    if (!force) this._publish();
  }

  _publish() {
    const r = this.rect;
    const s = this.root.style;
    s.setProperty('--game-x', r.x + 'px');
    s.setProperty('--game-y', r.y + 'px');
    s.setProperty('--game-w', r.w + 'px');
    s.setProperty('--game-h', r.h + 'px');
    s.setProperty('--sheet-top', r.y + r.h * 0.7 + 'px');
    s.setProperty('--game-bottom', this.base.y + this.base.h + 'px');
    s.setProperty('--game-top', this.base.y + 'px');
    s.setProperty('--vw', this.W + 'px');
    s.setProperty('--vh', this.H + 'px');
    for (const fn of this.listeners) fn(this);
  }

  /** CSS-Koordinaten -> GBA-Pixel; null, falls außerhalb des Spielbilds. */
  toGba(cx, cy, clamp = false) {
    const r = this.rect;
    let x = ((cx - r.x) / r.w) * GBA_W;
    let y = ((cy - r.y) / r.h) * GBA_H;
    const inside = x >= 0 && y >= 0 && x < GBA_W && y < GBA_H;
    if (!inside && !clamp) return null;
    return { x, y, inside };
  }

  /** GBA-Rechteck -> CSS-Rechteck */
  fromGbaRect(g) {
    const r = this.rect;
    const sx = r.w / GBA_W;
    const sy = r.h / GBA_H;
    return { x: r.x + g.x * sx, y: r.y + g.y * sy, w: g.w * sx, h: g.h * sy };
  }

  // ---------- Zeichnen ----------
  start() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this._loop);
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    this.frameNo++;
    this.tap.tick(this.frameNo, src_ok(this.src));
    // Zoom und Lage sanft nachführen
    let wantShift = 0;
    // Kurze Pausen der Bühne (Kartenwechsel, Überblendung, Menü) lassen das Bild nicht hin- und herrutschen
    const st = this.stage;
    const keep = !this.worldOn && st && st.transient && performance.now() - st.lastActive < 2500;
    if ((this.worldOn || keep) && !(this.battleSheet > 0)) wantShift = this.H * this.worldAnchor - (this.base.y + this.base.h / 2);
    else if (this.battleSheet > 0) {
      // Panel oben auf Höhe der Zeile 112 des Spielbilds; Spielbild darüber (aber unter der Statusleiste)
      const h = this.base.h * this.zoom;
      const sheetTop = this.H - this.battleSheet - this.safeBottom();
      let top = sheetTop - h * 0.7;
      const safeTop = parseFloat(getComputedStyle(this.probe).paddingTop) || 0;
      top = Math.max(top, safeTop + 54);
      wantShift = top - (this.base.y + (this.base.h - h) / 2);
    }
    // Ist das Spielbild gerade schwarz (Überblendung), darf Lage und Zoom sofort umspringen
    if (st && st.blackish && (this.zoom !== this.zoomTarget || this.shiftY !== wantShift)) {
      this.zoom = this.zoomTarget;
      this.shiftY = wantShift;
      this._applyZoom(false);
    }
    const d = this.zoomTarget - this.zoom;
    const ds = wantShift - this.shiftY;
    let relayout = false;
    if (Math.abs(d) > 0.002) { this.zoom += d * 0.14; relayout = true; }
    else if (this.zoom !== this.zoomTarget) { this.zoom = this.zoomTarget; relayout = true; }
    if (Math.abs(ds) > 0.4) { this.shiftY += ds * 0.2; relayout = true; }
    else if (this.shiftY !== wantShift) { this.shiftY = wantShift; relayout = true; }
    if (relayout) this._applyZoom(false);
    // Raumränder: bei aktiver Maske jedes Bild prüfen (Kamera scrollt), sonst alle 4 Bilder
    if (this.battleOwn) { this.maskActive = false; }
    else if (this.edgeOn && this.ambientOn && src_ok(this.src) && (this.maskActive || this.frameNo % 4 === 0)) this._scanEdges();
    else if (!this.edgeOn || !this.ambientOn) this.maskActive = false;
    // Erweiterte Karte (Bühne) oder altes Bild mit weichem Rand
    const tw0 = performance.now();
    const world = this.stage ? this.stage.update(this) : false;
    if (this.battleOwn) {
      // Kampf in der App: die Kampfansicht deckt alles ab (und liest das Spielbild selbst)
      if (this.battle) this.battle.update(this);
      if (this.textLayer) this.textLayer.update(this);
      if (world !== this.worldOn) {
        this.worldOn = world;
        this.view.style.visibility = world ? 'hidden' : '';
        this.stage.cv.style.visibility = world ? 'visible' : 'hidden';
        this.root.classList.toggle('world-on', world);
      }
      return;
    }
    let ambNow = false;
    if (world !== this.worldOn) {
      this.worldOn = world;
      ambNow = !world; // Rückfall auf die Normalansicht: der Hintergrund muss sofort stimmen
      this.view.style.visibility = world ? 'hidden' : '';
      this.stage.cv.style.visibility = world ? 'visible' : 'hidden';
      this.root.classList.toggle('world-on', world);
    }
    if (world) {
      this.stage.draw(this);
      this.stage.perf(performance.now() - tw0);
      if (this.stage.dirtyOut) this.stage.draw(this); // Qualitätsstufe gewechselt: Zeichenfläche wurde geleert
    }
    else this.draw();
    if (this.battle) this.battle.update(this);
    if (this.textLayer) this.textLayer.update(this);
    // Läuft die Bühne, verdeckt sie den Hintergrund ganz: er wird dann nicht neu gezeichnet
    if (this.ambientOn && (ambNow || (!world && (this.frameNo % 3 === 0 || relayout)))) this.drawAmbient();
  }

  draw() {
    const { ctx, tctx, view, tmp } = this;
    if (this.src.width === 0) return;
    const src = this.liveSrc();
    if (this.smooth) {
      // "Scharf-bilinear": erst ganzzahlig vergrößern (harte Pixelkanten),
      // dann weich auf die genaue Größe verkleinern. So flimmern Pixel nicht.
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(src, 0, 0, tmp.width, tmp.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, 0, 0, view.width, view.height);
    } else {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, view.width, view.height);
    }
    if (this.maskActive) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.maskCv, 0, 0, view.width, view.height);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /**
   * Rand: das Spielbild wird über seinen Rand hinaus gespiegelt fortgesetzt
   * (abwechselnd gespiegelt, damit die Farben an der Naht genau passen),
   * dann per CSS weichgezeichnet. Dazu ein Verlauf nach außen ins Dunkle.
   */
  drawAmbient() {
    const c = this.actx;
    const a = this.amb;
    const k = this.ambScale;
    if (this.src.width === 0) return;
    const src = this.maskActive ? this.fillCv : this.liveSrc();
    const r = this.rect;
    const x = r.x * k, y = r.y * k, w = r.w * k, h = r.h * k;

    c.fillStyle = '#04100b';
    c.fillRect(0, 0, a.width, a.height);
    c.imageSmoothingEnabled = true;

    // Mitte
    c.drawImage(src, 0, 0, GBA_W, GBA_H, x, y, w, h);

    // nach oben
    let yy = y;
    let flip = true;
    while (yy > 0) {
      c.save();
      if (flip) { c.translate(x, yy); c.scale(1, -1); c.drawImage(src, 0, 0, GBA_W, GBA_H, 0, 0, w, h); }
      else { c.drawImage(src, 0, 0, GBA_W, GBA_H, x, yy - h, w, h); }
      c.restore();
      yy -= h;
      flip = !flip;
    }
    // nach unten
    yy = y + h;
    flip = true;
    while (yy < a.height) {
      c.save();
      if (flip) { c.translate(x, yy + h); c.scale(1, -1); c.drawImage(src, 0, 0, GBA_W, GBA_H, 0, 0, w, h); }
      else { c.drawImage(src, 0, 0, GBA_W, GBA_H, x, yy, w, h); }
      c.restore();
      yy += h;
      flip = !flip;
    }
    // nach links / rechts (Querformat, Zoom)
    if (x > 0.5) {
      let xx = x;
      flip = true;
      while (xx > 0) {
        c.save();
        if (flip) { c.translate(xx, y); c.scale(-1, 1); c.drawImage(src, 0, 0, GBA_W, GBA_H, 0, 0, w, h); }
        else { c.drawImage(src, 0, 0, GBA_W, GBA_H, xx - w, y, w, h); }
        c.restore();
        xx -= w;
        flip = !flip;
      }
      xx = x + w;
      flip = true;
      while (xx < a.width) {
        c.save();
        if (flip) { c.translate(xx + w, y); c.scale(-1, 1); c.drawImage(src, 0, 0, GBA_W, GBA_H, 0, 0, w, h); }
        else { c.drawImage(src, 0, 0, GBA_W, GBA_H, xx, y, w, h); }
        c.restore();
        xx += w;
        flip = !flip;
      }
    }

    // Verlauf ins Dunkle, nach außen stärker
    const topEdge = Math.max(0, y);
    if (topEdge > 0) {
      const g = c.createLinearGradient(0, topEdge, 0, 0);
      g.addColorStop(0, 'rgba(2,10,7,0.30)');
      g.addColorStop(1, 'rgba(2,10,7,0.80)');
      c.fillStyle = g;
      c.fillRect(0, 0, a.width, topEdge);
    }
    const botEdge = Math.min(a.height, y + h);
    if (botEdge < a.height) {
      const g = c.createLinearGradient(0, botEdge, 0, a.height);
      g.addColorStop(0, 'rgba(2,10,7,0.30)');
      g.addColorStop(1, 'rgba(2,10,7,0.88)');
      c.fillStyle = g;
      c.fillRect(0, botEdge, a.width, a.height - botEdge);
    }
    if (x > 0.5) {
      let g = c.createLinearGradient(x, 0, 0, 0);
      g.addColorStop(0, 'rgba(2,10,7,0.30)');
      g.addColorStop(1, 'rgba(2,10,7,0.85)');
      c.fillStyle = g;
      c.fillRect(0, 0, x, a.height);
      g = c.createLinearGradient(x + w, 0, a.width, 0);
      g.addColorStop(0, 'rgba(2,10,7,0.30)');
      g.addColorStop(1, 'rgba(2,10,7,0.85)');
      c.fillStyle = g;
      c.fillRect(x + w, 0, a.width - x - w, a.height);
    }
  }
}
