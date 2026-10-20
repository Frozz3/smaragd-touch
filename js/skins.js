// Menü-Oberflächen im Stil des Kampfmenüs.
//
// Das Spiel läuft unverändert weiter und bleibt die einzige Wahrheit. Diese Datei liest nur, was das Spiel
// über src/touch_menu.c meldet (Beutel-Inhalt, Beschriftungen von Auswahlfenstern), und legt eine
// übersichtliche Oberfläche darüber. Jede Berührung wird in echte Tastendrücke übersetzt - das Spiel merkt
// nicht, ob es per Finger oder per Taste bedient wird. Kommt etwas Unbekanntes, verschwindet die
// Oberfläche und der Originalbildschirm ist zu sehen.

import { SCREEN, BAG_SUB, PARTY_SUB, DEX_SUB, PAGE_SUB, SHOP_SUB, ITEMMENU_SHOP, MenuReader, GameData } from './menus.js';
import { UI, FLAG, START_ACTION } from './bridge.js';
import { TYPES } from './data.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Wie lange (Spielbilder) eine Oberfläche nach dem letzten gültigen Zustand stehen bleibt (gegen Flackern)
const HOLD = 8;

const POCKETS = [
  { name: 'Items', icon: 13 },
  { name: 'Bälle', icon: 4 },
  { name: 'TM/VM', icon: 289 },
  { name: 'Beeren', icon: 139 },
  { name: 'Basis', icon: 259 },
];

// Beschriftungen von Auswahlfenstern -> Deutsch + Farbe
const LABELS = {
  'USE': ['Benutzen', 'go'], 'GIVE': ['Geben', 'amber'], 'TOSS': ['Wegwerfen', 'red'], 'CANCEL': ['Zurück', 'grey'],
  'REGISTER': ['Registrieren', 'amber'], 'DESELECT': ['Abwählen', 'grey'], 'CHECK TAG': ['Anhänger', 'blue'],
  'CONFIRM': ['Bestätigen', 'go'], 'WALK': ['Gehen', 'go'], 'CHECK': ['Ansehen', 'blue'], 'YES': ['Ja', 'go'],
  'NO': ['Nein', 'red'], 'SUMMARY': ['Details', 'blue'], 'SWITCH': ['Wechseln', 'amber'], 'ITEM': ['Item', 'amber'],
  'MAIL': ['Brief', 'blue'], 'TAKE': ['Nehmen', 'go'], 'STORE': ['Einlagern', 'amber'], 'READ': ['Lesen', 'blue'],
  'SHIFT': ['Wechseln', 'amber'], 'ENTER': ['Teilnehmen', 'go'], 'NO ENTRY': ['Zurück', 'grey'], 'SELL': ['Verkaufen', 'amber'],
  'BUY': ['Kaufen', 'go'], 'QUIT': ['Beenden', 'grey'], 'EXIT': ['Beenden', 'grey'], 'SEE ID': ['Ansehen', 'blue'],
  'SEE YA!': ['Tschüss', 'grey'], 'SEND OUT': ['Einsetzen', 'go'], 'DEPOSIT': ['Einlagern', 'amber'],
  'TAKE ITEM': ['Item nehmen', 'go'], 'GIVE ITEM': ['Item geben', 'amber'],
  // PC
  "SOMEONE'S PC": ['Pokémon-PC', 'blue'], 'LOG OFF': ['Abmelden', 'grey'], 'HALL OF FAME': ['Ruhmeshalle', 'amber'],
  'WITHDRAW POKÉMON': ['Abheben', 'go'], 'WITHDRAW POKÉMO': ['Abheben', 'go'], 'DEPOSIT POKÉMON': ['Einlagern', 'amber'],
  'MOVE POKÉMON': ['Verschieben', 'blue'], 'MOVE ITEMS': ['Items tauschen', 'blue'],
  'ITEM STORAGE': ['Item-Lager', 'blue'], 'MAILBOX': ['Briefkasten', 'blue'], 'DECORATION': ['Dekoration', 'amber'],
  'TURN OFF': ['Ausschalten', 'grey'], 'WITHDRAW ITEM': ['Item abheben', 'go'], 'DEPOSIT ITEM': ['Item einlagern', 'amber'],
  'TOSS ITEM': ['Item wegwerfen', 'red'], 'READ MAIL': ['Brief lesen', 'blue'], 'MOVE TO BAG': ['In den Beutel', 'go'],
  'DECORATE': ['Aufstellen', 'go'], 'PUT AWAY': ['Wegräumen', 'amber'],
  // PC-Kontextmenü
  'WITHDRAW': ['Abheben', 'go'], 'MOVE': ['Verschieben', 'blue'], 'PLACE': ['Ablegen', 'go'], 'RELEASE': ['Freilassen', 'red'],
  'MARK': ['Markieren', 'blue'], 'JUMP': ['Springen', 'blue'], 'WALLPAPER': ['Hintergrund', 'blue'], 'NAME': ['Name', 'blue'],
  'BAG': ['Beutel', 'amber'], 'INFO': ['Info', 'blue'],
  // Einführung
  'BOY': ['Junge', 'blue'], 'GIRL': ['Mädchen', 'red'],
};

// Startmenü-Einträge, für die es eine eigene Oberfläche gibt (nur dort wird das Originalbild verdeckt)
const SKIN_SCREENS = new Set([SCREEN.BAG, SCREEN.PARTY, SCREEN.SUMMARY, SCREEN.TRAINER, SCREEN.DEX, SCREEN.SHOP]);
const SKINNED_ACTIONS = new Set([START_ACTION.BAG, START_ACTION.POKEMON, START_ACTION.POKEDEX, START_ACTION.PLAYER, START_ACTION.OPTION]);

const ROW_H = 40; // Höhe einer Zeile im Mengenrad (muss zu .qw-n im CSS passen)

const yen = (n) => '¥' + Number(n || 0).toLocaleString('de-DE');
const num = (n) => Number(n || 0).toLocaleString('de-DE');

/** Meldungen des Verkäufers (englisch aus dem Spiel) -> Deutsch. Unbekanntes bleibt unverändert. */
function shopText(raw) {
  const t = String(raw || '').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
  let r;
  if ((r = /^(.+?)\? Certainly\. How many would you like\?$/.exec(t))) return `${titleCase(r[1])}? Sehr gern. Wie viele darf es sein?`;
  if ((r = /^(.+?)\? And you wanted (\d+)\? That will be \D?(\d+)\.$/.exec(t))) return `${titleCase(r[1])}, ${r[2]} Stück? Das macht ${yen(r[3])}.`;
  if (/^Here you go! Thank you very much\.?$/.test(t)) return 'Bitte sehr! Vielen Dank.';
  if (/^You don't have enough money\.?$/.test(t)) return 'Du hast nicht genug Geld.';
  if (/^You have no more room for this item\.?$/.test(t)) return 'Dafür ist kein Platz mehr im Beutel.';
  if (/PREMIER BALL, too/i.test(t)) return 'Ich lege noch einen Premier Ball dazu!';
  if ((r = /^(.+?)\? Oh, no\. I can't buy that\.?$/.exec(t))) return `${titleCase(r[1])}? Oh nein, das kann ich nicht ankaufen.`;
  if ((r = /^(.+?)\? How many would you like to sell\?$/.exec(t))) return `${titleCase(r[1])} – wie viele möchtest du verkaufen?`;
  if ((r = /^I can pay \D?(\d+)\. Would that be okay\?$/.exec(t))) return `Ich zahle dir ${yen(r[1])}. Einverstanden?`;
  if ((r = /^Turned over the (.+?) and received \D?(\d+)\.?$/.exec(t))) return `${titleCase(r[1])} abgegeben und ${yen(r[2])} erhalten.`;
  return raw;
}

/** Meldungen, nach denen das Spiel von selbst weitermacht (kein Tippen nötig) */
const shopAuto = (raw) => /Certainly|And you wanted|is it\?|You wanted/.test(String(raw || ''));


// Hinweistexte oben im Team-Fenster
const PROMPTS = {
  'Choose a POKéMON.': 'Wähle ein Pokémon',
  'Choose a POKéMON or CANCEL.': 'Wähle ein Pokémon',
  'Choose a POKéMON and confirm.': 'Wähle Pokémon und bestätige',
  'Do what with this POKéMON?': 'Was soll es tun?',
  'Do what with this PkMn?': 'Was soll es tun?',
  'Move to where?': 'Wohin verschieben?',
  'Use on which POKéMON?': 'Auf welches Pokémon?',
  'Teach which POKéMON?': 'Welches Pokémon lernt es?',
  'Give to which POKéMON?': 'Welches Pokémon bekommt es?',
  'Do what with an item?': 'Was mit dem Item?',
};

// Zustände in den Pokémon-Details (Zahlen wie AILMENT_* im Spiel)
const AILMENTS = { 1: ['GIFT', 'psn'], 2: ['LÄHM', 'par'], 3: ['SCHLAF', 'slp'], 4: ['EIS', 'frz'], 5: ['BRAND', 'brn'], 6: ['POKÉRUS', 'pkrs'], 7: ['K.O.', 'fnt'] };
// Wesen: Reihenfolge der Werte im Spiel (Angriff, Verteidigung, Initiative, Sp.-Angriff, Sp.-Vert.) -> Index in stat[]
const NATURE_STAT = [0, 1, 4, 2, 3];
const STAT_NAMES = ['Angriff', 'Verteidigung', 'Sp.-Angriff', 'Sp.-Vert.', 'Initiative'];
const BADGES = [
  ['Stein', '#a08050'], ['Faust', '#d0603c'], ['Dynamo', '#e8c020'], ['Hitze', '#e8503a'],
  ['Balance', '#e0e0e8'], ['Feder', '#70a8f0'], ['Geist', '#a060d0'], ['Regen', '#4890d8'],
];
const EGG_TEXT = ['Es sieht aus, als würde es jeden Moment schlüpfen!', 'Es regt sich ab und zu.', 'Es braucht noch etwas Zeit.', 'Bis zum Schlüpfen dauert es wohl noch lange.'];

function statusOf(mon) {
  if (mon.hp === 0) return ['K.O.', 'fnt'];
  const s = mon.status;
  if (s & 7) return ['SCHLAF', 'slp'];
  if (s & 0x88) return ['GIFT', 'psn'];
  if (s & 0x10) return ['BRAND', 'brn'];
  if (s & 0x20) return ['EIS', 'frz'];
  if (s & 0x40) return ['LÄHM', 'par'];
  return null;
}


// Optionsmenü: Zeilen wie im Spiel (Reihenfolge und Werte siehe src/option_menu.c)
const OPTIONS = [
  { name: 'Textgeschwindigkeit', hint: 'Wie schnell Text erscheint', vals: ['Langsam', 'Mittel', 'Schnell'] },
  { name: 'Kampfanimationen', hint: 'Attacken-Animationen im Kampf', vals: ['An', 'Aus'] },
  { name: 'Kampfstil', hint: 'Wechsel: Das Spiel fragt, ob du nach einem Sieg wechseln willst', vals: ['Wechsel', 'Fest'] },
  { name: 'Ton', hint: '', vals: ['Mono', 'Stereo'] },
  { name: 'Tastenbelegung', hint: 'Für die Touch-Steuerung ohne Bedeutung', vals: ['Normal', 'LR', 'L=A'] },
  { name: 'Fensterrahmen', hint: 'Aussehen der Textfenster im Spiel', frame: true },
];

function titleCase(s) {
  return String(s).toLowerCase().replace(/(^|[\s\-\/])([a-zé])/g, (m, a, b) => a + b.toUpperCase());
}

/** [Text, Farbe] für eine Beschriftung des Spiels */
function labelOf(text) {
  const k = String(text).trim().toUpperCase().replace(/[\u2018\u2019]/g, "'");
  if (LABELS[k]) return LABELS[k];
  return [titleCase(text), 'blue'];
}


/** Anzeigename eines Items: TM/VM mit Attackenname, Beeren ohne Nummer */
function itemLabel(d, it, pocket) {
  if (it.move && d.ready) {
    const id = it.id;
    const tag = id >= 339 ? 'HM0' + (id - 338) : 'TM' + String(id - 288).padStart(2, '0');
    return tag + ' ' + d.moveName(it.move);
  }
  if (pocket === 3 && d.ready) return d.itemName(it.id) || it.name;
  return it.name || (d.ready ? d.itemName(it.id) : '???');
}

export class Skins {
  /**
   * @param {{input:any, world:any, app:HTMLElement, boost:(on:boolean)=>void}} o
   */
  constructor(o) {
    this.input = o.input;
    this.world = o.world;
    this.app = o.app;
    this.boost = o.boost || (() => {});
    this.reader = new MenuReader(o.world.mem);
    this.data = new GameData(o.world.mem);
    this.m = null;
    this.lastRomTry = 0;

    this.vis = { bag: { on: false, last: 0 }, party: { on: false, last: 0 }, opt: { on: false, last: 0 }, sheet: { on: false, last: 0 }, dex: { on: false, last: 0 }, dexInfo: { on: false, last: 0 } };
    this.dexEl = $('#dexSkin');
    this.dxList = $('#dxList');
    this.dxCount = $('#dxCount');
    this.dexInfoEl = $('#dexInfo');
    this.diBody = $('#diBody');
    this.diNo = $('#diNo');
    this.dexKey = '';
    this.dexCache = null;
    this.dexInfoKey = '';
    this.iconQueue = [];
    this.vis.sum = { on: false, last: 0 };
    this.vis.tr = { on: false, last: 0 };
    this.sumEl = $('#sumSkin');
    this.smBody = $('#smBody');
    this.smNo = $('#smNo');
    this.trEl = $('#trSkin');
    this.trBody = $('#trBody');
    this.sumKey = '';
    this.sumCache = null;
    this.sumMove = -1; // aufgeklappte Attacke
    this.trKey = '';
    this.trCache = null;
    this.suppress = null; // Bildschirm, für den die Originalansicht gewählt wurde
    this.optEl = $('#optSkin');
    this.osList = $('#osList');
    this.optBuilt = false;
    this.partyEl = $('#partySkin');
    this.psList = $('#psList');
    this.psPrompt = $('#psPrompt');
    this.partyKey = '';
    this.partyCache = null;
    this.bagEl = $('#bagSkin');
    this.listEl = $('#bsList');
    this.tabsEl = $('#bsTabs');
    this.sheetEl = $('#actSheet');
    this.sheetBody = $('#asBody');
    this.backEl = $('#actBack');

    this.cache = null; // zuletzt gültige Beutel-Daten
    this.listKey = '';
    this.listPocket = -1;
    this.sheetKey = '';
    this.sheetOpen = false;
    this.pending = -1; // angetippte Zeile, deren Aktion gerade läuft

    // PokéMart
    this.vis.shop = { on: false, last: 0 };
    this.shopEl = $('#shopSkin');
    this.shList = $('#shList');
    this.shMoney = $('#shMoney');
    this.bsTitle = $('#bsTitle');
    this.bsMoney = $('#bsMoney');
    this.shopCache = null;
    this.shopKey = '';
    this.quiet = false; // ein Kauf-/Verkaufsmakro läuft: Zwischenmeldungen nicht als Fenster zeigen
    this.wheel = null; // Mengenrad: { el, max, val, mode, unit, owned, money, name }

    // Abdeckung: solange das Spiel zwischen zwei Bildschirmen ein-/ausblendet, bleibt das Originalbild verdeckt
    this.cv = { armed: false, saw: false, on: false, armedAt: 0, minHold: 10, since: 0, calm: 0, calmSince: 0, quiet: 0, quietSince: 0, sm: 0, lastB: 0 };

    this._buildTabs();
    this._bind();
  }

  // ---------- Aufbau ----------
  _buildTabs() {
    this.tabsEl.innerHTML = '';
    POCKETS.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'bs-tab';
      b.dataset.p = i;
      b.innerHTML = `<span class="bs-ti"></span><span class="bs-tl">${p.name}</span>`;
      this.tabsEl.appendChild(b);
    });
  }

  _bind() {
    this.tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.bs-tab');
      if (!b || this.input.running) return;
      const p = +b.dataset.p;
      this.input.enqueue(() => this.bagPocket(p), 2);
    });
    this.listEl.addEventListener('click', (e) => {
      const b = e.target.closest('.bs-row');
      if (!b || this.input.running) return;
      const i = +b.dataset.i;
      this.pending = i;
      b.classList.add('busy');
      this.input.enqueue(() => this.bagOpenItem(i), 2);
    });
    this.shList.addEventListener('click', (e) => {
      const b = e.target.closest('.bs-row');
      if (!b || this.input.running) return;
      const i = +b.dataset.i;
      this.pending = i;
      b.classList.add('busy');
      this.input.enqueue(() => this.shopOpenItem(i), 2);
    });
    this.psList.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b || this.input.running) return;
      const i = +b.dataset.i;
      b.classList.add('busy');
      this.input.enqueue(() => this.input.selectAndConfirm(i), 2);
    });
    this.osList.addEventListener('click', (e) => {
      const b = e.target.closest('[data-row]');
      if (!b || this.input.running) return;
      const row = +b.dataset.row;
      if (row === 6) { this.input.enqueue(() => this.input.selectAndConfirm(6), 2); return; }
      this.input.enqueue(() => this.optionsSet(row, b.dataset.v === undefined ? null : +b.dataset.v, +(b.dataset.step || 0)), 2);
    });
    this.dxList.addEventListener('click', (e) => {
      const b = e.target.closest('.dx-row');
      if (!b || b.classList.contains('unseen') || this.input.running) return;
      const i = +b.dataset.i;
      b.classList.add('busy');
      this.input.enqueue(() => this.dexOpen(i), 2);
    });
    this.diBody.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dx]');
      if (!b || b.disabled || this.input.running) return;
      const a = b.dataset.dx;
      if (a === 'prev') this.input.enqueue(() => this.dexStep('Up'), 2);
      else if (a === 'next') this.input.enqueue(() => this.dexStep('Down'), 2);
      else if (a === 'back') this.input.tap('B');
      else this.input.enqueue(() => this.dexScreen(+a), 2);
    });
    this.smBody.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sm]');
      if (!b || b.disabled) return;
      const a = b.dataset.sm;
      if (a === 'mv') { const i = +b.dataset.i; this.sumMove = this.sumMove === i ? -1 : i; this.sumKey = ''; if (this.sumCache) this._renderSummary(this.sumCache); }
      else if (this.input.running) return;
      else if (a === 'prev') this.input.enqueue(() => this.sumStep('Up'), 2);
      else if (a === 'next') this.input.enqueue(() => this.sumStep('Down'), 2);
      else if (a === 'back') this.input.tap('B');
      else if (a === 'orig') { this.suppress = SCREEN.SUMMARY; }
    });
    this.trBody.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tr]');
      if (!b || this.input.running) return;
      if (b.dataset.tr === 'back') this._closeTrainer();
      else if (b.dataset.tr === 'orig') this.suppress = SCREEN.TRAINER;
    });
    this.backEl.addEventListener('click', () => this.input.tap('B'));
    this.sheetBody.addEventListener('click', (e) => {
      const n = e.target.closest('.qw-n');
      if (n && this.wheel) { this._wheelTo(+n.dataset.v, true); return; }
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      if (b.dataset.arm) this.arm();
      this._sheetAct(b.dataset.act, +b.dataset.i, b);
    });
  }

  // ---------- Daten ----------
  /** Aktuellen Menüzustand aus dem Spielspeicher holen (auch zwischen zwei Takten nutzbar). */
  fresh() {
    const s = this.input.snap;
    const base = this.input.bridge.base;
    if (!s || !s.menuAddr || base < 0 || !s.selfAddr) return (this.m = null);
    const mem = this.world.mem;
    if (!mem.refresh()) return (this.m = null);
    mem.ewram = base - (s.selfAddr - 0x02000000);
    if (mem.rom < 0 && performance.now() - this.lastRomTry > 1000) {
      this.lastRomTry = performance.now();
      mem.findRom();
    }
    this.m = this.reader.read(s.menuAddr);
    if (this.m && this.reader.tbl) this.data.setTables(this.reader.tbl, this.reader.dim);
    return this.m;
  }

  /** true, wenn der Spielzustand (Cursor-Menü) zu den gemeldeten Beschriftungen passt */
  _labels(snap, m) {
    if (!snap || !m || !m.labels || snap.ui !== UI.MENU) return null;
    if (m.labelCount !== snap.count || Math.abs(m.frame - snap.frame) > 3) return null;
    return m.labels;
  }

  _hold(name, want, hold = HOLD) {
    const st = this.vis[name];
    const f = this.input.frame;
    if (want) { st.on = true; st.last = f; }
    else if (st.on && f - st.last > hold) st.on = false;
    return st.on;
  }

  // ---------- Takt ----------
  update(snap) {
    const m = this.fresh();
    let bagWant = false;
    let partyWant = false;
    let dexWant = false;
    let dexInfoWant = false;
    let sumWant = false;
    let trWant = false;
    let shopWant = false;
    let sheet = null;
    if (this.suppress !== null && m && m.screen !== this.suppress) this.suppress = null;

    if (m && m.screen === SCREEN.BAG && m.bag) {
      const bag = m.bag;
      const sub = m.sub;
      if (bag.valid) {
        this.cache = { pocket: bag.pocket, items: bag.items, registered: bag.registered, hasCancel: bag.hasCancel, count: bag.count, location: bag.location };
      }
      bagWant = !!this.cache && (bag.valid || sub === BAG_SUB.SWITCH || sub === BAG_SUB.WAIT || (sub === BAG_SUB.OTHER && (bag.msgOpen || (snap && snap.ui === UI.MENU))));
      if (bagWant) sheet = this._bagSheet(snap, m);
    } else if (m && m.screen === SCREEN.PARTY && m.party) {
      partyWant = true;
      this.partyCache = m.party;
      sheet = this._partySheet(snap, m);
    } else if (m && m.screen === SCREEN.SUMMARY && m.summary) {
      sumWant = m.summary.sub === PAGE_SUB.IDLE && this.suppress !== SCREEN.SUMMARY;
      if (sumWant) this.sumCache = m.summary;
      else if (m.summary.mode === 3 && snap && !snap.startMenu && snap.ui === UI.MENU) {
        // Attacke zum Vergessen wählen (neue Attacke lernen): vier Attacken + "nicht lernen"
        const labels = this._labels(snap, m);
        if (labels && labels.length === 5) sheet = { kind: 'forget', labels, sum: m.summary };
      }
    } else if (m && m.screen === SCREEN.TRAINER && m.trainer) {
      trWant = m.trainer.sub !== PAGE_SUB.OTHER && this.suppress !== SCREEN.TRAINER;
      if (trWant) this.trCache = m.trainer;
    } else if (m && m.screen === SCREEN.DEX && m.dex) {
      dexWant = m.dex.sub === DEX_SUB.LIST || m.dex.sub === DEX_SUB.SCROLL;
      dexInfoWant = m.dex.sub === DEX_SUB.INFO;
      if (dexWant || dexInfoWant) this.dexCache = m.dex;
    } else if (m && m.screen === SCREEN.SHOP && m.shop) {
      // Kaufliste (Hauptmenü des Verkäufers ist nur ein Fenster darüber)
      if (m.shop.sub !== SHOP_SUB.HUB && m.shop.count > 0) {
        shopWant = true;
        this.shopCache = m.shop;
      }
      sheet = this._shopSheet(snap, m);
    } else if (snap && snap.main && snap.ui === UI.MENU && !snap.startMenu) {
      sheet = { kind: 'main', main: snap.main, cursor: snap.cursor };
    } else if (snap && !snap.startMenu && snap.ui !== UI.OPTIONS) {
      sheet = this._genericSheet(snap, m);
    }
    if (this.quiet && sheet && sheet.kind !== 'qty' && sheet.kind !== 'sqty') sheet = null;

    const optOn = this._hold('opt', !!snap && snap.ui === UI.OPTIONS && !!snap.opt);
    if (optOn) this._renderOptions(snap);
    this.optEl.classList.toggle('on', optOn);

    const bagOn = this._hold('bag', bagWant);
    const partyOn = this._hold('party', partyWant);
    const sheetOn = this._hold('sheet', !!sheet);
    const dexOn = this._hold('dex', dexWant);
    const dexInfoOn = this._hold('dexInfo', dexInfoWant, 24);
    const sumOn = this._hold('sum', sumWant, 45);
    const trOn = this._hold('tr', trWant, 30);
    const shopOn = this._hold('shop', shopWant);
    if (sumOn && this.sumCache) this._renderSummary(sumWant && m ? m.summary : this.sumCache);
    else if (!sumOn) { this.sumCache = null; this.sumKey = ''; this.sumMove = -1; this.smBody.innerHTML = ''; }
    if (trOn && this.trCache) this._renderTrainer(trWant && m ? m.trainer : this.trCache);
    else if (!trOn) { this.trCache = null; this.trKey = ''; this.trBody.innerHTML = ''; }
    if (dexOn && this.dexCache) this._renderDex(dexWant && m ? m.dex : this.dexCache);
    if (dexInfoOn && this.dexCache) this._renderDexInfo(dexInfoWant && m ? m.dex : this.dexCache);
    if (!dexOn && !dexInfoOn) this._resetDex();
    if (bagOn) this._renderBag(m);
    else this._resetBag();
    if (partyOn) this._renderParty(m);
    else this.partyCache = null;
    if (shopOn && this.shopCache) this._renderShop(shopWant && m ? m.shop : this.shopCache);
    else if (!shopOn) this._resetShop();
    this._renderSheet(sheet, sheetOn);

    this.bagEl.classList.toggle('on', bagOn);
    this.partyEl.classList.toggle('on', partyOn);
    this.dexEl.classList.toggle('on', dexOn && !dexInfoOn);
    this.dexInfoEl.classList.toggle('on', dexInfoOn);
    this.sumEl.classList.toggle('on', sumOn);
    this.trEl.classList.toggle('on', trOn);
    this.shopEl.classList.toggle('on', shopOn);
    const screenSkin = bagOn || partyOn || optOn || dexOn || dexInfoOn || sumOn || trOn || shopOn;
    this.app.classList.toggle('skin-bag', screenSkin);
    this.app.classList.toggle('skin-sheet', sheetOn);
    this.sheetOpen = sheetOn;
    this._updateCover(snap, m, screenSkin);
  }

  // ---------- Abdeckung des Originalbildes ----------
  /** Abdeckung sofort einschalten (ein Menü wurde angefordert). */
  arm(minHold = 10) {
    const cv = this.cv;
    cv.armed = true;
    cv.minHold = minHold;
    cv.saw = false;
    cv.armedAt = this.input.frame;
    cv.since = 0;
    cv.calm = 0;
    cv.calmSince = 0;
    cv.quiet = 0;
    cv.quietSince = 0;
    cv.sm = 0;
    cv.on = true;
    this.app.classList.add('cover');
  }

  /** Nach dem Makro "Startmenü-Eintrag öffnen": nur bei Einträgen mit eigener Oberfläche abdecken. */
  armFor(actionId) {
    if (SKINNED_ACTIONS.has(actionId)) this.arm();
    else if (actionId === 'battleBag' || actionId === 'battleMon') this.arm(45); // im Kampf beginnt die Überblendung erst nach einigen Bildern
  }

  /**
   * Solange eine Menü-Sitzung läuft (eine Oberfläche war sichtbar oder wurde angefordert), ist das Originalbild verdeckt,
   * wann immer gerade keine Oberfläche steht: beim Ein- und Ausblenden, beim kurzen Zwischenbild des Startmenüs.
   * Ende: das Spiel ist wieder in Ruhe (Oberwelt/Kampf ohne Überblendung), ein unbekannter Originalbildschirm steht
   * oder die Zeit ist abgelaufen - dann ist wieder alles sichtbar.
   */
  _updateCover(snap, m, screenSkin) {
    const cv = this.cv;
    const f = this.input.frame;
    if (this.suppress !== null && m && m.screen === this.suppress) cv.armed = false;
    if (screenSkin) {
      cv.armed = true;
      cv.saw = true;
      cv.since = 0;
      cv.calm = 0;
      cv.calmSince = 0;
      cv.quiet = 0;
      cv.quietSince = 0;
      cv.sm = 0;
      return this._setCover(false);
    }
    if (!cv.armed || !snap) return this._setCover(false);
    if (!cv.since) cv.since = f;

    const fl = snap.flags;
    const inBattle = !!(fl & FLAG.IN_BATTLE);
    const settled = !snap.fading && !snap.startMenu;
    const calmNow = settled && (inBattle ? !!(fl & FLAG.BATTLE_MAIN) : !!(fl & FLAG.OVERWORLD));
    // Zeiten in Spiel-Bildern messen (ein Takt kann mehrere Bilder umfassen, ein Bild kann auch mehrere Takte haben)
    if (calmNow) { if (!cv.calm) cv.calmSince = f; cv.calm++; } else cv.calm = 0;
    if (settled) { if (!cv.quiet) cv.quietSince = f; cv.quiet++; } else cv.quiet = 0;
    cv.sm = snap.startMenu && !snap.fading ? cv.sm + 1 : 0;
    const calmF = cv.calm ? f - cv.calmSince : 0;
    const quietF = cv.quiet ? f - cv.quietSince : 0;

    // Das Spiel öffnet nach dem Schließen wieder das Startmenü - das wird sofort zugemacht
    if (cv.saw && cv.sm >= 4 && !this.input.running && f - cv.lastB > 40) {
      cv.lastB = f;
      this.input.tap('B');
    }

    const known = !!m && m.screen !== SCREEN.NONE;
    // Beim Öffnen: der angeforderte Bildschirm lädt erst (viele Bilder ohne Überblendung) - die Oberfläche kommt gleich
    const expecting = !cv.saw && f - cv.armedAt < 150 && (!known || SKIN_SCREENS.has(m.screen));
    let done = false;
    const aged = f - cv.armedAt >= cv.minHold;
    if (aged && cv.calm >= 4 && calmF >= 8) done = true; // wieder in Ruhe
    else if (aged && !expecting && quietF > (known ? 30 : 50)) done = true; // Originalbildschirm ohne Oberfläche (oder unbekannt)
    else if (f - cv.since > 180) done = true; // Notbremse
    if (done) {
      cv.armed = false;
      cv.saw = false;
      return this._setCover(false);
    }
    return this._setCover(true);
  }

  _setCover(on) {
    if (this.cv.on !== on) {
      this.cv.on = on;
      this.app.classList.toggle('cover', on);
    }
  }

  /** X-Taste: true, wenn die Oberfläche das selbst erledigt (nur eine Ebene zurück) */
  onX() {
    const scr = this.m ? this.m.screen : SCREEN.NONE;
    if (scr === SCREEN.TRAINER) { this._closeTrainer(); return true; }
    const inDex = scr === SCREEN.DEX || scr === SCREEN.SUMMARY;
    if (inDex || this.vis.sheet.on || this.vis.bag.on || this.vis.party.on || this.vis.opt.on || this.vis.dex.on || this.vis.dexInfo.on || this.vis.shop.on) {
      this.input.clearQueue();
      this.input.tap('B');
      return true;
    }
    return false;
  }

  // ---------- Beutel: Liste und Taschen ----------
  _resetBag() {
    if (this.cache) {
      this.cache = null;
      this.listKey = '';
      this.listPocket = -1;
      this.pending = -1;
      this.listEl.innerHTML = '';
    }
  }

  _renderBag(m) {
    const c = this.cache;
    if (!c || !m || !m.bag) return;
    const pocket = m.bag.pocket;
    const loading = !m.bag.valid;
    const selling = c.location === ITEMMENU_SHOP;
    const title = selling ? 'Verkaufen' : 'Beutel';
    if (this.bsTitle.textContent !== title) this.bsTitle.textContent = title;
    this.bsMoney.classList.toggle('on', selling);
    if (selling) {
      const mt = `<b>${num(m.bag.money)}</b>`;
      if (this._bsMoneyHtml !== mt) { this._bsMoneyHtml = mt; this.bsMoney.innerHTML = mt; }
    }

    // Taschen-Leiste
    for (const b of this.tabsEl.children) {
      const i = +b.dataset.p;
      b.classList.toggle('on', i === pocket);
      const ic = b.firstChild;
      if (!ic.firstChild && this.data.ready) {
        const url = this.data.itemIcon(POCKETS[i].icon);
        if (url) ic.innerHTML = `<img alt="" src="${url}">`;
      }
    }

    // Liste nur neu bauen, wenn sich der Inhalt ändert
    if (!loading) {
      const rows = c.items.filter((it) => !it.cancel);
      const key = [c.pocket, c.registered, c.location, this.data.ready ? 1 : 0, rows.map((r) => r.id + ':' + r.qty).join(',')].join('|');
      if (key !== this.listKey) {
        const keep = this.listPocket === c.pocket ? this.listEl.scrollTop : -1;
        this.listKey = key;
        this._buildList(c, rows);
        if (keep >= 0) this.listEl.scrollTop = keep;
        else this._scrollToSel(m.bag.sel);
        this.listPocket = c.pocket;
      }
      // Markierung: Cursor des Spiels
      const rowsEl = this.listEl.children;
      for (let i = 0; i < rowsEl.length; i++) {
        const el = rowsEl[i];
        if (!el.dataset || el.dataset.i === undefined) continue;
        el.classList.toggle('sel', +el.dataset.i === m.bag.sel);
        if (this.pending >= 0 && m.sub !== BAG_SUB.LIST) el.classList.remove('busy');
      }
      if (m.sub !== BAG_SUB.LIST) this.pending = -1;
    }
    this.listEl.classList.toggle('loading', loading);
  }

  _scrollToSel(sel) {
    const el = this.listEl.querySelector(`.bs-row[data-i="${sel}"]`);
    if (el) this.listEl.scrollTop = Math.max(0, el.offsetTop - this.listEl.clientHeight / 2 + el.offsetHeight / 2);
    else this.listEl.scrollTop = 0;
  }

  _buildList(c, rows) {
    const d = this.data;
    const keyPocket = c.pocket === 4;
    const frag = document.createDocumentFragment();
    if (!rows.length) {
      const e = document.createElement('div');
      e.className = 'bs-empty';
      e.textContent = 'Diese Tasche ist leer';
      frag.appendChild(e);
    }
    rows.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'bs-row';
      b.dataset.i = i;
      const icon = d.ready ? d.itemIcon(it.id) : null;
      const desc = d.ready ? d.itemDesc(it.id) : '';
      const name = itemLabel(d, it, c.pocket);
      const star = c.registered && it.id === c.registered ? '<i class="bs-star">★</i>' : '';
      b.innerHTML =
        `<span class="bs-ic">${icon ? `<img alt="" src="${icon}">` : ''}</span>` +
        `<span class="bs-tx"><b>${esc(name)}</b>${star}<small>${esc(desc)}</small></span>` +
        `<span class="bs-q">${keyPocket ? '' : '×' + it.qty}${c.location === ITEMMENU_SHOP && d.ready ? `<small class="bs-sp">${d.itemPrice(it.id) > 1 ? yen(d.itemPrice(it.id) >> 1) : 'nicht ankaufbar'}</small>` : ''}</span>`;
      frag.appendChild(b);
    });
    this.listEl.innerHTML = '';
    this.listEl.appendChild(frag);
  }

  // ---------- PokéMart ----------
  _resetShop() {
    if (this.shopCache) {
      this.shopCache = null;
      this.shopKey = '';
      this.pending = -1;
      this.shList.innerHTML = '';
      this.shMoney.classList.remove('on');
    }
  }

  _renderShop(sh) {
    if (!sh) return;
    const d = this.data;
    const mt = `<b>${num(sh.money)}</b>`;
    if (this._shMoneyHtml !== mt) { this._shMoneyHtml = mt; this.shMoney.innerHTML = mt; }
    this.shMoney.classList.add('on');

    const key = [d.ready ? 1 : 0, sh.money, sh.items.map((it) => it.id + ':' + it.price + ':' + it.owned).join(',')].join('|');
    if (key !== this.shopKey) {
      const first = !this.shopKey;
      const keep = this.shList.scrollTop;
      this.shopKey = key;
      const frag = document.createDocumentFragment();
      sh.items.forEach((it, i) => {
        const b = document.createElement('button');
        const poor = it.price > sh.money;
        b.className = 'bs-row' + (poor ? ' poor' : '');
        b.dataset.i = i;
        const icon = d.ready ? d.itemIcon(it.id) : null;
        const desc = d.ready ? d.itemDesc(it.id) : '';
        const name = d.ready ? d.itemName(it.id) : '???';
        b.innerHTML =
          `<span class="bs-ic">${icon ? `<img alt="" src="${icon}">` : ''}</span>` +
          `<span class="bs-tx"><b>${esc(name)}</b><small>${esc(desc)}</small></span>` +
          `<span class="sh-price"><b>${yen(it.price)}</b><small>${it.owned > 0 ? 'Im Beutel: ' + it.owned : ''}</small></span>`;
        frag.appendChild(b);
      });
      this.shList.innerHTML = '';
      this.shList.appendChild(frag);
      this.shList.scrollTop = first ? 0 : keep;
    }
    const rows = this.shList.children;
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i];
      el.classList.toggle('sel', +el.dataset.i === sh.sel);
      if (this.pending >= 0 && sh.sub !== SHOP_SUB.LIST) el.classList.remove('busy');
    }
    if (sh.sub !== SHOP_SUB.LIST) this.pending = -1;
  }

  _shopSheet(snap, m) {
    const sh = m.shop;
    const labels = this._labels(snap, m);
    switch (sh.sub) {
      case SHOP_SUB.HUB:
        return labels ? { kind: 'mart', labels, money: sh.money, arm: sh.martType === 0 } : null;
      case SHOP_SUB.QTY:
        return { kind: 'sqty', shop: sh };
      case SHOP_SUB.MSG:
        if (labels) return { kind: 'ask', text: sh.msg, labels };
        if (!sh.msg) return null;
        return { kind: shopAuto(sh.msg) ? 'bubble' : 'msg', text: sh.msg };
    }
    return null;
  }

  // ---------- Pokédex ----------
  _resetDex() {
    if (this.dexCache) {
      this.dexCache = null;
      this.dexKey = '';
      this.dexInfoKey = '';
      this.iconQueue = [];
      this.dxList.innerHTML = '';
      this.diBody.innerHTML = '';
    }
  }

  _dexNumber(e, mode) {
    const d = this.data;
    let n = e.dex;
    if (mode === 0 && d.ready) {
      const sp = d.dexSpecies(e.dex);
      const h = sp ? d.hoennNum(sp) : 0;
      if (h) n = h;
    }
    return 'Nr. ' + String(n).padStart(3, '0');
  }

  _renderDex(dx) {
    const d = this.data;
    const key = [d.ready ? 1 : 0, dx.mode, dx.order, dx.count, dx.list.map((e) => e.dex + (e.seen ? 's' : '') + (e.owned ? 'o' : '')).join(',')].join('|');
    this.dxCount.textContent = `${dx.mode === 0 ? 'Hoenn' : 'National'}  ·  ${dx.seen} gesehen  ·  ${dx.own} gefangen`;
    if (key !== this.dexKey) {
      const keep = this.dexKey ? this.dxList.scrollTop : -1;
      this.dexKey = key;
      this.iconQueue = [];
      const ball = d.ready ? d.itemIcon(4) : null;
      const frag = document.createDocumentFragment();
      if (!dx.count) {
        const e = document.createElement('div');
        e.className = 'dx-empty';
        e.textContent = 'Du hast noch kein Pokémon gesehen';
        frag.appendChild(e);
      }
      dx.list.forEach((e, i) => {
        const b = document.createElement('button');
        b.className = 'dx-row' + (e.seen ? '' : ' unseen');
        b.dataset.i = i;
        const sp = e.seen && d.ready ? d.dexSpecies(e.dex) : 0;
        const name = e.seen ? (sp ? d.speciesName(sp) : '???') : '- - - - -';
        b.innerHTML =
          `<span class="dx-ic">${e.seen ? '' : '?'}</span>` +
          `<span class="dx-tx"><small>${this._dexNumber(e, dx.mode)}</small><b>${esc(name)}</b></span>` +
          `<span class="dx-ball">${e.owned && ball ? `<img alt="" src="${ball}">` : ''}</span>`;
        if (sp) this.iconQueue.push([b.firstChild, sp]);
        frag.appendChild(b);
      });
      this.dxList.innerHTML = '';
      this.dxList.appendChild(frag);
      if (keep >= 0) this.dxList.scrollTop = keep;
      else this._scrollDexTo(dx.sel, true);
    }
    // Symbole nach und nach laden (sonst ruckelt das Öffnen)
    for (let k = 0; k < 24 && this.iconQueue.length; k++) {
      const [el, sp] = this.iconQueue.shift();
      const url = d.monIcon(sp);
      if (url) el.innerHTML = `<img alt="" src="${url}">`;
    }
    // Cursor des Spiels
    const sel = this.dxList.querySelector('.dx-row.sel');
    if (!sel || +sel.dataset.i !== dx.sel) {
      if (sel) sel.classList.remove('sel');
      const el = this.dxList.querySelector(`.dx-row[data-i="${dx.sel}"]`);
      if (el) el.classList.add('sel');
    }
    if (dx.sub === DEX_SUB.LIST) for (const el of this.dxList.querySelectorAll('.dx-row.busy')) if (!this.input.running) el.classList.remove('busy');
  }

  _scrollDexTo(sel, center) {
    const el = this.dxList.querySelector(`.dx-row[data-i="${sel}"]`);
    if (el) this.dxList.scrollTop = Math.max(0, el.offsetTop - this.dxList.clientHeight / 2 + el.offsetHeight / 2);
    else this.dxList.scrollTop = 0;
  }

  _renderDexInfo(dx) {
    const d = this.data;
    const key = [d.ready ? 1 : 0, dx.infoDex, dx.infoSeen ? 1 : 0, dx.infoOwned ? 1 : 0, dx.selScreen, dx.mode].join('|');
    if (key === this.dexInfoKey) return;
    this.dexInfoKey = key;
    const sp = d.ready ? d.dexSpecies(dx.infoDex) : 0;
    const entry = d.ready ? d.dexEntry(dx.infoDex) : null;
    const types = sp ? d.speciesTypes(sp) : null;
    const t1 = types ? TYPES[types[0]] || TYPES[0] : TYPES[0];
    const front = sp && dx.infoSeen ? d.monFront(sp) : null;
    const name = sp ? d.speciesName(sp) : '???';
    this.diNo.textContent = this._dexNumber({ dex: dx.infoDex }, dx.mode);
    const typeChips = types && dx.infoSeen
      ? [...new Set(types)].map((t) => { const T = TYPES[t] || TYPES[0]; return `<span class="mv-type" style="--tc:${T.color}">${T.name}</span>`; }).join('')
      : '';
    const owned = dx.infoOwned;
    const cat = entry && dx.infoSeen ? titleCase(entry.category) + ' Pokémon' : '';
    const h = owned && entry ? (entry.height / 10).toFixed(1).replace('.', ',') + ' m' : '???';
    const w = owned && entry ? (entry.weight / 10).toFixed(1).replace('.', ',') + ' kg' : '???';
    const nav = [
      ['0', 'Gebiet', 'blue', false], ['1', 'Ruf', 'amber', false], ['2', 'Größe', 'go', !owned],
    ].map(([a, t, c, off]) => `<button class="gba-btn as-btn c-${c}" data-dx="${a}"${off ? ' disabled' : ''}><b>${t}</b></button>`).join('');
    this.diBody.innerHTML =
      '<div class="gba-win di-card">' +
      `<div class="di-pic" style="--tc:${t1.color}">${front ? `<img alt="" src="${front}">` : '<span class="di-q">?</span>'}</div>` +
      `<div class="di-name"><b>${esc(name)}</b>${owned ? '<small>Gefangen</small>' : '<small>Nur gesehen</small>'}</div>` +
      (cat ? `<div class="di-cat">${esc(cat)}</div>` : '') +
      `<div class="di-types">${typeChips}</div>` +
      `<div class="di-facts"><div class="di-fact"><small>Größe</small><b>${h}</b></div><div class="di-fact"><small>Gewicht</small><b>${w}</b></div></div>` +
      (owned && entry && entry.desc ? `<p class="di-desc">${esc(entry.desc)}</p>` : '<p class="di-note">Fange dieses Pokémon, um mehr zu erfahren.</p>') +
      '</div>' +
      `<div class="di-navs"><div class="di-nav">${nav}</div>` +
      '<div class="di-nav">' +
      '<button class="gba-btn as-btn c-grey" data-dx="prev"><b>Vorige</b></button>' +
      '<button class="gba-btn as-btn c-red" data-dx="back"><b>Zurück</b></button>' +
      '<button class="gba-btn as-btn c-grey" data-dx="next"><b>Nächste</b></button></div></div>';
    this.diBody.scrollTop = 0;
  }

  // ---------- Pokémon-Details ----------
  _typeChips(species) {
    const d = this.data;
    const types = species && d.ready ? d.speciesTypes(species) : null;
    if (!types) return '';
    return [...new Set(types)].map((t) => { const T = TYPES[t] || TYPES[0]; return `<span class="mv-type" style="--tc:${T.color}">${T.name}</span>`; }).join('');
  }

  _renderSummary(sm) {
    const d = this.data;
    const key = JSON.stringify([d.ready ? 1 : 0, sm, this.sumMove]);
    if (key === this.sumKey) return;
    this.sumKey = key;
    const keep = this.smBody.scrollTop;
    const sp = sm.species;
    const T0 = sp && d.ready ? d.speciesTypes(sp) : null;
    const t1 = T0 ? TYPES[T0[0]] || TYPES[0] : TYPES[0];
    const front = sp && d.ready ? (d.monFront(sp)) : null;
    const species = sp && d.ready ? d.speciesName(sp) : '';
    const egg = sm.isEgg;
    const name = egg ? 'EI' : sm.nick || species;
    const gender = sm.gender === 0 ? '<i class="ps-g m">♂</i>' : sm.gender === 254 ? '<i class="ps-g f">♀</i>' : '';
    const ratio = sm.maxHp > 0 ? Math.max(0, Math.min(1, sm.hp / sm.maxHp)) : 0;
    const col = ratio > 0.5 ? 'g' : ratio > 0.2 ? 'y' : 'r';
    const st = !egg && AILMENTS[sm.ailment] ? AILMENTS[sm.ailment] : null;
    const item = sm.item && d.ready ? d.itemName(sm.item) : '';
    const itemIc = sm.item && d.ready ? d.itemIcon(sm.item) : null;
    this.smNo.textContent = egg ? 'Ei' : (sm.maxMon > 0 ? `${sm.curMon + 1} / ${sm.maxMon + 1}` : '');

    let h = '<div class="gba-win di-card">' +
      `<div class="di-pic sm-pic" style="--tc:${egg ? '#d8d0a0' : t1.color}">${front ? `<img alt="" src="${front}">` : '<span class="di-q">?</span>'}${sm.shiny ? '<i class="sm-shiny">✦</i>' : ''}</div>` +
      `<div class="di-name"><b>${esc(name)}</b>${gender}${egg ? '' : `<small>Lv ${sm.level}</small>`}</div>`;
    if (!egg && sm.nick && species && sm.nick.toUpperCase() !== species.toUpperCase()) h += `<div class="di-cat">${esc(titleCase(species))}</div>`;
    if (!egg) {
      h += `<div class="di-types">${this._typeChips(sp)}${st ? `<span class="sm-st s-${st[1]}">${st[0]}</span>` : ''}</div>`;
      h += `<div class="sm-hp"><span class="b-hp"><span class="b-hp-label">KP</span><span class="b-bar"><i class="${col}" style="width:${ratio * 100}%"></i></span><span class="ps-num">${sm.hp}/${sm.maxHp}</span></span></div>`;
      h += `<div class="sm-line">Erfahrung ${sm.exp}${sm.expNext ? ` · bis Level ${sm.level + 1}: ${sm.expNext}` : ''}</div>`;
      h += `<div class="sm-line">${itemIc ? `<img alt="" src="${itemIc}">` : ''}${item ? esc(titleCase(item)) : 'Kein Item'}</div>`;
    } else {
      const f = sm.friendship;
      h += `<p class="sm-note">${EGG_TEXT[f <= 5 ? 0 : f <= 10 ? 1 : f <= 40 ? 2 : 3]}</p>`;
    }
    h += '</div>';

    if (!egg) {
      // Werte
      const nat = sm.nature;
      const up = NATURE_STAT[Math.floor(nat / 5) % 5], down = NATURE_STAT[nat % 5];
      const neutral = Math.floor(nat / 5) === nat % 5;
      h += '<div class="gba-win di-card"><h3 class="sm-h">Werte</h3><div class="sm-stats">';
      for (let i = 0; i < 5; i++) {
        const cls = neutral ? '' : i === up ? ' up' : i === down ? ' down' : '';
        h += `<div class="sm-stat${cls}"><span class="n">${STAT_NAMES[i]}</span><span class="sm-bar"><i style="width:${Math.min(100, (sm.stat[i] / 300) * 100)}%"></i></span><span class="v">${sm.stat[i]}</span></div>`;
      }
      h += '</div>';
      const nn = d.ready ? d.natureName(nat) : '';
      const an = d.ready ? d.abilityName(sm.ability) : '';
      const ad = d.ready ? d.abilityDesc(sm.ability) : '';
      if (nn) h += `<p class="sm-note"><b>Wesen</b> ${esc(titleCase(nn))}${neutral ? '' : ` (+${STAT_NAMES[up]}, −${STAT_NAMES[down]})`}</p>`;
      if (an) h += `<p class="sm-note"><b>Fähigkeit</b> ${esc(titleCase(an))}<br>${esc(ad)}</p>`;
      h += '</div>';

      // Attacken
      h += '<div class="gba-win di-card"><h3 class="sm-h">Attacken</h3>';
      for (let i = 0; i < 4; i++) {
        const mv = sm.moves[i];
        if (!mv) { h += '<div class="sm-move empty"><span></span><b>–</b><span></span></div>'; continue; }
        const info = d.ready ? d.moveInfo(mv) : null;
        const T = info ? TYPES[info.type] || TYPES[0] : TYPES[0];
        const low = sm.ppMax[i] > 0 && sm.pp[i] / sm.ppMax[i] <= 0.25;
        h += `<button class="sm-move" data-sm="mv" data-i="${i}" style="--tc:${T.color}"><span class="mv-type">${T.name}</span><b>${esc(d.ready ? d.moveName(mv) : '?')}</b><span class="pp${low ? ' low' : ''}">AP ${sm.pp[i]}/${sm.ppMax[i]}</span></button>`;
        if (this.sumMove === i && d.ready) {
          h += `<div class="sm-mdesc">${esc(d.moveDesc(mv))}<small>Stärke ${info && info.power ? info.power : '–'} · Genauigkeit ${info && info.acc ? info.acc : '–'}</small></div>`;
        }
      }
      h += '</div>';

      // Trainer
      const otc = sm.otGender === 1 ? 'f' : 'm';
      h += '<div class="gba-win di-card"><h3 class="sm-h">Trainer-Info</h3>' +
        `<p class="sm-note"><b>Trainer</b> <span class="sm-ot ${otc}">${esc(sm.ot)}</span> · ID ${String(sm.otId).padStart(5, '0')}</p>` +
        `<p class="sm-note"><b>Freundschaft</b> ${sm.friendship} / 255</p>` +
        `<p class="sm-note"><b>Herkunft</b> ${sm.metLevel > 0 ? `Gefangen bei Lv ${sm.metLevel}` : 'Aus dem Ei geschlüpft'}${sm.ribbons ? ` · ${sm.ribbons} Band${sm.ribbons > 1 ? 'er' : ''}` : ''}</p></div>`;
    }

    h += '<div class="di-navs"><div class="di-nav">';
    if (sm.maxMon > 0) h += '<button class="gba-btn as-btn c-grey" data-sm="prev"><b>Vorige</b></button>';
    else h += '<span></span>';
    h += '<button class="gba-btn as-btn c-red" data-sm="back"><b>Zurück</b></button>';
    if (sm.maxMon > 0) h += '<button class="gba-btn as-btn c-grey" data-sm="next"><b>Nächste</b></button>';
    h += '</div><button class="sm-orig" data-sm="orig">Originalansicht</button></div>';
    this.smBody.innerHTML = h;
    this.smBody.scrollTop = keep;
  }

  /** Details: zum vorigen (Up) oder nächsten (Down) Pokémon wechseln. */
  async sumStep(key) {
    const inp = this.input;
    const st = () => { const n = this.fresh(); return n && n.screen === SCREEN.SUMMARY && n.summary ? n.summary : null; };
    const d = st();
    if (!d || d.sub !== PAGE_SUB.IDLE) return false;
    const before = d.curMon;
    this.sumMove = -1;
    inp.tap(key, 3);
    const moved = await inp.waitUntil(() => { const k = st(); return !k || k.curMon !== before || k.sub !== PAGE_SUB.IDLE; }, 30);
    if (!moved) return false;
    await inp.waitUntil(() => { const k = st(); return !k || k.sub === PAGE_SUB.IDLE; }, 120);
    return true;
  }

  // ---------- Trainerkarte ----------
  _closeTrainer() {
    const m = this.m;
    const back = m && m.screen === SCREEN.TRAINER && m.trainer && m.trainer.sub === PAGE_SUB.BACK;
    this.input.clearQueue();
    this.input.tap(back ? 'A' : 'B'); // Rückseite: A schließt, Vorderseite: B schließt
  }

  _renderTrainer(t) {
    const d = this.data;
    const key = JSON.stringify(t);
    if (key === this.trKey) return;
    this.trKey = key;
    const keep = this.trBody.scrollTop;
    const f = t.gender === 1;
    const stars = '★'.repeat(t.stars) + `<span class="off">${'★'.repeat(Math.max(0, 4 - t.stars))}</span>`;
    const time = `${t.hours}:${String(t.minutes).padStart(2, '0')}`;
    let h = '<div class="gba-win di-card">' +
      `<div class="tr-top"><div class="tr-av${f ? ' f' : ''}">${f ? '♀' : '♂'}</div><div><b class="tr-name">${esc(t.name)}</b><small>ID-Nr. ${String(t.id).padStart(5, '0')}</small></div><div class="tr-stars">${stars}</div></div>` +
      '<div class="tr-rows">' +
      `<div class="tr-row"><small>Geld</small><b>¥${t.money.toLocaleString('de-DE')}</b></div>` +
      (t.hasDex ? `<div class="tr-row"><small>Pokédex</small><b>${t.dex}</b></div>` : '') +
      `<div class="tr-row"><small>Spielzeit</small><b>${time}</b></div>`;
    if (t.hasHof) h += `<div class="tr-row"><small>Ruhmeshalle</small><b>${t.hofH}:${String(t.hofM).padStart(2, '0')}:${String(t.hofS).padStart(2, '0')}</b></div>`;
    if (t.hasTrades) h += `<div class="tr-row"><small>Tausche</small><b>${t.trades}</b></div>`;
    if (t.hasLink) h += `<div class="tr-row"><small>Link-Kämpfe</small><b>${t.linkWins} Siege / ${t.linkLosses} Niederlagen</b></div>`;
    if (t.hasBt) h += `<div class="tr-row"><small>Kampfturm</small><b>${t.btWins} Siege (${t.btStraight} in Folge)</b></div>`;
    h += '</div><h3 class="sm-h">Orden</h3><div class="tr-badges">';
    BADGES.forEach(([n, c], i) => {
      const on = !!(t.badges & (1 << i));
      h += `<div class="tr-badge${on ? ' on' : ''}" style="--bc:${c}"><i></i><small>${n}</small></div>`;
    });
    h += '</div></div>' +
      '<div class="di-navs"><div class="di-nav one"><button class="gba-btn as-btn c-red" data-tr="back"><b>Schließen</b></button></div>' +
      '<button class="sm-orig" data-tr="orig">Originalansicht</button></div>';
    this.trBody.innerHTML = h;
    this.trBody.scrollTop = keep;
  }

  // ---------- Optionen ----------
  _renderOptions(snap) {
    if (!this.optBuilt) {
      this.optBuilt = true;
      const frag = document.createDocumentFragment();
      OPTIONS.forEach((o, r) => {
        const d = document.createElement('div');
        d.className = 'gba-win os-row';
        d.dataset.r = r;
        let body;
        if (o.frame) {
          body = `<div class="os-frame"><button class="os-opt" data-row="${r}" data-step="-1">◀</button><div class="os-fv" id="osFrame"></div><button class="os-opt" data-row="${r}" data-step="1">▶</button></div>`;
        } else {
          body = '<div class="os-seg">' + o.vals.map((v, i) => `<button class="os-opt" data-row="${r}" data-v="${i}">${v}</button>`).join('') + '</div>';
        }
        d.innerHTML = `<div class="os-name">${o.name}${o.hint ? `<small>${o.hint}</small>` : ''}</div>${body}`;
        frag.appendChild(d);
      });
      const done = document.createElement('button');
      done.className = 'gba-btn as-btn c-go os-done';
      done.dataset.row = 6;
      done.innerHTML = '<b>Fertig</b>';
      frag.appendChild(done);
      this.osList.innerHTML = '';
      this.osList.appendChild(frag);
    }
    const vals = snap.opt.values;
    for (const row of this.osList.querySelectorAll('.os-row')) {
      const r = +row.dataset.r;
      row.classList.toggle('sel', r === snap.cursor);
      row.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', +b.dataset.v === vals[r]));
    }
    const f = this.osList.querySelector('#osFrame');
    if (f) f.textContent = 'Typ ' + (vals[5] + 1);
  }

  /** Optionszeile `row` auf Wert `want` stellen (oder bei Rahmen um `step` weiterschalten). */
  async optionsSet(row, want, step) {
    const inp = this.input;
    if (!(await inp.selectIndex(row))) return;
    await inp.wait(1);
    const cur = () => (inp.snap && inp.snap.opt ? inp.snap.opt.values[row] : -1);
    if (step) {
      const before = cur();
      inp.tap(step < 0 ? 'Left' : 'Right', 3);
      await inp.waitUntil(() => cur() !== before, 12);
      return;
    }
    const n = OPTIONS[row].vals.length;
    for (let i = 0; i < 4 && want >= 0 && cur() !== want; i++) {
      const before = cur();
      const diff = (want - before + n) % n;
      inp.tap(diff <= n / 2 ? 'Right' : 'Left', 3);
      await inp.waitUntil(() => cur() !== before, 12);
      await inp.wait(1);
    }
  }

  // ---------- Team ----------
  _renderParty(m) {
    const p = m && m.party ? m.party : this.partyCache;
    if (!p) return;
    const d = this.data;
    const key = [d.ready ? 1 : 0, p.mons.map((x) => (x ? [x.species, x.hp, x.maxHp, x.level, x.status, x.item, x.gender, x.name].join(':') : '-')).join('|')].join('#');
    if (key !== this.partyKey) {
      this.partyKey = key;
      const frag = document.createDocumentFragment();
      p.mons.forEach((x, i) => {
        if (!x) return;
        const b = document.createElement('button');
        b.className = 'ps-card' + (x.hp === 0 && !x.egg ? ' fnt' : '');
        b.dataset.i = i;
        const icon = d.ready ? d.monIcon(x.species) : null;
        const ratio = x.maxHp > 0 ? Math.max(0, Math.min(1, x.hp / x.maxHp)) : 0;
        const col = ratio > 0.5 ? 'g' : ratio > 0.2 ? 'y' : 'r';
        const st = x.egg ? null : statusOf(x);
        const item = x.item && d.ready ? d.itemIcon(x.item) : null;
        const gender = x.gender === 0 ? '<i class="ps-g m">♂</i>' : x.gender === 254 ? '<i class="ps-g f">♀</i>' : '';
        b.innerHTML =
          `<span class="ps-ic">${icon ? `<img alt="" src="${icon}">` : ''}</span>` +
          '<span class="ps-main">' +
          `<span class="ps-top"><b>${esc(x.egg ? 'EI' : x.name)}</b>${gender}${x.egg ? '' : `<span class="ps-lv">Lv${x.level}</span>`}</span>` +
          (x.egg ? '' : `<span class="b-hp"><span class="b-hp-label">KP</span><span class="b-bar"><i class="${col}" style="width:${ratio * 100}%"></i></span><span class="ps-num">${x.hp}/${x.maxHp}</span></span>`) +
          '</span>' +
          `<span class="ps-side">${st ? `<span class="ps-st s-${st[1]}">${st[0]}</span>` : ''}${item ? `<img class="ps-item" alt="" src="${item}">` : ''}</span>`;
        frag.appendChild(b);
      });
      if (p.chooseHalf) {
        const ok = document.createElement('button');
        ok.className = 'gba-btn as-btn c-go ps-confirm';
        ok.dataset.i = 6;
        ok.innerHTML = '<b>Bestätigen</b>';
        frag.appendChild(ok);
      }
      this.psList.innerHTML = '';
      this.psList.appendChild(frag);
    }
    for (const el of this.psList.children) {
      const i = +el.dataset.i;
      el.classList.toggle('sel', i === p.cursor);
      if (m && m.sub !== PARTY_SUB.LIST) el.classList.remove('busy');
    }
    const pr = p.prompt ? PROMPTS[p.prompt] || p.prompt : '';
    if (this.psPrompt.textContent !== pr) this.psPrompt.textContent = pr;
  }

  _partySheet(snap, m) {
    const p = m.party;
    const labels = this._labels(snap, m);
    const mon = p.mons[p.cursor] || null;
    if (m.sub === PARTY_SUB.CONTEXT && p.ctx) return { kind: 'pctx', mon, labels: p.ctx };
    if (m.sub === PARTY_SUB.OTHER) {
      if (labels) return { kind: 'ask', text: p.msg || p.prompt, labels };
      if (p.msgOpen && p.msg) return { kind: 'msg', text: p.msg };
    }
    return null;
  }

  _monInfo(mon) {
    if (!mon) return '';
    const d = this.data;
    const icon = d.ready ? d.monIcon(mon.species) : null;
    const ratio = mon.maxHp > 0 ? Math.max(0, Math.min(1, mon.hp / mon.maxHp)) : 0;
    const col = ratio > 0.5 ? 'g' : ratio > 0.2 ? 'y' : 'r';
    return '<div class="gba-win as-card"><div class="as-item">' +
      `<span class="bs-ic">${icon ? `<img alt="" src="${icon}">` : ''}</span>` +
      `<div class="as-tx"><b>${esc(mon.egg ? 'EI' : mon.name)}</b>${mon.egg ? '' : `<small>Lv${mon.level}</small>`}</div></div>` +
      (mon.egg ? '' : `<div class="b-hp"><span class="b-hp-label">KP</span><span class="b-bar"><i class="${col}" style="width:${ratio * 100}%"></i></span><span class="ps-num">${mon.hp}/${mon.maxHp}</span></div>`) +
      '</div>';
  }

  // ---------- Aktionsfenster ----------
  /** Beschreibt, was im Aktionsfenster stehen soll (oder null) */
  _bagSheet(snap, m) {
    const bag = m.bag;
    const labels = this._labels(snap, m);
    const item = bag.valid && bag.items[bag.sel] ? Object.assign({ pocket: bag.pocket }, bag.items[bag.sel]) : null;
    if (m.sub === BAG_SUB.QTY) return { kind: 'qty', item, bag };
    if (m.sub === BAG_SUB.CONTEXT && bag.ctx) return { kind: 'ctx', item, labels: bag.ctx };
    if (m.sub === BAG_SUB.WAIT) return { kind: 'msg', text: bag.msg };
    if (m.sub === BAG_SUB.OTHER) {
      if (labels) return { kind: 'ask', text: bag.msg, labels };
      if (bag.msgOpen) return { kind: 'msg', text: bag.msg };
    }
    return null;
  }

  /** Auswahlfenster außerhalb des Beutels (Ja/Nein, Kauf-Menü ...) */
  _genericSheet(snap, m) {
    const labels = this._labels(snap, m);
    if (!labels || snap.count < 2 || snap.count > 8) return null;
    return { kind: 'generic', labels };
  }

  _itemInfo(item) {
    const d = this.data;
    if (!item || !item.id) return '';
    const icon = d.ready ? d.itemIcon(item.id) : null;
    const desc = d.ready ? d.itemDesc(item.id) : '';
    const name = itemLabel(d, item, item.pocket);
    let mv = '';
    if (item.move && d.ready) {
      const info = d.moveInfo(item.move);
      const t = info ? TYPES[info.type] || TYPES[0] : TYPES[0];
      const mname = d.moveName(item.move);
      mv = `<div class="as-move" style="--tc:${t.color}"><span class="mv-type">${t.name}</span><b>${esc(mname)}</b>` +
        (info ? `<small>Stärke ${info.power || '–'} · Genauigkeit ${info.acc || '–'} · AP ${info.pp}</small>` : '') + '</div>';
    }
    return '<div class="gba-win as-card">' +
      `<div class="as-item"><span class="bs-ic">${icon ? `<img alt="" src="${icon}">` : ''}</span>` +
      `<div class="as-tx"><b>${esc(name)}</b>${item.qty > 0 ? `<small>×${item.qty}</small>` : ''}</div></div>` +
      (desc ? `<p class="as-desc">${esc(desc)}</p>` : '') + mv + '</div>';
  }

  /** Hauptmenü: Spielstand-Karte + große Knöpfe (Eintrag i = Position im Spiel) */
  _mainMenuHtml(mm) {
    const items = [];
    if (mm.type >= 1) items.push(['Weiterspielen', 'go']);
    items.push(['Neues Spiel', mm.type >= 1 ? 'blue' : 'go']);
    if (mm.type >= 2) items.push(['Mystery Gift', 'grey']);
    if (mm.type >= 3) items.push(['Mystery Events', 'grey']);
    items.push(['Optionen', 'grey']);
    let h = '<div class="mm-title"><b>Pokémon Smaragd</b><small>Hauptmenü</small></div>';
    if (mm.type >= 1) {
      const t = mm.hours + ':' + String(mm.minutes).padStart(2, '0');
      h += '<div class="gba-win as-card mm-save">' +
        `<div><small>Spieler</small><b>${esc(mm.name || '?')}</b></div>` +
        `<div><small>Spielzeit</small><b>${t}</b></div>` +
        `<div><small>Pokédex</small><b>${mm.dex >= 0 ? mm.dex : '–'}</b></div>` +
        `<div><small>Orden</small><b>${mm.badges}</b></div></div>`;
    }
    h += '<div class="as-btns mm-btns">' + items.map(([t, col], i) =>
      `<button class="gba-btn as-btn c-${col}" data-act="pick" data-i="${i}"><b>${t}</b></button>`).join('') + '</div>';
    return h;
  }

  _buttons(labels, arm) {
    return '<div class="as-btns">' + labels.map((t, i) => {
      const [text, col] = labelOf(t);
      const up = String(t).trim().toUpperCase();
      const a = arm && (up === 'BUY' || up === 'SELL') ? ' data-arm="1"' : '';
      return `<button class="gba-btn as-btn c-${col}" data-act="pick" data-i="${i}"${a}><b>${esc(text)}</b></button>`;
    }).join('') + '</div>';
  }

  /** Mengenrad + Preisangaben. mode: 'buy' | 'sell' | 'other' */
  _qtyHtml(item, mode, max, unit, owned, money, kindText) {
    const lines = [];
    if (mode !== 'other') lines.push(`<div class="qw-line"><span>${mode === 'buy' ? 'Preis' : 'Ankauf'}</span><b>${yen(unit)}</b></div>`);
    lines.push(`<div class="qw-line"><span>Im Beutel</span><b>${num(owned)}</b></div>`);
    if (mode !== 'other') lines.push(`<div class="qw-line"><span>Dein Geld</span><b>${yen(money)}</b></div>`);
    const total = mode === 'other' ? '' :
      `<div class="qw-total" id="qwTotal"><small>${mode === 'buy' ? 'Gesamtpreis' : 'Erlös'}</small><b id="qwSum"></b></div>` +
      '<div class="qw-line"><span>Danach</span><b id="qwAfter"></b></div>';
    let rows = '';
    for (let i = 1; i <= max; i++) rows += `<div class="qw-n" data-v="${i}">${i}</div>`;
    return this._itemInfo(Object.assign({}, item, { qty: 0 })) +
      `<span class="as-kind">${kindText} – wie viele?</span>` +
      '<div class="qw-wrap">' +
      `<div class="qw"><div class="qw-view" id="qwView"><div class="qw-pad"></div>${rows}<div class="qw-pad"></div></div><div class="qw-band"></div></div>` +
      `<div class="qw-info">${lines.join('')}${total}` +
      '<div class="qw-chips"><button class="qw-chip" data-act="wset" data-i="1">Min</button><button class="qw-chip" data-act="wset" data-i="2">Hälfte</button><button class="qw-chip" data-act="wset" data-i="3">Max</button></div>' +
      '</div></div>' +
      '<div class="as-btns"><button class="gba-btn as-btn c-red" data-act="back"><b>Abbrechen</b></button>' +
      `<button class="gba-btn as-btn c-go" data-act="wok" data-mode="${mode}"><b id="qwOk">OK</b></button></div>`;
  }

  _renderSheet(sh, on) {
    this.sheetKindNow = on && sh ? sh.kind : '';
    this.sheetEl.classList.toggle('on', on);
    this.backEl.classList.toggle('on', on && !!sh && sh.kind !== 'generic' && sh.kind !== 'bubble' && sh.kind !== 'forget' && sh.kind !== 'main');
    this.backEl.classList.toggle('blur', on && !!sh && sh.kind === 'mart');
    if (!on) { this.sheetKey = ''; this.wheel = null; }
    if (!sh) return;
    let key, html, setup = null;
    switch (sh.kind) {
      case 'ctx':
        key = 'ctx|' + sh.labels.join('/') + '|' + (sh.item ? sh.item.id : 0);
        html = () => this._itemInfo(sh.item) + this._buttons(sh.labels);
        break;
      case 'pctx':
        key = 'pctx|' + sh.labels.join('/') + '|' + (sh.mon ? sh.mon.species + ':' + sh.mon.name : 0);
        html = () => this._monInfo(sh.mon) + this._buttons(sh.labels);
        break;
      case 'ask':
        key = 'ask|' + sh.text + '|' + sh.labels.join('/');
        html = () => `<div class="gba-win as-card"><p class="as-msg">${esc(shopText(sh.text))}</p></div>` + this._buttons(sh.labels);
        break;
      case 'msg':
        key = 'msg|' + sh.text;
        html = () => `<div class="gba-win as-card"><p class="as-msg">${esc(shopText(sh.text))}</p></div>` +
          '<div class="as-btns"><button class="gba-btn as-btn c-go" data-act="next"><b>Weiter</b></button></div>';
        break;
      case 'bubble':
        key = 'bub|' + sh.text;
        html = () => `<div class="gba-win as-card"><p class="as-msg">${esc(shopText(sh.text))}</p></div>`;
        break;
      case 'mart':
        key = 'mart|' + sh.labels.join('/');
        html = () => '<div class="sh-hub-title"><b>PokéMart</b><span class="sh-money on"><b id="hubMoney">0</b></span></div>' +
          '<p class="sh-hub-clerk">Willkommen! Was darf es sein?</p>' + this._buttons(sh.labels, sh.arm);
        break;
      case 'forget': {
        const sm = sh.sum;
        key = 'fg|' + sm.moves.join(',') + '|' + sm.pp.join(',') + '|' + sh.labels[4] + '|' + sm.nick;
        html = () => {
          const d = this.data;
          let h = `<div class="gba-win as-card"><p class="as-msg">${esc(titleCase(sm.nick))} möchte ${esc(titleCase(sh.labels[4]))} lernen, kennt aber schon vier Attacken. Welche soll vergessen werden?</p></div><div class="fg-grid">`;
          for (let i = 0; i < 4; i++) {
            const mv = sm.moves[i];
            if (!mv) continue;
            const info = d.ready ? d.moveInfo(mv) : null;
            const T = info ? TYPES[info.type] || TYPES[0] : TYPES[0];
            const low = sm.ppMax[i] > 0 && sm.pp[i] / sm.ppMax[i] <= 0.25;
            h += `<button class="gba-btn move${low ? ' low' : ''}" data-act="pick" data-i="${i}" style="--tc:${T.color}"><span class="mv-type">${T.name}</span><b>${esc(d.ready ? d.moveName(mv) : '?')}</b><small>AP ${sm.pp[i]}/${sm.ppMax[i]}</small></button>`;
          }
          return h + '</div><div class="as-btns"><button class="gba-btn as-btn c-grey" data-act="pick" data-i="4"><b>Nicht lernen</b></button></div>';
        };
        break;
      }
      case 'generic':
        key = 'gen|' + sh.labels.join('/');
        html = () => this._buttons(sh.labels);
        break;
      case 'main': {
        const mm = sh.main;
        key = 'main|' + mm.type + '|' + mm.name + '|' + mm.dex + '|' + mm.hours + ':' + mm.minutes + '|' + mm.badges;
        html = () => this._mainMenuHtml(mm);
        break;
      }
      case 'sqty': {
        const s = sh.shop;
        const row = s.items.find((x) => x.id === s.item) || { price: 0, owned: 0 };
        const max = Math.max(1, s.qtyMax);
        key = 'sqty|' + s.item + '|' + max;
        const item = { id: s.item, qty: 0, pocket: -1 };
        const cfg = { mode: 'buy', max, unit: row.price, owned: row.owned, money: s.money, name: this.data.ready ? titleCase(this.data.itemName(s.item)) : 'Item' };
        html = () => this._qtyHtml(item, 'buy', max, row.price, row.owned, s.money, 'Kaufen');
        setup = () => this._initWheel(cfg);
        break;
      }
      case 'qty': {
        const b = sh.bag;
        const max = Math.max(1, b.qtyMax);
        const kindText = ['Wegwerfen', 'Verkaufen', 'Einlagern'][b.qtyKind] || 'Menge';
        const id = sh.item ? sh.item.id : 0;
        key = 'qty|' + id + '|' + b.qtyKind + '|' + max;
        const sell = b.qtyKind === 1;
        const unit = sell && this.data.ready ? this.data.itemPrice(id) >> 1 : 0;
        const cfg = { mode: sell ? 'sell' : 'other', max, unit, owned: max, money: b.money, name: sh.item && this.data.ready ? titleCase(itemLabel(this.data, sh.item, sh.item.pocket)) : 'Item' };
        html = () => this._qtyHtml(sh.item, cfg.mode, max, unit, max, b.money, kindText);
        setup = () => this._initWheel(cfg);
        break;
      }
    }
    if (key !== this.sheetKey) {
      this.sheetKey = key;
      this.wheel = null;
      this.sheetBody.innerHTML = html();
      if (setup) setup();
    }
    if (sh.kind === 'mart') {
      const e = this.sheetBody.querySelector('#hubMoney');
      if (e) e.textContent = num(sh.money);
    }
  }

  // ---------- Mengenrad ----------
  _initWheel(cfg) {
    const el = this.sheetBody.querySelector('#qwView');
    if (!el) return;
    this.wheel = Object.assign({ el, val: 1 }, cfg);
    let raf = 0;
    el.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; this._wheelRead(); });
    }, { passive: true });
    el.scrollTop = 0;
    this._wheelPaint();
  }

  _wheelRead() {
    const w = this.wheel;
    if (!w) return;
    const v = Math.max(1, Math.min(w.max, Math.round(w.el.scrollTop / ROW_H) + 1));
    if (v !== w.val) {
      w.val = v;
      this._wheelPaint();
    }
  }

  /** Rad auf Wert v stellen (smooth: weiches Rollen) */
  _wheelTo(v, smooth) {
    const w = this.wheel;
    if (!w) return;
    v = Math.max(1, Math.min(w.max, v));
    w.el.scrollTo({ top: (v - 1) * ROW_H, behavior: smooth ? 'smooth' : 'auto' });
    w.val = v;
    this._wheelPaint();
  }

  _wheelPaint() {
    const w = this.wheel;
    if (!w) return;
    for (const n of w.el.querySelectorAll('.qw-n.on')) n.classList.remove('on');
    const cur = w.el.querySelector(`.qw-n[data-v="${w.val}"]`);
    if (cur) cur.classList.add('on');
    const sum = this.sheetBody.querySelector('#qwSum');
    const after = this.sheetBody.querySelector('#qwAfter');
    const ok = this.sheetBody.querySelector('#qwOk');
    const total = w.unit * w.val;
    if (sum) sum.textContent = yen(total);
    if (after) after.textContent = yen(w.mode === 'buy' ? w.money - total : w.money + total);
    const box = this.sheetBody.querySelector('#qwTotal');
    if (box) box.classList.toggle('bad', w.mode === 'buy' && total > w.money);
    if (ok) ok.textContent = w.mode === 'buy' ? `Kaufen · ${w.val}×` : w.mode === 'sell' ? `Verkaufen · ${w.val}×` : `OK · ${w.val}×`;
  }

  _sheetAct(act, i, el) {
    const inp = this.input;
    switch (act) {
      case 'pick':
        if (inp.running) return;
        inp.enqueue(() => inp.selectAndConfirm(i), 2);
        break;
      case 'wset': {
        const w = this.wheel;
        if (!w) return;
        this._wheelTo(i === 1 ? 1 : i === 2 ? Math.ceil(w.max / 2) : w.max, true);
        break;
      }
      case 'wok': {
        const w = this.wheel;
        if (!w || inp.running) return;
        const n = w.val;
        const cfg = { mode: w.mode, unit: w.unit, name: w.name };
        inp.enqueue(() => this.wheelConfirm(cfg, n), 2);
        break;
      }
      case 'ok':
        inp.tap('A');
        break;
      case 'next':
        inp.enqueue(() => this.advance(), 2);
        break;
      case 'back':
        inp.tap('B');
        break;
    }
  }

  // ---------- Makros ----------
  /** Zur Tasche `target` wechseln (links/rechts blättern, bis sie erreicht ist). */
  async bagPocket(target) {
    const inp = this.input;
    for (let g = 0; g < 8; g++) {
      let m = this.fresh();
      if (!m || m.screen !== SCREEN.BAG || !m.bag) return false;
      const cur = m.bag.pocket;
      if (cur === target) return true;
      if (m.sub !== BAG_SUB.LIST) {
        if (!(await inp.waitUntil(() => { const n = this.fresh(); return n && n.sub === BAG_SUB.LIST; }, 40))) return false;
        continue;
      }
      const n = POCKETS.length;
      const fwd = (target - cur + n) % n;
      inp.tap(fwd <= n / 2 ? 'Right' : 'Left', 3);
      const moved = await inp.waitUntil(() => { const k = this.fresh(); return !k || !k.bag || k.bag.pocket !== cur; }, 30);
      if (!moved) return false; // Wechsel gesperrt (z. B. im Kampf)
      await inp.waitUntil(() => { const k = this.fresh(); return !k || k.sub === BAG_SUB.LIST; }, 60);
      await inp.wait(1);
    }
    return false;
  }

  /** Cursor auf Eintrag `i` setzen und mit A öffnen. */
  async bagOpenItem(i) {
    const inp = this.input;
    if (!(await inp.waitUntil(() => { const n = this.fresh(); return n && n.sub === BAG_SUB.LIST; }, 30))) {
      this.pending = -1;
      return false;
    }
    this.boost(true);
    let ok = false;
    try {
      let stuck = 0;
      for (let g = 0; g < 160; g++) {
        const m = this.fresh();
        if (!m || m.sub !== BAG_SUB.LIST || !m.bag) break;
        const sel = m.bag.sel;
        if (sel === i) {
          await inp.wait(8);
          const k = this.fresh();
          if (k && k.sub === BAG_SUB.LIST && k.bag && k.bag.sel === i) { ok = true; break; }
          continue;
        }
        inp.tap(i > sel ? 'Down' : 'Up', 2);
        const moved = await inp.waitUntil(() => { const n = this.fresh(); return !n || n.sub !== BAG_SUB.LIST || n.bag.sel !== sel; }, 14);
        if (!moved && ++stuck > 3) break;
      }
    } finally {
      this.boost(false);
    }
    if (!ok) { this.pending = -1; return false; }
    inp.tap('A');
    await inp.waitUntil(() => { const n = this.fresh(); return !n || n.sub !== BAG_SUB.LIST; }, 40);
    return true;
  }

  /** Meldung weiterschalten: A drücken, bis sich der Zustand ändert (ein Druck während des Tippens wird vom Spiel als "schneller" gewertet). */
  async advance() {
    const inp = this.input;
    const key = () => {
      const k = this.fresh();
      if (!k) return '';
      const msg = k.shop ? k.shop.msg : k.bag ? k.bag.msg : k.party ? k.party.msg : '';
      return [k.screen, k.sub, msg].join('|');
    };
    const k0 = key();
    for (let g = 0; g < 8; g++) {
      inp.tap('A', 3);
      if (await inp.waitUntil(() => key() !== k0, 36)) return true;
    }
    return false;
  }

  /** Ja/Nein-Abfrage des Spiels steht (Beschriftungen "YES"/"NO") */
  _isYesNo() {
    const m = this.fresh();
    const l = this._labels(this.input.snap, m);
    return !!l && l.length === 2 && /^yes$/i.test(String(l[0]).trim());
  }

  _toast(text) {
    if (this.input.hooks.toast) this.input.hooks.toast(text, 3200);
  }

  /** Menge über die Pfeiltasten auf `target` stellen. get() liefert die aktuelle Menge, -1 wenn der Dialog weg ist. */
  async _qtyTo(target, get) {
    const inp = this.input;
    for (let g = 0; g < 60; g++) {
      const cur = get();
      if (cur < 0) return false;
      if (cur === target) return true;
      const d = target - cur;
      // Rechts/Links = ±10 (nie über den Rand hinaus, weil |d| >= 10), Hoch/Runter = ±1
      const key = d >= 10 ? 'Right' : d <= -10 ? 'Left' : d > 0 ? 'Up' : 'Down';
      inp.tap(key, 2);
      await inp.waitUntil(() => { const k = get(); return k < 0 || k !== cur; }, 14);
    }
    return get() === target;
  }

  /** Kaufliste: Cursor auf Eintrag `i` setzen und mit A öffnen. */
  async shopOpenItem(i) {
    const inp = this.input;
    const st = () => { const n = this.fresh(); return n && n.screen === SCREEN.SHOP && n.shop ? n.shop : null; };
    if (!(await inp.waitUntil(() => { const s = st(); return s && s.sub === SHOP_SUB.LIST; }, 40))) { this.pending = -1; return false; }
    this.boost(true);
    let ok = false;
    try {
      let stuck = 0;
      for (let g = 0; g < 120; g++) {
        const s = st();
        if (!s || s.sub !== SHOP_SUB.LIST) break;
        const sel = s.sel;
        if (sel === i) {
          // Cursor steht - kurz warten, ob er nicht doch noch weiterläuft (Tastenwiederholung), dann erst bestätigen
          await inp.wait(8);
          const k = st();
          if (k && k.sub === SHOP_SUB.LIST && k.sel === i) { ok = true; break; }
          continue;
        }
        inp.tap(i > sel ? 'Down' : 'Up', 2);
        const moved = await inp.waitUntil(() => { const k = st(); return !k || k.sub !== SHOP_SUB.LIST || k.sel !== sel; }, 14);
        if (!moved && ++stuck > 3) break;
      }
    } finally {
      this.boost(false);
    }
    if (!ok) { this.pending = -1; return false; }
    inp.tap('A');
    await inp.waitUntil(() => { const k = st(); return !k || k.sub !== SHOP_SUB.LIST; }, 40);
    // Der Verkäufer spricht ("Wie viele?"): im Schnelllauf durch den Text, bis das Mengenrad (oder eine Absage) kommt
    this.boost(true);
    try {
      await inp.waitUntil(() => {
        const k = st();
        if (!k) return true;
        if (k.sub === SHOP_SUB.QTY || k.sub === SHOP_SUB.LIST) return true;
        return k.sub === SHOP_SUB.MSG && /enough money|no more room/.test(k.msg || '');
      }, 500);
    } finally {
      this.boost(false);
    }
    return true;
  }

  /** Mengenrad bestätigt: Kauf, Verkauf oder (Wegwerfen/Einlagern) nur die Menge übernehmen. */
  async wheelConfirm(cfg, n) {
    if (cfg.mode === 'buy') return this.shopBuy(cfg, n);
    if (cfg.mode === 'sell') return this.bagSell(cfg, n);
    const inp = this.input;
    const get = () => { const k = this.fresh(); return k && k.screen === SCREEN.BAG && k.sub === BAG_SUB.QTY && k.bag ? k.bag.qtyCur : -1; };
    if (!(await this._qtyTo(n, get))) return false;
    await inp.wait(2);
    inp.tap('A');
    return true;
  }

  /** Kauf: Menge einstellen, bestätigen, "Ja" wählen und die Meldungen des Verkäufers wegdrücken. */
  async shopBuy(cfg, n) {
    const inp = this.input;
    const st = () => { const k = this.fresh(); return k && k.screen === SCREEN.SHOP && k.shop ? k.shop : null; };
    this.quiet = true;
    let bought = false;
    let note = '';
    try {
      if (!(await this._qtyTo(n, () => { const s = st(); return s && s.sub === SHOP_SUB.QTY ? s.qtyCur : -1; }))) return false;
      await inp.wait(2);
      inp.tap('A');
      if (!(await inp.waitUntil(() => this._isYesNo(), 240))) return false;
      await inp.wait(2);
      await inp.selectAndConfirm(0);
      for (let g = 0; g < 100; g++) {
        const s = st();
        if (!s) break;
        if (s.sub === SHOP_SUB.LIST) break;
        if (s.sub === SHOP_SUB.MSG && !this._isYesNo()) {
          const t = s.msg || '';
          if (/Here you go/.test(t)) bought = true;
          if (/no more room/.test(t)) note = 'Kein Platz mehr im Beutel';
          if (/PREMIER BALL/i.test(t)) note = '+ 1 Premier Ball als Zugabe';
          inp.tap('A', 2);
        }
        await inp.wait(6);
      }
    } finally {
      this.quiet = false;
    }
    if (bought) this._toast(`${n}× ${cfg.name} gekauft (−${yen(cfg.unit * n)})${note ? ' · ' + note : ''}`);
    else if (note) this._toast(note);
    return bought;
  }

  /** Verkauf im Beutel (Ort PokéMart): Menge einstellen, bestätigen, "Ja" und die Meldungen wegdrücken. */
  async bagSell(cfg, n) {
    const inp = this.input;
    const st = () => { const k = this.fresh(); return k && k.screen === SCREEN.BAG && k.bag ? k : null; };
    this.quiet = true;
    let sold = false;
    try {
      const get = () => { const k = st(); return k && k.sub === BAG_SUB.QTY ? k.bag.qtyCur : -1; };
      if (!(await this._qtyTo(n, get))) return false;
      await inp.wait(2);
      inp.tap('A');
      if (!(await inp.waitUntil(() => this._isYesNo(), 240))) return false;
      await inp.wait(2);
      await inp.selectAndConfirm(0);
      for (let g = 0; g < 100; g++) {
        const k = st();
        if (!k) break;
        if (k.sub === BAG_SUB.LIST) break;
        if (!this._isYesNo()) {
          if (/Turned over/.test(k.bag.msg || '')) sold = true;
          inp.tap('A', 2);
        }
        await inp.wait(6);
      }
    } finally {
      this.quiet = false;
    }
    if (sold) this._toast(`${n}× ${cfg.name} verkauft (+${yen(cfg.unit * n)})`);
    return sold;
  }

  /** Pokédex: Cursor auf Eintrag `i` setzen und mit A die Detailseite öffnen. */
  async dexOpen(i) {
    const inp = this.input;
    const st = () => { const n = this.fresh(); return n && n.screen === SCREEN.DEX && n.dex ? n.dex : null; };
    if (!(await inp.waitUntil(() => { const d = st(); return d && d.sub === DEX_SUB.LIST; }, 40))) return false;
    this.boost(true);
    let ok = false;
    try {
      let stuck = 0;
      for (let g = 0; g < 200; g++) {
        const d = st();
        if (!d) break;
        if (d.sub === DEX_SUB.SCROLL) { await inp.waitUntil(() => { const k = st(); return !k || k.sub !== DEX_SUB.SCROLL; }, 40); continue; }
        if (d.sub !== DEX_SUB.LIST) break;
        const delta = i - d.sel;
        if (delta === 0) {
          await inp.wait(8);
          const k = st();
          if (k && k.sub === DEX_SUB.LIST && k.sel === i) { ok = true; break; }
          continue;
        }
        const key = Math.abs(delta) >= 7 ? (delta > 0 ? 'Right' : 'Left') : (delta > 0 ? 'Down' : 'Up');
        const before = d.sel;
        inp.tap(key, 2);
        const moved = await inp.waitUntil(() => { const k = st(); return !k || k.sel !== before || k.sub !== DEX_SUB.LIST; }, 16);
        if (moved) stuck = 0;
        else if (++stuck > 5) break;
        await inp.waitUntil(() => { const k = st(); return !k || k.sub === DEX_SUB.LIST; }, 40);
      }
    } finally {
      this.boost(false);
    }
    if (!ok) return false;
    inp.tap('A');
    await inp.waitUntil(() => { const d = st(); return !d || d.sub === DEX_SUB.INFO; }, 120);
    return true;
  }

  /** Detailseite: zu Gebiet (0) / Ruf (1) / Größe (2) wechseln und mit A öffnen. */
  async dexScreen(target) {
    const inp = this.input;
    const st = () => { const n = this.fresh(); return n && n.screen === SCREEN.DEX && n.dex ? n.dex : null; };
    for (let g = 0; g < 8; g++) {
      const d = st();
      if (!d || d.sub !== DEX_SUB.INFO) return false;
      if (d.selScreen === target) break;
      const before = d.selScreen;
      inp.tap(target > before ? 'Right' : 'Left', 3);
      await inp.waitUntil(() => { const k = st(); return !k || k.selScreen !== before; }, 14);
      await inp.wait(1);
    }
    const d = st();
    if (!d || d.selScreen !== target) return false;
    await inp.wait(2);
    inp.tap('A');
    await inp.waitUntil(() => { const k = st(); return !k || k.sub !== DEX_SUB.INFO; }, 60);
    return true;
  }

  /** Detailseite: zum vorigen (Up) oder nächsten (Down) gesehenen Pokémon blättern. */
  async dexStep(key) {
    const inp = this.input;
    const st = () => { const n = this.fresh(); return n && n.screen === SCREEN.DEX && n.dex ? n.dex : null; };
    const d = st();
    if (!d || d.sub !== DEX_SUB.INFO) return false;
    const before = d.infoDex;
    inp.tap(key, 3);
    const left = await inp.waitUntil(() => { const k = st(); return !k || k.sub !== DEX_SUB.INFO || k.infoDex !== before; }, 30);
    if (!left) return false;
    await inp.waitUntil(() => { const k = st(); return !k || k.sub === DEX_SUB.INFO; }, 150);
    return true;
  }
}
