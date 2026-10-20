// Emulator-Hülle: startet mGBA (WebAssembly), lädt ROM + Spielstände und
// stellt den Heap für die TouchBridge bereit.

const ROM_NAME = 'emerald.gba';

// mGBA legt seinen Speicher selbst an. Wir merken uns das Memory-Objekt, damit die
// TouchBridge später direkt hineinlesen kann (nur lesend).
let memories = [];
function captureMemory() {
  if (WebAssembly.Memory.__captured) return;
  const Orig = WebAssembly.Memory;
  const Wrapped = function (desc) {
    const m = new Orig(desc);
    memories.push(m);
    return m;
  };
  Wrapped.prototype = Orig.prototype;
  Wrapped.__captured = true;
  WebAssembly.Memory = Wrapped;
}

export class Emu {
  constructor(canvas) {
    this.canvas = canvas;
    this.M = null;
    this.romLoaded = false;
    this.syncTimer = 0;
    this.romSize = 0;
  }

  getMemory() {
    // das größte (= Haupt-)Speicherobjekt
    let best = null;
    for (const m of memories) if (!best || m.buffer.byteLength > best.buffer.byteLength) best = m;
    return best;
  }

  async boot() {
    captureMemory();
    const mod = await import('../vendor/mgba.js');
    const mGBA = mod.default;
    this.M = await mGBA({ canvas: this.canvas });
    await this.M.FSInit();
    this.M.toggleInput(false); // Eingaben kommen nur von unserer Touch-Steuerung
    this.M.setCoreSettings({
      rewindEnable: false,
      allowOpposingDirections: false,
      autoSaveStateEnable: true,
      autoSaveStateTimerIntervalSeconds: 20,
      restoreAutoSaveStateOnLoad: true,
    });
    this.M.addCoreCallbacks({
      saveDataUpdatedCallback: () => this.scheduleSync(),
      autoSaveStateCapturedCallback: () => this.scheduleSync(),
    });
    return this.M;
  }

  hasStoredRom() {
    try {
      return this.M.listRoms().includes(ROM_NAME);
    } catch (e) {
      return false;
    }
  }

  storedRomSize() {
    try {
      const p = this.M.filePaths().gamePath + '/' + ROM_NAME;
      return this.M.FS.stat(p).size;
    } catch (e) {
      return 0;
    }
  }

  /** Neue ROM (File oder Bytes) ablegen. */
  async storeRom(data) {
    const M = this.M;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    const file = new File([bytes], ROM_NAME);
    await new Promise((r) => M.uploadRom(file, r));
    this.romSize = bytes.length;
    await M.FSSync();
  }

  loadStoredRom() {
    const M = this.M;
    const path = M.filePaths().gamePath + '/' + ROM_NAME;
    const ok = M.loadGame(path);
    this.romLoaded = !!ok;
    if (ok) {
      M.setVolume(this.volume ?? 1);
    }
    return !!ok;
  }

  // --- Eingabe ---
  press(key) { this.M.buttonPress(key); }
  release(key) { this.M.buttonUnpress(key); }

  // --- Tempo / Ton ---
  setSpeed(n) { this.M.setFastForwardMultiplier(n); }
  setVolume(v) { this.volume = v; if (this.M) this.M.setVolume(v); }
  resumeAudio() {
    try { this.M.resumeAudio(); } catch (e) {}
    try { this.M.SDL2?.audioContext?.resume(); } catch (e) {}
  }
  pause() { try { this.M.pauseGame(); this.M.pauseAudio(); } catch (e) {} }
  resume() { try { this.M.resumeGame(); this.M.resumeAudio(); } catch (e) {} }
  reset() { try { this.M.quickReload(); } catch (e) {} }

  // --- Speichern ---
  scheduleSync() {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync(), 1500);
  }
  async sync() {
    try { await this.M.FSSync(); } catch (e) {}
  }
  /** Beim Verlassen der App: Stand sichern, bevor iOS die Seite beendet. */
  async flush() {
    if (!this.romLoaded) return;
    try { this.M.forceAutoSaveState(); } catch (e) {}
    await this.sync();
  }
  getSave() { try { return this.M.getSave(); } catch (e) { return null; } }

  async importSave(file) {
    const M = this.M;
    const path = M.saveName || (M.filePaths().savePath + '/' + ROM_NAME.replace('.gba', '.sav'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    try { M.FS.writeFile(path, bytes); } catch (e) { throw e; }
    // Auto-State würde den importierten Stand überdecken
    try {
      const auto = M.autoSaveStateName;
      if (auto) M.FS.unlink(auto);
    } catch (e) {}
    await M.FSSync();
  }

  quickSave(slot = 1) { return this.M.saveState(slot); }
  quickLoad(slot = 1) { return this.M.loadState(slot); }
  get canvasEl() { return this.canvas; }
}
