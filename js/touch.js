// Touch-Gesten auf dem ganzen Bildschirm:
//  - Ziehen = Laufen (schwebender Stick, erscheint dort, wo der Finger aufsetzt)
//  - Ziehen in Menüs = Liste scrollen (wie auf dem Handy üblich), mit Nachlaufen
//  - Antippen = auswählen / bestätigen

const DEAD = 12; // Totzone in CSS-Pixeln
const RADIUS = 58; // Stick-Radius; weiter ziehen schiebt den Mittelpunkt mit
const RUN_AT = 46; // ab dieser Auslenkung wird gerannt (Modus "Weit ziehen")
const MOVE_SLOP = 10; // ab hier gilt eine Berührung als Ziehen, nicht als Tippen

export class Touch {
  /**
   * @param {{layer: HTMLElement, stick: HTMLElement, knob: HTMLElement, input: any, settings: any,
   *          onTap: (x:number,y:number)=>void, scrollStep: ()=>{x:number,y:number}, onFirstDrag?: ()=>void}} o
   */
  constructor(o) {
    Object.assign(this, o);
    this.id = null;
    this.g = null; // laufende Geste
    this._bind();
  }

  _bind() {
    const l = this.layer;
    l.addEventListener('pointerdown', (e) => this._down(e));
    l.addEventListener('pointermove', (e) => this._move(e));
    l.addEventListener('pointerup', (e) => this._up(e));
    l.addEventListener('pointercancel', (e) => this._cancel(e));

    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Tastatur (zum Testen am PC)
    const map = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', w: 'Up', s: 'Down', a: 'Left', d: 'Right', z: 'A', x: 'B', Enter: 'Start', Backspace: 'Select', y: 'A' };
    addEventListener('keydown', (e) => {
      const k = map[e.key] || map[e.key.toLowerCase?.()];
      if (!k || e.repeat) return;
      this.input.down(k, 'kbd');
      e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      const k = map[e.key] || map[e.key.toLowerCase?.()];
      if (k) this.input.up(k, 'kbd');
    });
  }

  // ---------- Stick-Anzeige ----------
  _showStick(x, y) {
    this.stick.style.transform = `translate(${x}px,${y}px)`;
    this.stick.classList.add('show');
    this.knob.style.transform = 'translate(0px,0px)';
  }
  _hideStick() {
    this.stick.classList.remove('show', 'run');
  }

  // ---------- Geste ----------
  _down(e) {
    if (this.id !== null) return;
    this.id = e.pointerId;
    this.layer.setPointerCapture(e.pointerId);
    this.input.clearQueue?.();
    this.g = {
      x0: e.clientX, y0: e.clientY,
      x: e.clientX, y: e.clientY,
      ox: e.clientX, oy: e.clientY, // Mittelpunkt des Sticks
      t0: performance.now(),
      moved: false,
      dir: null,
      ax: 0, ay: 0, // aufgelaufene Wischstrecke
      samples: [{ t: performance.now(), y: e.clientY, x: e.clientX }],
      mode: null, // 'stick' | 'scroll'
      scrolled: false,
    };
  }

  _move(e) {
    const g = this.g;
    if (!g || e.pointerId !== this.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.x = e.clientX;
    g.y = e.clientY;
    const now = performance.now();
    g.samples.push({ t: now, y: e.clientY, x: e.clientX });
    if (g.samples.length > 8) g.samples.shift();
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > MOVE_SLOP) {
      g.moved = true;
      this.onFirstDrag?.();
    }
    if (!g.moved) return;

    if (this.input.canWalk) {
      if (g.mode !== 'stick') {
        g.mode = 'stick';
        g.ox = g.x0; g.oy = g.y0;
        g.ax = g.ay = 0;
        this._showStick(g.ox, g.oy);
      }
      this._stick(e);
    } else {
      if (g.mode === 'stick') {
        this.input.setStick(null, false);
        this._hideStick();
      }
      g.mode = 'scroll';
      this._scroll(dx, dy);
    }
  }

  _stick(e) {
    const g = this.g;
    let vx = e.clientX - g.ox;
    let vy = e.clientY - g.oy;
    let len = Math.hypot(vx, vy);
    if (len > RADIUS) {
      // Mittelpunkt wandert mit dem Finger: Richtungswechsel bleiben schnell
      const k = (len - RADIUS) / len;
      g.ox += vx * k;
      g.oy += vy * k;
      this.stick.style.transform = `translate(${g.ox}px,${g.oy}px)`;
      vx = vx * (RADIUS / len);
      vy = vy * (RADIUS / len);
      len = RADIUS;
    }
    this.knob.style.transform = `translate(${vx}px,${vy}px)`;

    let dir = null;
    if (len >= DEAD) {
      const ax = Math.abs(vx), ay = Math.abs(vy);
      // Hysterese: bei fast gleicher Auslenkung bleibt die bisherige Achse
      const horiz = g.dir === 'Left' || g.dir === 'Right';
      const vert = g.dir === 'Up' || g.dir === 'Down';
      let useX;
      if (horiz) useX = ax * 1.25 >= ay;
      else if (vert) useX = ax > ay * 1.25;
      else useX = ax >= ay;
      dir = useX ? (vx < 0 ? 'Left' : 'Right') : vy < 0 ? 'Up' : 'Down';
    }
    g.dir = dir;
    const mode = this.settings.run;
    const run = dir && (mode === 'always' || (mode === 'drag' && len >= RUN_AT));
    this.stick.classList.toggle('run', !!run);
    this.input.setStick(dir, run);
  }

  _scroll(dx, dy) {
    const g = this.g;
    const step = this.scrollStep();
    g.ax += dx;
    g.ay += dy;
    // Finger nach oben = Inhalt rückt nach oben = Cursor wandert nach unten
    while (Math.abs(g.ay) >= step.y) {
      this.input.tap(g.ay < 0 ? 'Down' : 'Up', 3);
      g.ay -= Math.sign(g.ay) * step.y;
      g.scrolled = true;
    }
    while (Math.abs(g.ax) >= step.x) {
      this.input.tap(g.ax < 0 ? 'Right' : 'Left', 3);
      g.ax -= Math.sign(g.ax) * step.x;
      g.scrolled = true;
    }
  }

  _up(e) {
    const g = this.g;
    if (!g || e.pointerId !== this.id) return;
    this.id = null;
    this.g = null;
    if (g.mode === 'stick') {
      this.input.setStick(null, false);
      this._hideStick();
      return;
    }
    const dt = performance.now() - g.t0;
    if (!g.moved && dt < 600) {
      this.onTap?.(e.clientX, e.clientY);
      return;
    }
    if (g.mode === 'scroll') this._fling(g);
  }

  /** Nachlaufen nach schnellem Wischen (wie ein angeschubstes Listenrad). */
  _fling(g) {
    const s = g.samples;
    if (s.length < 2) return;
    const a = s[0], b = s[s.length - 1];
    const dt = b.t - a.t;
    if (dt < 10 || performance.now() - b.t > 120) return;
    const step = this.scrollStep();
    const vy = (b.y - a.y) / dt; // px/ms
    const vx = (b.x - a.x) / dt;
    const useY = Math.abs(vy) * 1.3 >= Math.abs(vx);
    const v = useY ? vy : vx;
    const pitch = useY ? step.y : step.x;
    if (Math.abs(v) < 0.55) return;
    const n = Math.min(14, Math.floor((Math.abs(v) * 260) / pitch));
    const key = useY ? (v < 0 ? 'Down' : 'Up') : v < 0 ? 'Right' : 'Left';
    // zunehmend langsamer werdende Schritte
    let gap = 3;
    let at = 0;
    for (let i = 0; i < n; i++) {
      at += gap;
      gap = Math.min(9, gap + (i % 2 === 0 ? 1 : 0));
      this.input.after(at, () => this.input.tap(key, 2));
    }
  }

  _cancel(e) {
    if (e.pointerId !== this.id) return;
    if (this.g && this.g.mode === 'stick') {
      this.input.setStick(null, false);
      this._hideStick();
    }
    this.id = null;
    this.g = null;
  }
}
