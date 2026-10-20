// Tasten-Verwaltung, Bild-genaue Zeitsteuerung und die "Tippen = Menüpunkt wählen"-Logik.
//
// Die App drückt nie wild Tasten, sondern liest über die TouchBridge, wo der Cursor steht,
// bewegt ihn Schritt für Schritt (mit Kontrolle) zum angetippten Eintrag und bestätigt dann.

import { Bridge, UI, FLAG, START_ACTION } from './bridge.js';

const DIRS = ['Up', 'Down', 'Left', 'Right'];

// Namenseingabe: Tastenfelder auf der Spielseite (Spalte, Zeile)
export const KB_PAGE = { SYMBOLS: 0, UPPER: 1, LOWER: 2 };

// Optionsmenü: wie viele Werte hat jede Zeile
const OPT_COUNTS = [3, 2, 2, 2, 3, 10];

export class Input {
  constructor(emu, hooks = {}) {
    this.emu = emu;
    this.hooks = hooks; // { toast(msg), bridgeFound(), bridgeMissing(), onTick(snap) }
    this.bridge = new Bridge(() => emu.getMemory());
    this.hasBridge = false;
    this.snap = null;
    this.frame = 0; // Spiel-Frames (aus der Bridge) bzw. Zeit-Näherung
    this.tickNo = 0; // Zähler der Takte (ein Takt kann mehrere Spiel-Frames umfassen)
    this.relTick = new Map(); // Taste -> Takt, in dem sie zuletzt losgelassen wurde
    this._lastBridgeFrame = -1;
    this._lastTime = performance.now();
    this.holds = new Map(); // Taste -> Set(Quellen)
    this.keyFree = new Map(); // Taste -> Frame, ab dem ein neuer Tap sicher ankommt
    this.timers = []; // {at, fn}
    this.queue = []; // wartende Makros
    this.running = false; // ein Makro läuft
    this.searching = false;
    this.searchStarted = 0;
    this.stickDir = null;
    this.runWanted = false;
    this._raf = this._tick.bind(this);
    requestAnimationFrame(this._raf);
  }

  // ---------- Bridge finden ----------
  startBridgeSearch() {
    this.hasBridge = false;
    this.bridge.base = -1;
    this.searching = true;
    this.searchStarted = performance.now();
    this._nextSearch = performance.now() + 600;
  }

  _searchStep() {
    const now = performance.now();
    if (now < this._nextSearch) return;
    this._nextSearch = now + 700;
    if (now - this.searchStarted > 20000) {
      this.searching = false; // ROM ohne Bridge: einfacher Modus
      this.hooks.bridgeMissing?.(this.bridge.oldVersion);
      return;
    }
    if (this.bridge.base < 0) {
      this.bridge.find();
    } else if (this.bridge.pending) {
      if (this.bridge.resolve()) this._found();
    }
    if (this.bridge.base >= 0 && !this.bridge.pending) this._found();
  }

  _found() {
    this.searching = false;
    this.hasBridge = true;
    this.hooks.bridgeFound?.();
  }

  // ---------- Takt ----------
  _tick() {
    requestAnimationFrame(this._raf);
    this.tickNo++;
    if (this.searching) this._searchStep();

    const now = performance.now();
    if (this.hasBridge) {
      if (!this.bridge.isValid()) {
        // z. B. nach Reset/Laden eines anderen Stands: neu suchen
        this.startBridgeSearch();
      } else {
        const s = this.bridge.read();
        if (s) {
          if (s.frame !== this._lastBridgeFrame) {
            const d = (s.frame - this._lastBridgeFrame) >>> 0;
            this.frame += this._lastBridgeFrame < 0 || d > 1000 ? 1 : d;
            this._lastBridgeFrame = s.frame;
          }
          this.snap = s;
        }
      }
    } else {
      this.snap = null;
      this.frame += Math.max(0, Math.round((now - this._lastTime) / 16.7));
    }
    this._lastTime = now;

    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.frame);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.frame);
        for (const t of due) t.fn();
      }
    }
    this._applyRun();
    this.hooks.onTick?.(this.snap);
  }

  after(frames, fn) {
    this.timers.push({ at: this.frame + Math.max(1, frames), fn });
  }
  wait(frames) {
    return new Promise((res) => this.after(frames, res));
  }
  /** Wartet, bis pred() wahr ist (max. maxFrames Spiel-Frames). */
  waitUntil(pred, maxFrames = 30) {
    return new Promise((res) => {
      const start = this.frame;
      const t0 = this.tickNo;
      const step = () => {
        if (pred()) return res(true);
        // mindestens 3 Takte warten: bei hoher Geschwindigkeit vergehen pro Takt viele Frames, und eine
        // gerade gedrückte Taste wirkt erst nach ein bis zwei Takten
        if (this.frame - start >= maxFrames && this.tickNo - t0 >= 3) return res(false);
        this.after(1, step);
      };
      step();
    });
  }

  // ---------- Tasten ----------
  down(key, src) {
    let set = this.holds.get(key);
    if (!set) this.holds.set(key, (set = new Set()));
    const first = set.size === 0;
    set.add(src);
    if (first) this.emu.press(key);
  }
  up(key, src) {
    const set = this.holds.get(key);
    if (!set || !set.has(src)) return;
    set.delete(src);
    if (set.size === 0) {
      this.emu.release(key);
      this.relTick.set(key, this.tickNo);
    }
  }
  /**
   * Kurzer Tastendruck (Standard 4 Frames, damit das Spiel ihn sicher sieht).
   * Zwei Taps auf dieselbe Taste bekommen mindestens 2 Frames Pause dazwischen –
   * sonst sieht das Spiel nie eine neue Flanke und der zweite Druck geht verloren.
   */
  tap(key, frames = 4) {
    const src = 'tap' + Math.random();
    const start = Math.max(this.frame, this.keyFree.get(key) || 0);
    this.keyFree.set(key, start + frames + 2);
    const press = () => {
      // Loslassen und Neudrücken im selben Takt (bei hoher Geschwindigkeit mehrere Frames pro Takt) sieht das
      // Spiel nicht als neuen Tastendruck: dann erst im nächsten Takt drücken.
      if (this.relTick.get(key) === this.tickNo) { this.after(1, press); return; }
      this.down(key, src);
      this.after(frames, () => this.up(key, src));
    };
    if (start <= this.frame) press();
    else this.after(start - this.frame, press);
  }
  releaseAll() {
    for (const [key, set] of this.holds) {
      set.clear();
      this.emu.release(key);
    }
    this.stickDir = null;
  }

  // ---------- Stick ----------
  /** dir: 'Up'|'Down'|'Left'|'Right'|null, run: Rennen gewünscht */
  setStick(dir, run) {
    for (const d of DIRS) {
      if (d === dir) this.down(d, 'stick');
      else this.up(d, 'stick');
    }
    this.stickDir = dir;
    this.runWanted = !!dir && !!run;
    this._applyRun();
  }
  _applyRun() {
    // B nur zum Rennen halten, wenn die Figur auch laufen kann – in Menüs würde B abbrechen
    const s = this.snap;
    const canRun = this.runWanted && (!this.hasBridge || (s && s.fieldFree));
    if (canRun) this.down('B', 'run');
    else this.up('B', 'run');
  }

  /** Darf die Spielfigur gerade laufen (oder kennen wir den Zustand nicht)? */
  get canWalk() {
    return !this.hasBridge || !this.snap || this.snap.fieldFree;
  }

  // ---------- Makro-Warteschlange ----------
  /** Führt Makros nacheinander aus. Gibt false zurück, wenn schon zu viel wartet. */
  enqueue(fn, maxQueue = 6) {
    if (this.queue.length >= maxQueue) return false;
    this.queue.push(fn);
    if (!this.running) this._runQueue();
    return true;
  }
  async _runQueue() {
    this.running = true;
    try {
      while (this.queue.length) {
        const fn = this.queue.shift();
        try { await fn(); } catch (e) { console.error(e); }
      }
    } finally {
      this.running = false;
    }
  }
  get busy() { return this.running || this.queue.length > 0; }
  clearQueue() { this.queue.length = 0; }

  // ---------- Menü-Auswahl ----------
  _nextDir(s, target) {
    const n = s.count;
    if (s.cols <= 1) {
      const fwd = (target - s.cursor + n) % n;
      const back = n - fwd;
      if (s.wrap) return back < fwd ? 'Up' : 'Down';
      return target < s.cursor ? 'Up' : 'Down';
    }
    const cc = s.cursor % s.cols, tc = target % s.cols;
    const cr = Math.floor(s.cursor / s.cols), tr = Math.floor(target / s.cols);
    if (tc !== cc) return tc < cc ? 'Left' : 'Right';
    return tr < cr ? 'Up' : 'Down';
  }

  /**
   * Team-Menü: Die Felder liegen nicht in einer Reihe (links groß, rechts eine Spalte,
   * unten Abbrechen). Wir wählen die Richtung nach der Lage der Rechtecke und merken uns
   * Richtungen, bei denen sich der Cursor nicht bewegt hat.
   */
  _partyDir(s, target, blocked) {
    const ok = (r) => r && r.w > 0 && r.h > 0;
    const cur = s.rects[s.cursor], tgt = s.rects[target];
    const order = [];
    if (ok(cur) && ok(tgt)) {
      const dx = tgt.x + tgt.w / 2 - (cur.x + cur.w / 2);
      const dy = tgt.y + tgt.h / 2 - (cur.y + cur.h / 2);
      const curLeft = cur.x + cur.w / 2 < 120;
      const sideways = s.cursor < 6 && target < 6 && ((dx > 30 && curLeft) || (dx < -30 && !curLeft));
      const horiz = dx > 0 ? 'Right' : 'Left';
      const vert = dy > 0 ? 'Down' : 'Up';
      if (sideways) order.push(horiz, vert);
      else order.push(vert, horiz);
    } else {
      order.push('Down', 'Up');
    }
    for (const d of ['Down', 'Up', 'Right', 'Left']) if (!order.includes(d)) order.push(d);
    return order.find((d) => !blocked.has(s.cursor + ':' + d)) || order[0];
  }

  /** Bewegt den Cursor (Schritt für Schritt, mit Kontrolle) auf Eintrag `target`. */
  async selectIndex(target) {
    const blocked = new Set();
    for (let guard = 0; guard < 24; guard++) {
      const s = this.snap;
      if (!s || s.ui === UI.NONE || target >= s.count) return false;
      if (s.cursor === target) return true;
      const before = s.cursor;
      const ui = s.ui;
      let dir;
      if (ui === UI.PARTY) {
        const t = s.rects[target];
        if (!t || t.w <= 0) return false;
        dir = this._partyDir(s, target, blocked);
      } else {
        dir = this._nextDir(s, target);
      }
      this.tap(dir, 3);
      const moved = await this.waitUntil(() => !this.snap || this.snap.ui !== ui || this.snap.cursor !== before, 14);
      if (!moved) {
        // Team-Menü: diese Richtung geht hier nicht. Sonst: Tastendruck wurde verschluckt.
        if (ui === UI.PARTY) blocked.add(before + ':' + dir);
        continue;
      }
      await this.wait(1);
    }
    return false;
  }

  async selectAndConfirm(idx) {
    if (await this.selectIndex(idx)) {
      await this.wait(1);
      this.tap('A');
      return true;
    }
    return false;
  }

  _pickRect(s, gx, gy, tol = 5) {
    let best = -1, bestD = 1e9;
    s.rects.forEach((r, i) => {
      if (r.w <= 0 || r.h <= 0) return; // leerer Platzhalter
      const dx = gx < r.x ? r.x - gx : gx > r.x + r.w ? gx - (r.x + r.w) : 0;
      const dy = gy < r.y ? r.y - gy : gy > r.y + r.h ? gy - (r.y + r.h) : 0;
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD <= tol ? best : -1;
  }

  // ---------- Antippen ----------
  /**
   * Antippen des Spielbilds. gx/gy in GBA-Pixeln (0..239 / 0..159) oder null,
   * wenn neben dem Spielbild getippt wurde.
   * Liefert eine Beschreibung für die Rückmeldung (Aufleuchten).
   */
  handleTap(gx, gy) {
    const s = this.snap;
    const inside = gx != null;
    if (!this.hasBridge || !s || s.ui === UI.NONE) {
      this.tap('A');
      return { kind: 'A' };
    }
    if (s.ui === UI.KEYBOARD) {
      if (!inside) return { kind: 'none' };
      return this._keyboardTap(s, gx, gy);
    }
    if (s.ui === UI.OPTIONS) {
      if (!inside) return { kind: 'none' };
      return this._optionsTap(s, gx, gy);
    }
    if (!inside) return { kind: 'none' };
    const idx = this._pickRect(s, gx, gy);
    if (idx >= 0) {
      if (this.running) return { kind: 'busy' };
      this.enqueue(() => this.selectAndConfirm(idx), 2);
      return { kind: 'select', rect: s.rects[idx], index: idx };
    }
    if (s.outsideB) {
      this.tap('B');
      return { kind: 'B' };
    }
    return { kind: 'none' };
  }

  // ---------- Optionen ----------
  _optionsTap(s, gx, gy) {
    const row = this._pickRect(s, gx, gy, 6);
    if (row < 0) return { kind: 'none' };
    if (this.running) return { kind: 'busy' };
    const rect = s.rects[row];
    if (row === 6) {
      this.enqueue(() => this.selectAndConfirm(6), 2);
      return { kind: 'select', rect, index: row };
    }
    const n = OPT_COUNTS[row];
    // Wert unter dem Finger bestimmen (Werte stehen rechts, ab x = 112)
    let want = -1;
    let step = 0;
    if (gx >= 112) {
      if (row === 5) step = gx < 168 ? -1 : 1;
      else if (n === 2) want = gx < 168 ? 0 : 1;
      else want = Math.max(0, Math.min(2, Math.floor((gx - 112) / (112 / 3))));
    }
    this.enqueue(async () => {
      if (!(await this.selectIndex(row))) return;
      await this.wait(1);
      const cur = () => (this.snap && this.snap.opt ? this.snap.opt.values[row] : -1);
      if (row === 5 && step !== 0) {
        const before = cur();
        this.tap(step < 0 ? 'Left' : 'Right', 3);
        await this.waitUntil(() => cur() !== before, 12);
        return;
      }
      for (let i = 0; i < 4 && want >= 0 && cur() !== want; i++) {
        const before = cur();
        // 3 Werte: Rechts zählt hoch (mit Umlauf); 2 Werte: beide Richtungen schalten um
        const diff = (want - before + n) % n;
        this.tap(diff <= n / 2 ? 'Right' : 'Left', 3);
        await this.waitUntil(() => cur() !== before, 12);
        await this.wait(1);
      }
    }, 2);
    return { kind: 'select', rect, index: row };
  }

  // ---------- Namenseingabe ----------
  /** Bildschirm-Tastatur: Spalte/Zeile -> Taste (GBA-Pixel). */
  _keyboardTap(s, gx, gy) {
    const kb = s.kb;
    if (this.running) return { kind: 'busy' };
    if (gx >= 176) {
      const btn = gy < 104 ? 0 : gy < 128 ? 1 : 2;
      this.enqueue(() => this.kbButton(btn), 3);
      return { kind: 'none' };
    }
    const row = Math.floor((gy - 80) / 16);
    if (row < 0 || row > 3) return { kind: 'none' };
    let best = -1, bd = 1e9;
    kb.colX.forEach((x, i) => { const d = Math.abs(gx - x); if (d < bd) { bd = d; best = i; } });
    if (best < 0 || bd > 14) return { kind: 'none' };
    this.enqueue(() => this.kbKey(best, row), 3);
    return { kind: 'none' };
  }

  /** Cursor auf eine Taste (isBtn=false: Spalte tx, Zeile ty) oder Schaltfläche (isBtn=true: Nummer ty) bewegen. */
  async kbGoto(tx, ty, isBtn) {
    for (let guard = 0; guard < 40; guard++) {
      const s = this.snap;
      if (!s || s.ui !== UI.KEYBOARD) {
        // z. B. während eines Seitenwechsels: kurz warten
        if (!(await this.waitUntil(() => this.snap && this.snap.ui === UI.KEYBOARD, 60))) return false;
        continue;
      }
      const { columns, cx, cy } = s.kb;
      const onBtn = cx >= columns;
      let dir = null;
      if (isBtn) {
        if (!onBtn) dir = 'Right';
        else if (cy !== ty) dir = (ty - cy + 3) % 3 === 1 ? 'Down' : 'Up';
        else return true;
      } else {
        if (onBtn) dir = 'Left';
        else if (cy !== ty) dir = (ty - cy + 4) % 4 <= 2 ? 'Down' : 'Up';
        else if (cx !== tx) dir = tx < cx ? 'Left' : 'Right';
        else return true;
      }
      this.tap(dir, 3);
      const moved = await this.waitUntil(() => {
        const n = this.snap;
        return !n || n.ui !== UI.KEYBOARD || n.kb.cx !== cx || n.kb.cy !== cy;
      }, 14);
      if (moved) await this.wait(1);
    }
    return false;
  }

  /** Eine Taste der Seite drücken (Spalte, Zeile). */
  async kbKey(col, row) {
    if (!(await this.kbGoto(col, row, false))) return false;
    await this.wait(1);
    this.tap('A');
    await this.wait(5);
    return true;
  }

  /** 0 = Seite wechseln, 1 = Löschen, 2 = OK */
  async kbButton(n) {
    if (n === 1) { this.tap('B'); await this.wait(5); return true; }
    if (n === 2) {
      this.tap('Start');
      await this.waitUntil(() => this.snap && this.snap.ui === UI.KEYBOARD && this.snap.kb.cx >= this.snap.kb.columns && this.snap.kb.cy === 2, 20);
      await this.wait(2);
      this.tap('A');
      return true;
    }
    if (!(await this.kbGoto(0, 0, true))) return false;
    await this.wait(1);
    const page = this.snap && this.snap.kb ? this.snap.kb.page : -1;
    this.tap('A');
    await this.waitUntil(() => this.snap && this.snap.ui === UI.KEYBOARD && this.snap.kb.page !== page, 70);
    await this.wait(2);
    return true;
  }

  /** Gewünschte Tastaturseite einstellen (max. 3 Wechsel). */
  async kbSetPage(page) {
    for (let i = 0; i < 3; i++) {
      const s = this.snap;
      if (!s || !s.kb) return false;
      if (s.kb.page === page) return true;
      await this.kbButton(0);
    }
    return !!(this.snap && this.snap.kb && this.snap.kb.page === page);
  }

  // ---------- Schnellzugriff über das Startmenü ----------
  startMenuOpen() { return !!(this.snap && this.snap.startMenu); }

  /** Öffnet das Startmenü (falls nötig) und wählt einen Eintrag. */
  openStartAction(actionId, labelIfMissing) {
    if (!this.hasBridge) { this.hooks.toast?.('Menü-Erkennung ist nicht aktiv'); return false; }
    if (this.running) return false;
    return this.enqueue(async () => {
      this.hooks.veil?.(true);
      let ok = false;
      try {
        ok = await this._openStartActionRun(actionId, labelIfMissing);
      } finally {
        this.hooks.veil?.(false);
        // Das Spiel blendet jetzt aus und der neue Bildschirm ein: das Originalbild bleibt verdeckt, bis die Oberfläche steht
        if (ok) this.hooks.armFor?.(actionId);
      }
    }, 1);
  }

  async _openStartActionRun(actionId, labelIfMissing) {
    {
      let s = this.snap;
      if (!s || !s.startMenu) {
        if (!s || !s.fieldFree) { this.hooks.toast?.('Gerade nicht möglich'); return false; }
        this.tap('Start');
        if (!(await this.waitUntil(() => this.snap && this.snap.startMenu, 45))) return false;
        await this.wait(2);
        s = this.snap;
      }
      const idx = s.startActions.indexOf(actionId);
      if (idx < 0) {
        this.tap('B');
        this.hooks.toast?.((labelIfMissing || 'Das') + ' ist noch nicht freigeschaltet');
        return false;
      }
      await this.selectAndConfirm(idx);
      return true;
    }
  }

  /** "Menü"-Taste: Startmenü auf-/zuklappen */
  /** Schließt alle Menüs und Bildschirme (Taste B, bis die Spielfigur wieder frei ist). */
  closeAll() {
    this.clearQueue();
    return this.enqueue(async () => {
      for (let i = 0; i < 10; i++) {
        const s = this.snap;
        if (!s || s.fieldFree) return;
        if (s.flags & FLAG.IN_BATTLE) return;
        if (s.ui === UI.KEYBOARD) return;
        this.tap('B', 4);
        await this.wait(16);
      }
    }, 2);
  }

  toggleMenu() {
    if (this.startMenuOpen()) this.tap('B');
    else this.tap('Start');
  }
}

export { START_ACTION };
