// Oberfläche über dem Spielbild: Pokéball-Menü, Kampfmenü, Tastatur, Schließen-Taste (X), Steuerkreuz.
// Alles hängt am Zustand, den die TouchBridge meldet (siehe computeMode).

import { UI, FLAG } from './bridge.js';
import { START_ACTION } from './input.js';
import { MOVE_NAMES, TYPES } from './data.js';
import { CHARMAP } from './charmap.js';

const $ = (s) => document.querySelector(s);

// Einträge des Hauptmenüs (Startmenü-Aktionen des Spiels)
const MM_ITEMS = {
  [START_ACTION.POKEDEX]: { label: 'Pokédex', icon: 'i-dex' },
  [START_ACTION.POKEMON]: { label: 'Team', icon: 'i-team' },
  [START_ACTION.BAG]: { label: 'Beutel', icon: 'i-bag' },
  [START_ACTION.POKENAV]: { label: 'PokéNav', icon: 'i-nav' },
  [START_ACTION.PLAYER]: { label: 'Trainer', icon: 'i-person' },
  [START_ACTION.SAVE]: { label: 'Speichern', icon: 'i-save' },
  [START_ACTION.OPTION]: { label: 'Optionen', icon: 'i-opt' },
  [START_ACTION.RETIRE_SAFARI]: { label: 'Safari beenden', icon: 'i-close' },
  [START_ACTION.PLAYER_LINK]: { label: 'Trainer', icon: 'i-person' },
  [START_ACTION.REST_FRONTIER]: { label: 'Pause', icon: 'i-save' },
  [START_ACTION.RETIRE_FRONTIER]: { label: 'Aufgeben', icon: 'i-close' },
  [START_ACTION.PYRAMID_BAG]: { label: 'Beutel', icon: 'i-bag' },
};

// Tastenfelder der Namenseingabe: [Beschriftung, Spalte, Zeile] je Seite
const KB_LAYOUT = {
  letters: (up) => {
    const rows = [
      ['A', 'B', 'C', 'D', 'E', 'F', '.'],
      ['G', 'H', 'I', 'J', 'K', 'L', ','],
      ['M', 'N', 'O', 'P', 'Q', 'R', 'S'],
      ['T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
    ];
    const cols = [[0, 1, 2, 3, 4, 5, 7], [0, 1, 2, 3, 4, 5, 7], [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]];
    return rows.map((r, y) => r.map((ch, i) => [up ? ch : ch.toLowerCase(), cols[y][i], y]));
  },
  symbols: () => [
    ['0', '1', '2', '3', '4'].map((c, i) => [c, i, 0]),
    ['5', '6', '7', '8', '9'].map((c, i) => [c, i, 1]),
    ['!', '?', '♂', '♀', '/', '-'].map((c, i) => [c, i, 2]),
    ['…', '“', '”', '‘', '’'].map((c, i) => [c, i, 3]),
  ],
};
const KB_SPACE = { letters: [6, 0], symbols: [5, 0] };

export class Ui {
  /**
   * @param {{input:any, view:any, settings:any, app:HTMLElement, actions:{openSettings:()=>void, toast:(m:string)=>void}}} o
   */
  constructor(o) {
    this.input = o.input;
    this.view = o.view;
    this.settings = o.settings;
    this.app = o.app;
    this.actions = o.actions;
    this.mode = 'field';
    this.cand = 'field';
    this.candSince = 0;
    this.fieldSince = 0;
    this.mmOpen = false;
    this.dpadOpen = false;
    this.battleKey = '';
    this.kbPage = -2;
    this.nameKey = '';
    this.nameSeen = 0;
    this.nameShown = false;
    this.skins = null;
    this._bind();
  }

  setSkins(s) { this.skins = s; }

  // ---------- Verdrahtung ----------
  _bind() {
    const input = this.input;

    // Schnellzugriff
    for (const b of document.querySelectorAll('#dock .dockbtn')) {
      b.addEventListener('click', () => {
        const a = b.dataset.act;
        if (a === 'bag') input.openStartAction(START_ACTION.BAG, 'Der Beutel');
        else if (a === 'team') input.openStartAction(START_ACTION.POKEMON, 'Das Team');
      });
    }
    $('#ballBtn').addEventListener('click', () => this.toggleMainMenu());
    $('#mmClose').addEventListener('click', () => this.closeMainMenu());
    $('#mainmenu .mm-back').addEventListener('click', () => this.closeMainMenu());

    // X oben rechts: im Kampf eine Ebene zurück, sonst alle Menüs schließen
    $('#closeX').addEventListener('click', () => {
      if (this.mode === 'battleMove') {
        input.clearQueue();
        input.tap('B');
      } else if (this.skins && this.skins.onX()) {
        // Oberfläche (Beutel/Aktionsfenster): nur eine Ebene zurück
      } else {
        input.closeAll();
      }
    });

    // Steuerkreuz (für Bildschirme, die ich nicht kenne)
    $('#dpadToggle').addEventListener('click', () => {
      this.dpadOpen = !this.dpadOpen;
      this.app.classList.toggle('dpad-open', this.dpadOpen);
    });
    for (const b of document.querySelectorAll('#dpad button')) {
      const k = b.dataset.k;
      const release = () => { b.classList.remove('pressed'); input.up(k, 'dpad'); };
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        b.classList.add('pressed');
        input.down(k, 'dpad');
        e.preventDefault();
      });
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
    }

    // Kampf: Aktionen
    for (const b of document.querySelectorAll('#bActions button')) {
      b.addEventListener('click', () => this._pickIndex(+b.dataset.i, 'battleAction'));
    }

    // Tastatur
    for (const b of document.querySelectorAll('#kbTabs button')) {
      b.addEventListener('click', () => {
        const page = +b.dataset.page;
        input.enqueue(() => input.kbSetPage(page), 3);
      });
    }
    $('#kbSpace').addEventListener('click', () => {
      const s = this.input.snap;
      if (!s || !s.kb) return;
      const [c, r] = s.kb.page === 0 ? KB_SPACE.symbols : KB_SPACE.letters;
      input.enqueue(() => input.kbKey(c, r), 4);
    });
    $('#kbDel').addEventListener('click', () => input.enqueue(() => input.kbButton(1), 4));
    $('#kbOk').addEventListener('click', () => { input.clearQueue(); input.enqueue(() => input.kbButton(2), 2); });
  }

  /** Eintrag der aktuellen Menüanzeige per Index wählen (Kampfmenüs). */
  _pickIndex(i, need) {
    const s = this.input.snap;
    if (!s) return;
    if (need === 'battleAction' && s.ui !== UI.BATTLE_ACTION) return;
    if (need === 'battleMove' && s.ui !== UI.BATTLE_MOVE) return;
    if (i >= s.count) return;
    if (this.input.running) return;
    // Beutel/Pokémon im Kampf: das Spiel blendet zu einem Originalbildschirm über - gleich abdecken
    if (need === 'battleAction' && (i === 1 || i === 2)) this.input.hooks.armFor?.(i === 1 ? 'battleBag' : 'battleMon');
    this.input.enqueue(() => this.input.selectAndConfirm(i), 2);
  }

  // ---------- Zustand ----------
  computeMode(snap) {
    const input = this.input;
    if (!input.hasBridge || !snap) return 'nobridge';
    switch (snap.ui) {
      case UI.KEYBOARD: return 'keyboard';
      case UI.BATTLE_ACTION: return 'battleAction';
      case UI.BATTLE_MOVE: return 'battleMove';
      case UI.MENU: case UI.PARTY: case UI.OPTIONS: return 'menu';
    }
    if (snap.fieldFree) return 'field';
    if (snap.flags & FLAG.OVERWORLD) return 'dialog';
    if (snap.flags & FLAG.BATTLE_MAIN) return 'battleBusy';
    return 'special';
  }

  tick(snap) {
    if (this.skins) this.skins.update(snap);
    const next = this.computeMode(snap);
    const f = this.input.frame;
    if (next !== this.cand) {
      this.cand = next;
      this.candSince = f;
    }
    // Panels verschwinden erst nach ein paar Frames Ruhe, damit nichts flackert
    const isPanel = (m) => m === 'battleAction' || m === 'battleMove' || m === 'keyboard' || m === 'menu';
    const wait = isPanel(this.mode) && !isPanel(next) ? 8 : 0;
    if (next !== this.mode && f - this.candSince >= wait) this._setMode(next);

    if (this.mode === 'field' || this.mode === 'nobridge') {
      if (this.fieldSince === 0) this.fieldSince = f;
    } else {
      this.fieldSince = 0;
    }
    // Zoom nur, wenn die Figur eine Weile frei laufen kann
    // (Während einer Überblendung in der Oberwelt bleibt der Zoom, sonst würde er bei jeder Tür hin- und herspringen)
    const fadingOw = !!snap && (snap.flags & FLAG.FADING) !== 0 && (snap.flags & FLAG.OVERWORLD) !== 0 && this.mode === 'dialog';
    const zoomOk = (this.mode === 'field' && f - this.fieldSince >= 24 && !this.mmOpen) || (fadingOw && !this.mmOpen);
    this.view.setZoomTarget(zoomOk);
    this.view.setEdgeKey(this.mode === 'field' || (!!snap && (snap.flags & FLAG.OVERWORLD) !== 0));

    this._updateNaming(snap);
    if (snap) {
      if (this.mode === 'battleAction' || this.mode === 'battleMove') this._updateBattle(snap);
      if (this.mode === 'keyboard' && snap.kb) this._updateKeyboard(snap.kb);
    }
  }

  _setMode(m) {
    this.mode = m;
    this.app.dataset.mode = m;
    if (m !== 'field' && m !== 'nobridge') this.closeMainMenu();
    if (m !== 'special' && m !== 'nobridge') {
      this.dpadOpen = false;
      this.app.classList.remove('dpad-open');
    }
    if (m !== 'keyboard') this.kbPage = -2;
    if (m !== 'battleAction' && m !== 'battleMove') this.battleKey = '';
    // Im Kampf (Menü und Nachrichten) bleibt das Spielbild an derselben Stelle, das Panel liegt unten darüber
    const inBattle = m === 'battleAction' || m === 'battleMove' || m === 'battleBusy';
    this.view.setBattleSheet(inBattle ? 292 : 0);
  }

  // ---------- Hauptmenü ----------
  toggleMainMenu() {
    if (this.mmOpen) this.closeMainMenu();
    else this.openMainMenu();
  }

  openMainMenu() {
    const snap = this.input.snap;
    const grid = $('#mmGrid');
    grid.innerHTML = '';
    let ids = snap && snap.startActions && snap.startActions.length ? snap.startActions.filter((a) => a !== START_ACTION.EXIT && MM_ITEMS[a]) : [START_ACTION.BAG, START_ACTION.SAVE, START_ACTION.OPTION];
    if (!ids.length) ids = [START_ACTION.BAG, START_ACTION.SAVE, START_ACTION.OPTION];
    const mk = (label, icon, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = 'mm-item ' + cls;
      b.innerHTML = `<span class="mm-ic"><svg><use href="#${icon}"/></svg></span><span class="mm-tx">${label}</span>`;
      b.addEventListener('click', fn);
      grid.appendChild(b);
      return b;
    };
    ids.forEach((id, n) => {
      const it = MM_ITEMS[id];
      const b = mk(it.label, it.icon, () => {
        this.closeMainMenu();
        this.input.openStartAction(id, it.label);
      });
      b.style.setProperty('--n', n);
    });
    const b = mk('Einstellungen', 'i-gear', () => { this.closeMainMenu(); this.actions.openSettings(); }, 'app');
    b.style.setProperty('--n', ids.length);
    this.mmOpen = true;
    this.app.classList.add('mm-open');
  }

  closeMainMenu() {
    if (!this.mmOpen) return;
    this.mmOpen = false;
    this.app.classList.remove('mm-open');
  }

  // ---------- Kampf ----------
  _updateBattle(snap) {
    // Safari-Zone: das Spiel meldet kein eigenes Pokémon (nur die Aktionen), also leere Werte
    const info = snap.info || { name: '', species: 0, level: 0, hp: 0, maxHp: 0, moves: [0, 0, 0, 0], pp: [0, 0, 0, 0], maxPp: [0, 0, 0, 0], types: [] };
    const bt = this.view.battle && this.view.battle.on ? this.view.battle.bt : null;
    const safari = !!(bt && (bt.typeFlags & (1 << 7)));
    if (!snap.info && !safari) return;
    const key = [snap.ui, safari ? 1 : 0, info.name, info.level, info.hp, info.maxHp, info.moves.join(','), info.pp.join(','), info.maxPp.join(',')].join('|');
    if (key === this.battleKey) return;
    this.battleKey = key;

    $('#bPrompt').textContent = snap.ui === UI.BATTLE_MOVE ? 'Welche Attacke?' : safari ? 'Was nun?' : `Was soll ${info.name || '…'} tun?`;
    this._safariLabels(safari);
    $('#bName').textContent = info.name || '–';
    $('#bLv').textContent = info.level;
    const ratio = info.maxHp > 0 ? Math.max(0, Math.min(1, info.hp / info.maxHp)) : 0;
    const bar = $('#bBar');
    bar.style.width = ratio * 100 + '%';
    bar.className = ratio > 0.5 ? 'g' : ratio > 0.2 ? 'y' : 'r';
    $('#bHp').textContent = `${info.hp}/${info.maxHp}`;

    if (snap.ui === UI.BATTLE_MOVE) {
      const box = $('#bMoves');
      box.innerHTML = '';
      for (let i = 0; i < 4; i++) {
        const id = info.moves[i];
        const b = document.createElement('button');
        if (!id) {
          b.className = 'gba-btn move empty';
          b.disabled = true;
          b.innerHTML = '<b>–</b>';
        } else {
          const t = TYPES[info.types[i]] || TYPES[0];
          const pp = info.pp[i], max = info.maxPp[i];
          const low = pp === 0 ? ' out' : pp * 4 <= max ? ' low' : '';
          b.className = 'gba-btn move' + low;
          b.style.setProperty('--tc', t.color);
          b.innerHTML = `<span class="mv-type">${t.name}</span><b>${MOVE_NAMES[id] || '???'}</b><small>AP ${pp}/${max}</small>`;
          b.addEventListener('click', () => this._pickIndex(i, 'battleMove'));
        }
        box.appendChild(b);
      }
    }
  }

  /** Safari-Zone: andere Aktionen (Ball, Annähern, Köder, Flucht) statt Kampf/Beutel/Pokémon/Flucht. */
  _safariLabels(on) {
    if (this._safariOn === on) return;
    this._safariOn = on;
    const L = on
      ? [['Ball', 'Safaribälle werfen'], ['Köder', 'Futter werfen'], ['Annähern', 'Vorsichtig näher'], ['Flucht', 'Weglaufen']]
      : [['Kampf', 'Attacke wählen'], ['Beutel', 'Items nutzen'], ['Pokémon', 'Wechseln'], ['Flucht', 'Weglaufen']];
    document.querySelectorAll('#bActions button').forEach((b, i) => {
      b.querySelector('b').textContent = L[i][0];
      b.querySelector('small').textContent = L[i][1];
    });
  }

  // ---------- Namenseingabe: Titel, Symbol und Namensfeld ----------
  _updateNaming(snap) {
    const nm = snap && snap.name;
    const f = this.input.frame;
    if (nm) this.nameSeen = f;
    // Nach dem letzten Bild noch kurz stehen lassen (Überblendung beim Verlassen), sonst flackert es
    const want = !!nm || (this.nameShown && f - this.nameSeen < 12 && f >= this.nameSeen);
    if (!want) {
      if (this.nameShown) {
        this.nameShown = false;
        this.nameKey = '';
        $('#nameSkin').classList.remove('on');
      }
      return;
    }
    if (!this.nameShown) {
      this.nameShown = true;
      $('#nameSkin').classList.add('on');
    }
    if (!nm) return;
    const key = nm.tpl + ':' + nm.max + ':' + nm.species + ':' + nm.gender + ':' + nm.chars.join(',');
    if (key === this.nameKey) return;
    const first = this.nameKey === '' || !this.nameKey.startsWith(nm.tpl + ':' + nm.max + ':' + nm.species + ':' + nm.gender + ':');
    this.nameKey = key;

    const d = this.skins && this.skins.data && this.skins.data.ready ? this.skins.data : null;
    const mon = nm.tpl === 2 || nm.tpl === 3;
    const spName = mon && d && nm.species ? d.speciesName(nm.species) : '';
    const gsym = nm.gender === 1 ? ' ♂' : nm.gender === 2 ? ' ♀' : '';
    const T = {
      0: ['Dein Name', 'Wie heißt du?', 'Leer lassen: Standardname'],
      1: ['Boxname', 'Wie soll die Box heißen?', 'Leer lassen: Standardname'],
      2: ['Spitzname', (spName || 'Pokémon') + gsym, 'Leer lassen: Originalname'],
      3: ['Spitzname', (spName || 'Pokémon') + gsym, 'Leer lassen: Originalname'],
      4: ['Waldas Worte', 'Sag die Worte', ''],
    }[nm.tpl] || ['Name', '', ''];
    $('#nmTitle').textContent = T[0];
    $('#nmSub').innerHTML = '<b></b>' + (mon ? 'Wie soll es heißen?' : '');
    $('#nmSub').firstChild.textContent = T[1];
    $('#nmHint').textContent = T[2];
    if (first) {
      const ic = $('#nmIc');
      const icon = mon && d ? d.monIcon(nm.species) : null;
      ic.innerHTML = icon ? `<img alt="" src="${icon}">` : `<svg><use href="#${nm.tpl === 1 ? 'i-pc' : 'i-person'}"/></svg>`;
    }
    const slots = $('#nmSlots');
    let html = '';
    for (let i = 0; i < nm.max; i++) {
      const b = nm.chars[i];
      const ch = b === undefined ? '' : (CHARMAP[b] != null ? CHARMAP[b] : '');
      const cls = i === nm.chars.length ? 'nm-slot cur' : b !== undefined ? 'nm-slot full' : 'nm-slot';
      html += `<span class="${cls}">${ch === ' ' ? '&nbsp;' : ch.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`;
    }
    slots.innerHTML = html;
  }

  // ---------- Tastatur ----------
  _updateKeyboard(kb) {
    if (kb.page === this.kbPage) return;
    this.kbPage = kb.page;
    for (const b of document.querySelectorAll('#kbTabs button')) b.classList.toggle('on', +b.dataset.page === kb.page);
    const box = $('#kbKeys');
    box.innerHTML = '';
    const rows = kb.page === 0 ? KB_LAYOUT.symbols() : KB_LAYOUT.letters(kb.page === 1);
    box.dataset.cols = kb.page === 0 ? '6' : '7';
    for (const row of rows) {
      for (const [label, col, y] of row) {
        const b = document.createElement('button');
        b.className = 'kb-key';
        b.textContent = label;
        b.addEventListener('click', () => this.input.enqueue(() => this.input.kbKey(col, y), 5));
        box.appendChild(b);
      }
      // Reihen mit weniger Tasten auffüllen, damit das Raster gerade bleibt
      const cols = kb.page === 0 ? 6 : 7;
      for (let i = row.length; i < cols; i++) {
        const sp = document.createElement('span');
        sp.className = 'kb-gap';
        box.appendChild(sp);
      }
    }
  }
}
