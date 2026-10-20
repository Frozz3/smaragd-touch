// Smaragd Touch – Start und Verdrahtung.

import { Emu } from './emu.js';
import { View } from './view.js';
import { Input } from './input.js';
import { Touch } from './touch.js';
import { Ui } from './ui.js';
import { World } from './world.js';
import { Stage } from './stage.js';
import { TextLayer } from './textlayer.js';
import { Skins } from './skins.js';
import { Battle } from './battle.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ---------- Einstellungen ----------
const DEFAULTS = { run: 'drag', fx: true, smooth: true, speed: 1, volume: 100, zoom: 1, ambient: true, world: true, textDock: true, battleOwn: true, perf: false };
function loadSettings() {
  try {
    const st = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('et.settings') || '{}'));
    // Version 3: die Karte füllt den Bildschirm – der alte Standard-Zoom (1,25) wird auf "Aus" gesetzt
    if (!st.v3) { st.v3 = true; if (st.zoom === 1.25) st.zoom = 1; }
    return st;
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}
const settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem('et.settings', JSON.stringify(settings)); } catch (e) {}
}

// ---------- kleine Helfer ----------
let toastTimer = 0;
function toast(msg, ms = 1800) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function setBoot(msg, { err = false, buttons = [] } = {}) {
  const el = $('#boot');
  el.classList.remove('hidden');
  const p = $('#bootMsg');
  p.textContent = msg;
  p.className = err ? 'err' : '';
  const box = $('#bootBtns');
  box.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (b.primary ? ' primary' : '');
    btn.textContent = b.label;
    btn.onclick = b.onClick;
    box.appendChild(btn);
  }
}
function hideBoot() { $('#boot').classList.add('hidden'); }

function pickFile(input) {
  return new Promise((res) => {
    input.value = '';
    input.onchange = () => res(input.files && input.files[0]);
    input.click();
  });
}

function downloadBlob(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ---------- Start ----------
let emu, view, input, touch, ui, world, stage, skins, textLayer, battle;

async function main() {
  setBoot('Lade Emulator …');

  if (!window.isSecureContext) {
    return setBoot(
      'Diese Seite muss über HTTPS (oder localhost) geöffnet werden, sonst startet der Emulator nicht. Auf dem iPhone siehe README.md → Abschnitt 3 „Aufs iPhone“.',
      { err: true }
    );
  }
  if (!window.crossOriginIsolated) {
    // Der Service Worker lädt die Seite beim ersten Mal selbst neu. Kommt das nicht, ist etwas falsch.
    await new Promise((r) => setTimeout(r, 2500));
    if (!window.crossOriginIsolated) {
      return setBoot(
        'Der Browser läuft nicht im „isolierten“ Modus (Cross-Origin Isolation). Seite einmal neu laden – wenn das nichts hilft, siehe README.md → Abschnitt 3.',
        { err: true, buttons: [{ label: 'Neu laden', primary: true, onClick: () => location.reload() }] }
      );
    }
  }

  emu = new Emu($('#emu'));
  try {
    await emu.boot();
  } catch (e) {
    console.error(e);
    return setBoot('Der Emulator konnte nicht gestartet werden: ' + (e && e.message ? e.message : e), { err: true });
  }

  view = new View({ view: $('#view'), src: $('#emu'), ambient: $('#ambient'), root: $('#app'), emu });
  view.smooth = settings.smooth;
  view.ambientOn = settings.ambient;
  $('#ambient').style.display = settings.ambient ? '' : 'none';
  view.setZoomSetting(+settings.zoom || 1);
  emu.setVolume(settings.volume / 100);

  input = new Input(emu, {
    toast,
    bridgeFound: () => { $('#romInfo').textContent = 'Menü-Erkennung aktiv'; },
    bridgeMissing: (old) => {
      $('#romInfo').textContent = old ? 'ROM ist veraltet – bitte neu bauen' : 'Menü-Erkennung aus (ROM ohne TouchBridge)';
      toast(old ? 'Diese ROM ist von der alten App-Version – bitte neu bauen (README)' : 'Tippen löst „A“ aus (ROM ohne TouchBridge)', 5000);
    },
    onTick: (snap) => ui && ui.tick(snap),
    // Während ein Menüpunkt über das Startmenü angesteuert wird, bleibt das echte Startmenü verdeckt
    veil: (on) => $('#app').classList.toggle('veil', on),
    // Danach bleibt das Originalbild verdeckt, bis die neue Oberfläche steht (siehe Skins._updateCover)
    armFor: (id) => skins && skins.armFor(id),
  });

  ui = new Ui({
    input, view, settings,
    app: $('#app'),
    actions: { openSettings: openSheet, toast },
  });

  touch = new Touch({
    layer: $('#touch'),
    stick: $('#stick'),
    knob: $('#knob'),
    input,
    settings,
    onTap: (x, y) => {
      const p = view.toGba(x, y);
      const res = input.handleTap(p ? p.x : null, p ? p.y : null);
      showTapFx(x, y, res);
    },
    scrollStep: scrollStep,
    onFirstDrag: () => $('#app').classList.add('hint-done'),
  });

  world = new World(() => emu.getMemory());
  stage = new Stage({
    world,
    canvas: $('#stage'),
    isFading: () => { const s = input.snap; return !!s && !!s.fading; },
    getAttach: () => {
      const s = input.snap;
      if (!s || input.bridge.base < 0 || !s.selfAddr || !s.worldAddr) return null;
      return { base: input.bridge.base, selfAddr: s.selfAddr, worldAddr: s.worldAddr };
    },
  });
  stage.setEnabled(settings.world);
  view.setStage(stage);
  skins = new Skins({
    input, world, app: $('#app'),
    // lange Wege in Listen (Cursor viele Einträge weit bewegen) laufen mit schnellem Vorlauf
    boost: (on) => emu.setSpeed(on ? Math.max(settings.speed, 4) : settings.speed),
  });
  ui.setSkins(skins);
  textLayer = new TextLayer({
    world, input, stage, root: $('#app'),
    frameCv: $('#txFrame'), cards: $('#txCards'), banner: $('#mapBanner'),
    ctx: { sheetOn: () => skins.sheetOpen, sheetKind: () => skins.sheetKindNow || '', mode: () => ui.mode },
  });
  textLayer.setEnabled(settings.textDock !== false);
  view.setTextLayer(textLayer);
  battle = new Battle({ world, input, textLayer, root: $('#app'), mode: () => ui.mode });
  battle.setEnabled(settings.battleOwn !== false);
  view.setBattle(battle);
  wireUi();
  window.__et = { emu, input, touch, view, settings, ui, world, stage, skins, textLayer, battle }; // zum Debuggen in der Konsole
  await prepareRom();
}

async function prepareRom() {
  let have = emu.hasStoredRom();
  try {
    const head = await fetch('__rom', { method: 'HEAD', cache: 'no-store' });
    if (head.ok) {
      const stamp = head.headers.get('X-Rom-Mtime') + ':' + head.headers.get('Content-Length');
      let old = null;
      try { old = localStorage.getItem('et.romStamp'); } catch (e) {}
      if (!have || old !== stamp) {
        setBoot('Lade ROM vom PC …');
        const r = await fetch('__rom', { cache: 'no-store' });
        const buf = new Uint8Array(await r.arrayBuffer());
        await emu.storeRom(buf);
        try { localStorage.setItem('et.romStamp', stamp); } catch (e) {}
        have = true;
      }
    }
  } catch (e) {
    // kein Server-ROM (z. B. statisch gehostet) – ist in Ordnung
  }
  if (have) {
    setBoot('Bereit.', { buttons: [{ label: 'Spielen', primary: true, onClick: startGame }] });
  } else {
    setBoot(
      'Wähle deine selbst gebaute ROM (pokeemerald_modern.gba oder pokeemerald.gba). Sie wird nur auf diesem Gerät gespeichert.',
      { buttons: [{ label: 'ROM auswählen', primary: true, onClick: chooseRom }] }
    );
  }
}

async function chooseRom() {
  const file = await pickFile($('#romFile'));
  if (!file) return;
  setBoot('Speichere ROM …');
  await emu.storeRom(file);
  try { localStorage.setItem('et.romStamp', 'manual'); } catch (e) {}
  if (emu.romLoaded) location.reload();
  else prepareRom();
}

function startGame() {
  emu.resumeAudio();
  // Bitte den Browser, Spielstand und ROM nicht von selbst aufzuräumen
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  if (!emu.loadStoredRom()) {
    return setBoot('Die ROM konnte nicht geladen werden. Ist es eine GBA-Datei?', {
      err: true,
      buttons: [{ label: 'Andere ROM wählen', primary: true, onClick: chooseRom }],
    });
  }
  emu.setSpeed(settings.speed);
  syncSpeedUi();
  view.start();
  input.startBridgeSearch();
  hideBoot();
  // erste Berührung entsperrt zuverlässig den Ton auf iOS
  const unlock = () => { emu.resumeAudio(); };
  addEventListener('pointerdown', unlock, { passive: true });
  setTimeout(() => removeEventListener('pointerdown', unlock), 8000);
}

// ---------- Hilfen für Gesten ----------
/** Wie weit der Finger für einen Menüschritt wandern muss (entspricht etwa einer Zeile). */
function scrollStep() {
  const s = input.snap;
  const k = view.rect.h / 160;
  let y = 36;
  if (s && s.ui === 1 && s.rects && s.rects.length > 1) {
    const a = s.rects.find((r) => r.h > 0);
    const b = s.rects.filter((r) => r.h > 0)[1];
    if (a && b && b.y > a.y) y = (b.y - a.y) * k;
  }
  return { x: 64, y: Math.max(24, Math.min(64, y)) };
}

function showTapFx(px, py, res) {
  if (!settings.fx) return;
  const fx = $('#fx');
  if (res.kind === 'select' && res.rect) {
    const r = view.fromGbaRect(res.rect);
    const t = document.createElement('div');
    t.className = 'target';
    t.style.left = r.x + 'px';
    t.style.top = r.y + 'px';
    t.style.width = r.w + 'px';
    t.style.height = r.h + 'px';
    fx.appendChild(t);
    setTimeout(() => t.remove(), 420);
  }
  const d = document.createElement('div');
  d.className = 'ripple';
  d.style.left = px + 'px';
  d.style.top = py + 'px';
  fx.appendChild(d);
  setTimeout(() => d.remove(), 460);
}

function wireUi() {
  $('#btnSettings').addEventListener('click', openSheet);
  $('#btnSpeed').addEventListener('click', () => {
    const order = [1, 2, 3, 4];
    settings.speed = order[(order.indexOf(settings.speed) + 1) % order.length];
    emu.setSpeed(settings.speed);
    saveSettings();
    syncSpeedUi();
    toast('Tempo ' + settings.speed + '×', 900);
  });

  // Sheet
  $('#closeSheet').addEventListener('click', closeSheet);
  $('#sheetwrap').addEventListener('pointerdown', (e) => { if (e.target.id === 'sheetwrap') closeSheet(); });

  seg('#segSpeed', () => String(settings.speed), (v) => { settings.speed = +v; emu.setSpeed(+v); syncSpeedUi(); });
  seg('#segRun', () => settings.run, (v) => { settings.run = v; });

  const vol = $('#vol');
  vol.value = settings.volume;
  vol.addEventListener('input', () => { settings.volume = +vol.value; emu.setVolume(settings.volume / 100); saveSettings(); });

  seg('#segZoom', () => String(settings.zoom), (v) => { settings.zoom = +v; view.setZoomSetting(+v); });
  check('#optFx', 'fx');
  check('#optAmbient', 'ambient', () => {
    view.ambientOn = settings.ambient;
    $('#ambient').style.display = settings.ambient ? '' : 'none';
  });
  check('#optSmooth', 'smooth', () => { view.smooth = settings.smooth; });
  check('#optWorld', 'world', () => { stage.setEnabled(settings.world); });
  check('#optDock', 'textDock', () => { textLayer.setEnabled(settings.textDock !== false); });
  check('#optBattle', 'battleOwn', () => { battle.setEnabled(settings.battleOwn !== false); });
  check('#optPerf', 'perf', () => perfHud(!!settings.perf));
  perfHud(!!settings.perf);

  $('#qsSave').addEventListener('click', () => { toast(emu.quickSave(1) ? 'Gesichert' : 'Sichern fehlgeschlagen'); emu.scheduleSync(); });
  $('#qsLoad').addEventListener('click', () => { toast(emu.quickLoad(1) ? 'Geladen' : 'Kein Schnellspeicher vorhanden'); closeSheet(); });
  $('#exportSave').addEventListener('click', () => {
    const s = emu.getSave();
    if (!s) return toast('Noch kein Spielstand vorhanden');
    downloadBlob(s, 'pokemon-smaragd.sav');
  });
  $('#importSave').addEventListener('click', async () => {
    const f = await pickFile($('#saveFile'));
    if (!f) return;
    try { await emu.importSave(f); toast('Importiert – starte neu …'); setTimeout(() => location.reload(), 900); }
    catch (e) { toast('Import fehlgeschlagen'); }
  });
  $('#changeRom').addEventListener('click', async () => {
    closeSheet();
    const f = await pickFile($('#romFile'));
    if (!f) return;
    await emu.storeRom(f);
    try { localStorage.setItem('et.romStamp', 'manual'); } catch (e) {}
    location.reload();
  });
  $('#reset').addEventListener('click', () => { emu.reset(); closeSheet(); toast('Neu gestartet'); });

  // App-Wechsel (iOS beendet Hintergrund-Tabs gern): vorher sichern
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { input.releaseAll(); emu.flush(); emu.pause(); }
    else if (emu.romLoaded) emu.resume();
  });
  addEventListener('pagehide', () => emu.flush());
}

function seg(sel, get, set) {
  const el = $(sel);
  const paint = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === get()));
  el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { set(b.dataset.v); saveSettings(); paint(); }));
  paint();
  el._paint = paint;
}
/** Leistungsanzeige (Einstellungen): Bilder pro Sekunde, längste Bildzeit der letzten 10 s, Ruckler, Spielbilder pro Sekunde. */
let perfRaf = 0;
function perfHud(on) {
  const el = $('#perf');
  el.hidden = !on;
  if (!on) { cancelAnimationFrame(perfRaf); perfRaf = 0; return; }
  if (perfRaf) return;
  let last = 0, t0 = 0, n = 0, max = 0, slow = 0, g0 = -1;
  const hist = []; // Maxima der letzten Sekunden
  const loop = (t) => {
    perfRaf = requestAnimationFrame(loop);
    if (last) {
      const dt = t - last;
      n++; if (dt > max) max = dt; if (dt > 40) slow++;
    }
    last = t;
    if (!t0) t0 = t;
    if (t - t0 >= 1000) {
      const sec = (t - t0) / 1000;
      const snap = input && input.snap;
      const g1 = snap ? snap.frame : -1;
      const gps = g0 >= 0 && g1 >= g0 ? Math.round((g1 - g0) / sec) : -1;
      g0 = g1;
      hist.push(max); if (hist.length > 10) hist.shift();
      const info = stage && stage.info ? stage.info : '-';
      el.textContent = `${Math.round(n / sec)} B/s · max ${Math.round(Math.max(...hist))} ms · Ruckler ${slow}` + (gps >= 0 ? ` · Spiel ${gps}/s` : '') + `\nKarte: ${info}`;
      el.classList.toggle('bad', max > 50);
      t0 = t; n = 0; max = 0; slow = 0;
    }
  };
  perfRaf = requestAnimationFrame(loop);
}
function check(sel, key, after) {
  const el = $(sel);
  el.checked = !!settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); after?.(); });
}
function syncSpeedUi() {
  $('#speedLabel').textContent = settings.speed + '×';
  $('#btnSpeed').classList.toggle('on', settings.speed > 1);
  $('#segSpeed')._paint?.();
}
function openSheet() { $('#sheetwrap').classList.add('open'); input?.releaseAll(); }
function closeSheet() { $('#sheetwrap').classList.remove('open'); }

main();
