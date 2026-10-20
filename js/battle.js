// Kampfansicht über den ganzen Bildschirm.
//
// Im Kampf zeichnet das Spiel (wenn die App es per Steuerbyte verlangt, siehe touch_battle.c) nur noch die Sprites -
// Pokémon, Trainer, Bälle und Attacken-Effekte - auf einem magentafarbenen Grund. Die App
//   - stanzt das Magenta aus und legt die Sprites über eine eigene Kulisse (scenery.js), die den ganzen Bildschirm füllt,
//   - zeichnet die Statuskarten (Name, Level, KP, Erfahrung, Status ...) aus den Zahlen, die das Spiel meldet,
//   - zeigt das Level-Up-Fenster als Karte (Zahlen vom Spiel),
//   - lässt die Meldungen als Karte im Stil der Oberfläche von der Textebene (textlayer.js) zeichnen.
// Fenster, die die App nicht kennt (Kampfarena, Link-Kämpfe), bleiben beim Original: dann meldet das Spiel active = 0.

import { decodeGameString } from './data.js';
import { drawStatic, drawDynamic, drawWeather } from './scenery.js';

const GBA_W = 240;
const GBA_H = 160;
const BT_DOUBLE = 1 << 0;
const BT_SAFARI = 1 << 7;

// Kampfkarten: Statuszeichen
const STATUS = [null, ['SCHLAF', '#7b86b8'], ['GIFT', '#a45bc9'], ['BRAND', '#e0643a'], ['FROST', '#5fb6e8'], ['LÄHM', '#c9a21c']];
// Reihenfolge der Werte im Spiel: KP, Angriff, Verteidigung, Initiative, Sp.-Angriff, Sp.-Vert.
const STAT_ROWS = [['KP', 0], ['Angriff', 1], ['Verteidigung', 2], ['Sp.-Angriff', 4], ['Sp.-Vert.', 5], ['Initiative', 3]];

// Plattformen: [Mitte x, Mitte y, Halbbreite, Halbhöhe] in GBA-Pixeln, je Kampfposition (0 Spieler links, 1 Gegner links, 2 Spieler rechts, 3 Gegner rechts)
const PLATS_SINGLE = { 0: [66, 109, 58, 11], 1: [176, 66, 42, 7] };
const PLATS_DOUBLE = { 0: [34, 105, 40, 9], 1: [200, 62, 34, 6.5], 2: [92, 115, 42, 9.5], 3: [152, 54, 30, 6] };

export class Battle {
  /**
   * @param {{world, input, textLayer, root: HTMLElement, mode: () => string}} o
   */
  constructor(o) {
    this.world = o.world;
    this.input = o.input;
    this.textLayer = o.textLayer;
    this.root = o.root;
    this.mode = o.mode;
    this.enabled = true;
    this.on = false;
    this.offN = 0;
    this.forceScene = -1; // Entwickler: Kulisse erzwingen (Konsole: __et.battle.forceScene = 3)
    this.box = document.getElementById('bScene');
    this.bg = document.getElementById('bBg');
    this.dyn = document.getElementById('bDyn');
    this.fadeEl = document.getElementById('bBgFade');
    this.spr = document.getElementById('bSprites');
    this.wx = document.getElementById('bWx');
    this.ui = document.getElementById('bUi');
    this.bgCtx = this.bg.getContext('2d');
    this.dynCtx = this.dyn.getContext('2d');
    this.sprCtx = this.spr.getContext('2d');
    this.wxCtx = this.wx.getContext('2d');
    // 240x160-Zwischenspeicher für die ausgestanzten Sprites
    this.kCv = document.createElement('canvas');
    this.kCv.width = GBA_W;
    this.kCv.height = GBA_H;
    this.kCtx = this.kCv.getContext('2d');
    this.kImg = new ImageData(GBA_W, GBA_H);
    this.k32 = new Uint32Array(this.kImg.data.buffer);
    this.src32 = null;
    this.srcBuf = null;
    this.layKey = '';
    this.lay = null;
    this.bgKey = '';
    this.fadeSel = 0;
    this.fadeKey = '';
    this.animBg = false;
    this.lastDyn = 0;
    this.t0 = performance.now();
    this.huds = [];
    this.hudKey = ['', '', '', ''];
    this.hudPos = ['', '', '', ''];
    this._buildUi();
    this.stats = { frames: 0, opaque: 0 };
  }

  setEnabled(on) {
    this.enabled = !!on;
  }

  // ---------- Oberfläche (Karten) ----------
  _buildUi() {
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'gba-win bhud';
      el.innerHTML = '<div class="bh-top"><b class="bh-name"></b><span class="bh-gen"></span><span class="bh-ball" title="Schon gefangen"></span><span class="bh-lv"></span></div>' +
        '<div class="bh-mid"><span class="bh-kp">KP</span><span class="bh-track"><i></i></span><span class="bh-st"></span></div>' +
        '<div class="bh-bot"><span class="bh-num"></span></div>' +
        '<div class="bh-exp"><i></i></div>';
      this.ui.appendChild(el);
      this.huds.push({
        el,
        name: el.querySelector('.bh-name'),
        gen: el.querySelector('.bh-gen'),
        ball: el.querySelector('.bh-ball'),
        lv: el.querySelector('.bh-lv'),
        bar: el.querySelector('.bh-track i'),
        st: el.querySelector('.bh-st'),
        num: el.querySelector('.bh-num'),
        exp: el.querySelector('.bh-exp i'),
        shown: false,
      });
    }
    const lv = document.createElement('div');
    lv.className = 'gba-win blvl';
    lv.innerHTML = '<div class="bl-head"><b class="bl-name"></b><span class="bl-lv"></span></div><div class="bl-grid"></div>';
    this.ui.appendChild(lv);
    this.lvl = { el: lv, name: lv.querySelector('.bl-name'), lv: lv.querySelector('.bl-lv'), grid: lv.querySelector('.bl-grid'), key: '', shown: false };
  }

  // ---------- Hauptschleife ----------
  /** Pro Bild aufrufen (View._loop), vor TextLayer.update. */
  update(view) {
    const inp = this.input;
    const snap = inp.snap;
    const ok = this.enabled && view.portrait && inp.hasBridge && inp.bridge.base >= 0;
    // Steuerbyte: die Textebene schreibt es (nur, wenn der Grafikspeicher bekannt ist)
    this.textLayer.battleOn = ok;
    const s = this.world.snap;
    const bt = ok && s ? s.battle : null;
    const inB = !!snap && snap.inBattle;
    const want = !!(bt && bt.active && inB && this.textLayer.vramOk);
    if (want) {
      this.offN = 0;
      if (!this.on) this._setOn(true, view);
    } else if (this.on) {
      // kurze Aussetzer (Bildschirmwechsel im Kampf) nicht zeigen; Kampfende sofort
      if (!inB || ++this.offN > 6) this._setOn(false, view);
    }
    if (!this.on) return;
    if (!bt || !want) return;
    this.bt = bt;
    const lay = this._layout(view, bt);
    this._static(lay, bt);
    this._sprites(view, lay);
    this._hud(bt, lay, view);
    this._level(bt);
    this._fade(s);
    this._anim(lay, bt);
  }

  _setOn(on, view) {
    this.on = on;
    this.root.classList.toggle('b-own', on);
    view.setBattleOwn(on);
    if (!on) {
      for (const h of this.huds) { h.el.classList.remove('on'); h.shown = false; }
      this.lvl.el.classList.remove('on');
      this.lvl.shown = false;
      this.hudKey = ['', '', '', ''];
      this.layKey = '';
      this.bgKey = '';
      this.wxCtx.clearRect(0, 0, this.wx.width, this.wx.height);
    } else {
      this.t0 = performance.now();
      this.stats.frames = 0;
    }
  }

  // ---------- Lage ----------
  _layout(view, bt) {
    const W = view.W, H = view.H;
    const safeTop = parseFloat(getComputedStyle(view.probe).paddingTop) || 0;
    const safeBottom = view.safeBottom();
    const dbl = (bt.typeFlags & BT_DOUBLE) !== 0;
    const key = [W, H, safeTop, safeBottom, dbl ? 1 : 0].join(':');
    if (key === this.layKey) return this.lay;
    this.layKey = key;
    const k = W / GBA_W;
    const sheetH = 240 + safeBottom;
    const sheetTop = H - sheetH;
    const top = safeTop + 66;
    const frameH = GBA_H * k;
    const fy = Math.round(top + Math.max(0, (sheetTop - top - frameH) * 0.42));
    const P = dbl ? PLATS_DOUBLE : PLATS_SINGLE;
    const plats = [];
    for (const pos of Object.keys(P)) {
      const q = P[pos];
      plats.push({ x: q[0] * k, y: fy + q[1] * k, rx: q[2] * k, ry: q[3] * k, pos: +pos });
    }
    this.lay = { W, H, k, fy, hy: Math.round(fy + 44 * k), plats, dbl, safeTop, safeBottom, sheetTop };
    // Sprite-Ebene
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ik = Math.max(2, Math.min(6, Math.ceil((W * dpr) / GBA_W)));
    this.ik = ik;
    this.spr.width = GBA_W * ik;
    this.spr.height = GBA_H * ik;
    this.spr.style.left = '0px';
    this.spr.style.top = fy + 'px';
    this.spr.style.width = W + 'px';
    this.spr.style.height = frameH + 'px';
    // Kulissen-Ebenen
    const d = Math.min(dpr, 2);
    for (const [cv, dd] of [[this.bg, d], [this.dyn, Math.min(d, 1.5)], [this.wx, Math.min(d, 1.25)]]) {
      cv.width = Math.round(W * dd);
      cv.height = Math.round(H * dd);
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
    }
    this.bgKey = '';
    return this.lay;
  }

  _scene(bt) {
    return this.forceScene >= 0 ? this.forceScene : bt.scene;
  }

  _static(lay, bt) {
    const sc = this._scene(bt);
    const key = sc + '|' + this.layKey;
    if (key === this.bgKey) return;
    this.bgKey = key;
    const d = this.bg.width / lay.W;
    const c = this.bgCtx;
    c.setTransform(d, 0, 0, d, 0, 0);
    drawStatic(c, lay.W, lay.H, sc, lay);
  }

  _anim(lay, bt) {
    const now = performance.now();
    const t = (now - this.t0) / 1000;
    // Wolken, Wellen, Blasen: 20 Bilder pro Sekunde reichen
    if (now - this.lastDyn > 48) {
      this.lastDyn = now;
      const d = this.dyn.width / lay.W;
      this.dynCtx.setTransform(d, 0, 0, d, 0, 0);
      drawDynamic(this.dynCtx, lay.W, lay.H, this._scene(bt), lay, t);
    }
    const dw = this.wx.width / lay.W;
    this.wxCtx.setTransform(dw, 0, 0, dw, 0, 0);
    drawWeather(this.wxCtx, lay.W, lay.H, t, bt.weather);
  }

  // ---------- Sprites ----------
  _sprites(view, lay) {
    const img = view.frameData();
    if (!img) return;
    if (this.srcBuf !== img.data.buffer) {
      this.srcBuf = img.data.buffer;
      this.src32 = new Uint32Array(img.data.buffer, img.data.byteOffset, GBA_W * GBA_H);
    }
    const src = this.src32, dst = this.k32;
    let opaque = 0;
    for (let i = 0; i < GBA_W * GBA_H; i++) {
      const c = src[i];
      // Magenta (31,0,31) ist der Schlüssel des Spiels
      if ((c & 255) >= 232 && ((c >> 16) & 255) >= 232 && ((c >> 8) & 255) <= 24) dst[i] = 0;
      else { dst[i] = c | 0xff000000; opaque++; }
    }
    this.kCtx.putImageData(this.kImg, 0, 0);
    const c = this.sprCtx;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.spr.width, this.spr.height);
    c.drawImage(this.kCv, 0, 0, this.spr.width, this.spr.height);
    // Attacken-Hintergründe (Ebene 1/2 des Spiels) füllen das ganze Bild: weich einblenden statt Rechteck
    const bgAnim = opaque > GBA_W * GBA_H * 0.34;
    if (bgAnim !== this.animBg) {
      this.animBg = bgAnim;
      this.spr.classList.toggle('animbg', bgAnim);
      this.root.classList.toggle('b-animbg', bgAnim);
    }
    this.stats.opaque = opaque;
    this.stats.frames++;
  }

  // ---------- Überblendung ----------
  _fade(s) {
    // Wie in der Bühne: Am Ende einer Überblendung meldet das Spiel keine Paletten mehr, die zuletzt betroffenen gelten weiter
    if (s.fadeActive && s.fadeSel) this.fadeSel = s.fadeSel;
    else if (!s.fadeY && !s.fadeActive) this.fadeSel = 0;
    let a = 0;
    let col = '#000';
    if (s.fadeY && (this.fadeSel & 0x1fff)) {
      a = Math.min(1, s.fadeY / 16);
      const c = s.fadeColor & 0x7fff;
      const r = (c & 31) << 3, g = ((c >> 5) & 31) << 3, b = ((c >> 10) & 31) << 3;
      col = `rgb(${r},${g},${b})`;
      if (s.fadeMode === 2) col = '#000';
    }
    const key = a.toFixed(3) + col;
    if (key === this.fadeKey) return;
    this.fadeKey = key;
    this.fadeEl.style.background = col;
    this.fadeEl.style.opacity = a;
    this.ui.style.opacity = a > 0 ? 1 - a : '';
  }

  // ---------- Statuskarten ----------
  _hud(bt, lay, view) {
    const safari = (bt.typeFlags & BT_SAFARI) !== 0;
    const dbl = lay.dbl;
    const W = lay.W;
    const cw = dbl ? Math.min(W * 0.5, 206) : Math.min(W * 0.64, 262);
    let nOpp = 0, nPl = 0;
    // Reihenfolge nach Position: Gegner/Spieler links zuerst
    const order = [0, 2, 1, 3];
    for (const i of order) {
      const m = bt.mons[i];
      const h = this.huds[i];
      const isOpp = m.side === 1;
      const visible = i < bt.count && m.shown && (m.level > 0 || (safari && !isOpp));
      if (!visible) {
        if (h.shown) { h.el.classList.remove('on'); h.shown = false; }
        continue;
      }
      const slot = isOpp ? nOpp++ : nPl++;
      const key = [m.species, m.level, m.hp, m.maxHp, m.exp, m.status, m.gender, m.caught ? 1 : 0, m.hasExp ? 1 : 0, safari ? bt.safariBalls : -1, Array.from(m.name).join('.')].join(',');
      if (key !== this.hudKey[i]) {
        this.hudKey[i] = key;
        this._fillHud(h, m, isOpp, safari, bt);
      }
      // Lage
      let x, y;
      const gap = 8;
      if (isOpp) {
        x = 12 + (view.safeLeft || 0);
        y = lay.safeTop + 14 + slot * (64 + gap);
      } else {
        x = W - 12 - cw;
        y = lay.fy + 134 * lay.k + slot * (86 + gap);
        if (dbl) y = lay.fy + 130 * lay.k + slot * (80 + gap);
      }
      const pk = [Math.round(x), Math.round(y), Math.round(cw), isOpp ? 1 : 0].join(':');
      if (pk !== this.hudPos[i]) {
        this.hudPos[i] = pk;
        h.el.style.width = cw + 'px';
        h.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        h.el.classList.toggle('opp', isOpp);
        h.el.classList.toggle('pl', !isOpp);
      }
      if (!h.shown) { h.el.classList.add('on'); h.shown = true; }
    }
  }

  _fillHud(h, m, isOpp, safari, bt) {
    const name = safari && !isOpp ? 'SAFARIBÄLLE' : decodeGameString(m.name) || '???';
    h.name.textContent = name;
    h.gen.textContent = m.gender === 1 ? '♂' : m.gender === 2 ? '♀' : '';
    h.gen.className = 'bh-gen' + (m.gender === 1 ? ' m' : m.gender === 2 ? ' f' : '');
    h.ball.style.display = isOpp && m.caught ? '' : 'none';
    h.lv.textContent = safari && !isOpp ? '' : 'Lv' + m.level;
    const st = STATUS[m.status];
    h.st.textContent = st ? st[0] : '';
    h.st.style.background = st ? st[1] : '';
    h.st.style.display = st ? '' : 'none';
    if (safari && !isOpp) {
      h.el.classList.add('safari');
      h.num.textContent = '× ' + bt.safariBalls;
      return;
    }
    h.el.classList.remove('safari');
    const ratio = m.maxHp > 0 ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0;
    h.bar.style.width = ratio * 100 + '%';
    h.bar.className = ratio > 0.5 ? 'g' : ratio > 0.2 ? 'y' : 'r';
    h.num.textContent = isOpp ? '' : `${m.hp}/${m.maxHp}`;
    h.el.classList.toggle('hasexp', !isOpp && m.hasExp);
    h.exp.style.width = Math.max(0, Math.min(100, (m.exp / 1024) * 100)) + '%';
  }

  // ---------- Level-Up ----------
  _level(bt) {
    const l = bt.lvl;
    const L = this.lvl;
    if (!l || !l.page) {
      if (L.shown) { L.el.classList.remove('on'); L.shown = false; L.key = ''; }
      return;
    }
    const key = [l.page, l.level, l.before.join('.'), l.after.join('.'), Array.from(l.name).join('.')].join('|');
    if (key !== L.key) {
      L.key = key;
      L.name.textContent = decodeGameString(l.name) || '';
      L.lv.textContent = 'Lv' + l.level;
      L.grid.innerHTML = '';
      for (const [label, idx] of STAT_ROWS) {
        const a = l.after[idx], b = l.before[idx];
        const row = document.createElement('div');
        row.className = 'bl-row';
        const d = a - b;
        const val = l.page === 1 ? (d >= 0 ? '+' + d : String(d)) : String(a);
        row.innerHTML = `<span>${label}</span><b class="${l.page === 1 ? 'delta' : ''}">${val}</b>`;
        L.grid.appendChild(row);
      }
    }
    if (!L.shown) { L.el.classList.add('on'); L.shown = true; }
  }
}
