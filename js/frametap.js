// Bildabgriff: liest das fertige Spielbild (240x160) direkt aus dem Speicher des Emulators.
//
// Der Emulator legt jedes Bild zuerst in einem Puffer im WASM-Heap ab und kopiert es dann in sein Canvas (WebGL).
// Das Canvas auszulesen (drawImage + getImageData) zwingt den Browser, auf die Grafikkarte zu warten – das kostet je
// nach Gerät mehrere Millisekunden bis Zehntelsekunden und ist die häufigste Ursache für Ruckler. Aus dem Heap
// lesen wir dasselbe Bild ohne jede Wartezeit.
//
// Die Adresse des Puffers ist nicht fest. Wir suchen sie einmal (in kleinen Scheiben, damit kein Bild stehen bleibt),
// indem wir eine Pixelzeile des Canvas im Heap wiederfinden. Kandidaten müssen sich danach in einer Probezeit
// gemeinsam mit dem Canvas verändern (ein alter Puffer bliebe stehen) und werden später regelmäßig geprüft.
// Gelingt das nicht, bleibt alles beim alten Weg über das Canvas.

const GW = 240;
const GH = 160;
const NPX = GW * GH;
const NS = Math.ceil(NPX / 7); // Stichprobenpunkte
const HINT_KEY = 'smaragd.tapBase';

export class FrameTap {
  /**
   * @param {{getMemory: () => (WebAssembly.Memory|null)}} emu
   * @param {() => ImageData} slow  liest das Bild über das Canvas (alter Weg)
   */
  constructor(emu, slow) {
    this.emu = emu;
    this.slow = slow;
    this.base = -1; // Byte-Adresse des Puffers im Heap
    this.locked = false;
    this.img = new ImageData(GW, GH);
    this.dst32 = new Uint32Array(this.img.data.buffer);
    this.cv = document.createElement('canvas');
    this.cv.width = GW;
    this.cv.height = GH;
    this.ctx = this.cv.getContext('2d');
    this._buf = null;
    this._u32 = null;
    this._no = -1;
    this._cvNo = -1;
    this.job = null; // laufende Suche
    this.settle = null; // erstes Bild für die Musterwahl
    this.prob = null; // Probezeit
    this.nextTry = 20; // Bildnummer, ab der gesucht wird
    this.tries = 0;
    this.checkAt = 0;
    this.fails = 0;
    this.lastV = null;
    this.hint = null;
    try {
      const h = parseInt(localStorage.getItem(HINT_KEY) || '', 10);
      if (h > 0) this.hint = h;
    } catch (e) {}
    this.why = 'init';
  }

  _heap() {
    const m = this.emu.getMemory();
    if (!m) return null;
    const b = m.buffer;
    if (b !== this._buf) {
      this._buf = b;
      this._u32 = new Uint32Array(b);
    }
    return this._u32;
  }

  /** Pro Bild einmal aufrufen (vor dem ersten Zugriff). */
  tick(frameNo, run) {
    if (this.locked) {
      if (frameNo >= this.checkAt) this._verify(frameNo);
      return;
    }
    if (this.prob) { this._probe(frameNo); return; }
    if (!run || frameNo < this.nextTry) return;
    if (!this.job) this._begin(frameNo);
    if (this.job) this._step(frameNo);
  }

  // ---------- Zugriff ----------
  /** Bildpunkte als ImageData (RGBA), für Bild frameNo höchstens einmal kopiert. */
  data(frameNo) {
    if (this._no !== frameNo) {
      const u = this._heap();
      const s = this.base >> 2;
      if (!u || s + NPX > u.length) {
        this.locked = false;
        return null;
      }
      const d = this.dst32;
      for (let i = 0; i < NPX; i++) d[i] = u[s + i] | 0xff000000;
      this._no = frameNo;
    }
    return this.img;
  }

  /** Das Bild als Canvas (für drawImage). */
  canvas(frameNo) {
    const im = this.data(frameNo);
    if (!im) return null;
    if (this._cvNo !== frameNo) {
      this.ctx.putImageData(im, 0, 0);
      this._cvNo = frameNo;
    }
    return this.cv;
  }

  // ---------- Suche ----------
  _begin(frameNo) {
    // Gemerkte Adresse zuerst probieren (der Heap ist bei jedem Start gleich aufgebaut)
    if (this.hint && this.tries === 0) {
      this.tries++;
      this._startProbe([this.hint], frameNo, 'Hinweis');
      return;
    }
    // Zwei Bilder im Abstand weniger Frames: nur Stellen, die in beiden gleich sind, taugen als Suchmuster
    if (!this.settle) {
      this.settle = { ref: this.slow().data };
      this.nextTry = frameNo + 6;
      return;
    }
    const ref0 = this.settle.ref;
    this.settle = null;
    const ref = this.slow().data;
    // Fenster aus 16 Bildpunkten einer Zeile mit möglichst vielen verschiedenen Farben wählen (sonst gibt es zu viele Treffer)
    let pick = null, bestN = 3;
    const L = 16;
    for (let y = 8; y < GH - 8; y += 2) {
      for (let x0 = 0; x0 + L <= GW; x0 += 4) {
        const seen = new Set();
        let same = true;
        for (let x = 0; x < L; x++) {
          const i = (y * GW + x0 + x) * 4;
          const v = ref[i] | (ref[i + 1] << 8) | (ref[i + 2] << 16);
          if (v !== (ref0[i] | (ref0[i + 1] << 8) | (ref0[i + 2] << 16))) { same = false; break; }
          seen.add(v);
        }
        if (!same) continue;
        if (seen.size > bestN) {
          bestN = seen.size;
          pick = { y, x0 };
        }
      }
      if (bestN >= 8) break;
    }
    if (!pick) { this.nextTry = frameNo + 20; this.why = 'bild einfarbig'; return; }
    pick.t = [];
    for (let x = 0; x < L; x++) {
      const i = (pick.y * GW + pick.x0 + x) * 4;
      pick.t.push(ref[i] | (ref[i + 1] << 8) | (ref[i + 2] << 16));
    }
    this.job = { pick, pos: 0, hits: [] };
    this.why = 'suche';
  }

  _step(frameNo) {
    const j = this.job;
    const u = this._heap();
    if (!u) { this.job = null; return; }
    const tEnd = performance.now() + 5;
    let end = j.pos;
    const last = u.length - 20;
    while (end < last && performance.now() < tEnd) {
      const stop = Math.min(last, end + 65536);
      this._scan(u, j, end, stop);
      end = stop;
      if (j.hits.length > 400) break;
    }
    j.pos = end;
    if (end < last && j.hits.length <= 400) return;
    this._finish(j, u, frameNo);
  }

  _scan(u, j, from, to) {
    const { pick } = j;
    const t = pick.t;
    const t0 = t[0];
    for (let i = from; i < to; i++) {
      if ((u[i] & 0xffffff) !== t0) continue;
      let ok = true;
      for (let k = 1; k < t.length; k++) if ((u[i + k] & 0xffffff) !== t[k]) { ok = false; break; }
      if (!ok) continue;
      const base = i - pick.x0 - pick.y * GW;
      if (base >= 0 && base + NPX <= u.length && !j.hits.includes(base)) j.hits.push(base);
      if (j.hits.length > 400) break;
    }
  }

  _finish(j, u, frameNo) {
    // Suche beendet: die Kandidaten nach Übereinstimmung mit einem frischen Bild ordnen (höchstens 6 weiter prüfen)
    this.job = null;
    this.tries++;
    const ref = this.slow().data;
    const scored = [];
    for (const base of j.hits) {
      let bad = 0, n = 0;
      for (let y = 0; y < GH; y += 3) {
        for (let x = 0; x < GW; x += 3) {
          n++;
          const i = (y * GW + x) * 4;
          if ((u[base + y * GW + x] & 0xffffff) !== (ref[i] | (ref[i + 1] << 8) | (ref[i + 2] << 16))) bad++;
        }
      }
      scored.push([bad / n, base * 4]);
    }
    scored.sort((p, q) => p[0] - q[0]);
    const cands = scored.filter((p) => p[0] <= 0.4).slice(0, 6).map((p) => p[1]);
    if (!cands.length) {
      this.why = 'kein Treffer (' + j.hits.length + ')';
      this.nextTry = frameNo + (this.tries < 6 ? 45 : 600);
      return;
    }
    this._startProbe(cands, frameNo, 'prüfe');
  }

  // ---------- Probezeit ----------
  _startProbe(bases, frameNo, why) {
    this.prob = { bases, hh: bases.map(() => []), ch: [], start: frameNo };
    this.why = why;
  }

  /** Stichprobe (jeder 7. Punkt) des Heap-Bildes ab Byte-Adresse base; false bei Fehler. */
  _sampleHeap(base, out) {
    const u = this._heap();
    const s = base >> 2;
    if (!u || s < 0 || s + NPX > u.length) return false;
    for (let k = 0, p = 0; k < NPX; k += 7, p++) out[p] = (u[s + k] & 0xffffff) >>> 0;
    return true;
  }

  _sampleCanvas(out) {
    const d = this.slow().data;
    for (let k = 0, p = 0; k < NPX; k += 7, p++) {
      const i = k * 4;
      out[p] = (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16)) >>> 0;
    }
  }

  static _hash(a) {
    let h = 0;
    for (let i = 0; i < a.length; i++) h = (Math.imul(h, 31) + a[i]) | 0;
    return h;
  }

  _probe(frameNo) {
    const p = this.prob;
    const hs = new Uint32Array(NS), cs = new Uint32Array(NS);
    for (let c = 0; c < p.bases.length; c++) {
      if (!this._sampleHeap(p.bases[c], hs)) { p.hh[c].push(0); continue; }
      p.hh[c].push(FrameTap._hash(hs));
    }
    this._sampleCanvas(cs);
    p.ch.push(FrameTap._hash(cs));
    const m = p.ch.length;
    if (m < 30) return;
    // Wie oft hat sich das Canvas verändert? Und stand der Puffer dann zum passenden Zeitpunkt auf demselben Bild?
    const ch = p.ch;
    let chgMax = 0, win = null;
    for (let c = 0; c < p.bases.length; c++) {
      const hh = p.hh[c];
      for (let d = 0; d <= 2; d++) {
        let chg = 0, ok = 0;
        for (let i = 1; i + d < m; i++) {
          if (ch[i + d] === ch[i + d - 1]) continue;
          chg++;
          if (hh[i] === ch[i + d] && hh[i] !== hh[i - 1]) ok++;
        }
        chgMax = Math.max(chgMax, chg);
        if (chg >= 3 && ok >= chg * 0.8 && (!win || ok / chg > win.q)) win = { c, d, q: ok / chg };
      }
    }
    if (win) {
      this.prob = null;
      this.base = p.bases[win.c];
      this.locked = true;
      this.fails = 0;
      this.lastV = null;
      this.checkAt = frameNo + 900;
      this.why = 'ok (Vorlauf ' + win.d + ')';
      this._no = -1;
      this._cvNo = -1;
      try { localStorage.setItem(HINT_KEY, String(this.base)); } catch (e) {}
      return;
    }
    if (chgMax >= 3 && m >= 60) {
      // Das Canvas bewegt sich, aber kein Kandidat folgt ihm
      this.prob = null;
      this.why = 'kein passender Puffer';
      this.nextTry = frameNo + 30;
      if (this.hint) { this.hint = null; try { localStorage.removeItem(HINT_KEY); } catch (e) {} }
      return;
    }
    if (m > 900) { this.prob = null; this.why = 'Bild bewegt sich nicht'; this.nextTry = frameNo + 300; return; }
    if (m > 240) { for (const h of p.hh) h.shift(); ch.shift(); }
  }

  // ---------- Prüfung im Betrieb ----------
  /** Stichprobe alle 90 Bilder: stimmt der Puffer noch mit dem Canvas überein? */
  _verify(frameNo) {
    this.checkAt = frameNo + 900;
    const hs = new Uint32Array(NS), cs = new Uint32Array(NS);
    if (!this._sampleHeap(this.base, hs)) { this._lose(frameNo); return; }
    this._sampleCanvas(cs);
    const last = this.lastV;
    this.lastV = { hs, cs };
    if (!last) return;
    let dc = 0, dh = 0, bad = 0;
    for (let p = 0; p < NS; p++) {
      if (cs[p] !== last.cs[p]) dc++;
      if (hs[p] !== last.hs[p]) dh++;
      if (hs[p] !== cs[p]) bad++;
    }
    const cMoved = dc > NS * 0.005, hMoved = dh > NS * 0.005;
    let fail = false;
    if (cMoved && !hMoved) fail = true; // Canvas verändert sich, der Puffer steht: falscher Puffer
    else if (!cMoved && !hMoved && bad > NS * 0.08) fail = true; // beide stehen, aber verschieden
    if (fail) {
      this.checkAt = frameNo + 60; // bald noch einmal prüfen
      if (++this.fails >= 2) this._lose(frameNo);
    } else this.fails = 0;
  }

  _lose(frameNo) {
    this.locked = false;
    this.base = -1;
    this.nextTry = frameNo + 10;
    this.tries = 1; // gemerkte Adresse nicht noch einmal
    this.why = 'verloren';
  }
}
