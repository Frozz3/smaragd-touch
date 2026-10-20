// Kulissen für den Kampf: Der Hintergrund wird passend zur Umgebung über den ganzen Bildschirm gezeichnet.
//
// Das Spiel liefert nur die Art der Umgebung (BATTLE_ENVIRONMENT_*, siehe touch_battle.h). Hier entstehen daraus
//   - eine ruhende Ebene (Himmel/Wand, Boden, Plattformen) - einmal gezeichnet, solange sich nichts ändert,
//   - eine bewegte Ebene (Wolken, Wellen, Blasen, Funken, Wetter) - jedes Bild leicht verändert.
// Alle Koordinaten sind CSS-Pixel. "lay" beschreibt die Lage der 240x160-Spielfläche auf dem Bildschirm
// (k = Vergrößerung, fy = Oberkante), damit Plattformen genau unter den Pokémon sitzen.

export const SCENE = {
  GRASS: 0, LONG_GRASS: 1, SAND: 2, UNDERWATER: 3, WATER: 4, POND: 5, MOUNTAIN: 6, CAVE: 7, BUILDING: 8, PLAIN: 9,
  FRONTIER: 10, GROUDON: 11, KYOGRE: 12, RAYQUAZA: 13, LEADER: 14, CHAMPION: 15, GYM: 16, MAGMA: 17, AQUA: 18,
  SIDNEY: 19, PHOEBE: 20, GLACIA: 21, DRAKE: 22,
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
};

function vgrad(c, y0, y1, stops) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  return g;
}

function ell(c, x, y, rx, ry) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
}

/** Weiche Hügelreihe. */
function hills(c, W, base, amp, bottom, colTop, colBot, seed, freq = 1) {
  const r = rng(seed);
  const p1 = r() * 6, p2 = r() * 6, p3 = r() * 6;
  c.beginPath();
  c.moveTo(0, bottom);
  for (let x = 0; x <= W + 8; x += 8) {
    const u = x / W;
    const y = base - amp * (0.55 * Math.sin(u * 5.2 * freq + p1) + 0.3 * Math.sin(u * 11 * freq + p2) + 0.15 * Math.sin(u * 23 * freq + p3));
    c.lineTo(x, y);
  }
  c.lineTo(W + 8, bottom);
  c.closePath();
  c.fillStyle = vgrad(c, base - amp, bottom, [colTop, colBot]);
  c.fill();
}

function cloud(c, x, y, s, a = 1, tint = '#ffffff') {
  c.save();
  c.globalAlpha = a;
  const parts = [[0, 0, 1], [-0.9, 0.18, 0.7], [0.95, 0.15, 0.75], [-0.4, -0.35, 0.65], [0.4, -0.25, 0.6], [1.6, 0.3, 0.5], [-1.5, 0.3, 0.5]];
  c.fillStyle = tint;
  for (const [dx, dy, r] of parts) { ell(c, x + dx * s * 0.5, y + dy * s * 0.5, r * s * 0.45, r * s * 0.34); c.fill(); }
  c.globalAlpha = a * 0.18;
  c.fillStyle = '#7a9cc8';
  ell(c, x, y + s * 0.2, s * 0.9, s * 0.1); c.fill();
  c.restore();
}

function tree(c, x, y, s, dark, light) {
  c.fillStyle = '#5a3d28';
  c.fillRect(x - s * 0.06, y - s * 0.3, s * 0.12, s * 0.32);
  const g = c.createRadialGradient(x - s * 0.15, y - s * 0.75, s * 0.05, x, y - s * 0.55, s * 0.5);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  c.fillStyle = g;
  ell(c, x, y - s * 0.55, s * 0.42, s * 0.46); c.fill();
  ell(c, x - s * 0.22, y - s * 0.42, s * 0.28, s * 0.3); c.fill();
  ell(c, x + s * 0.22, y - s * 0.42, s * 0.28, s * 0.3); c.fill();
}

function blades(c, x0, y0, x1, y1, n, cols, h, seed) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
    const s = h * (0.6 + r() * 0.8) * (0.55 + (y - y0) / Math.max(1, y1 - y0) * 0.7);
    c.fillStyle = cols[(r() * cols.length) | 0];
    c.beginPath();
    c.moveTo(x - s * 0.14, y);
    c.quadraticCurveTo(x - s * 0.05, y - s * 0.6, x + (r() - 0.5) * s * 0.4, y - s);
    c.quadraticCurveTo(x + s * 0.08, y - s * 0.55, x + s * 0.14, y);
    c.closePath();
    c.fill();
  }
}

function rays(c, W, y0, y1, n, color, seed, spread = 0.5) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * W, w = 20 + r() * 70, slant = (r() - 0.3) * W * spread;
    const g = c.createLinearGradient(x, y0, x + slant, y1);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - w * 0.2, y0); c.lineTo(x + w * 0.2, y0);
    c.lineTo(x + slant + w, y1); c.lineTo(x + slant - w, y1);
    c.closePath();
    c.fill();
  }
}

/** Boden mit Tiefenwirkung: Linien, die zum Fluchtpunkt laufen, und Querstreifen. */
function perspective(c, W, y0, y1, vx, color, alpha, cols = 9, bands = 8) {
  c.save();
  c.strokeStyle = color;
  c.globalAlpha = alpha;
  c.lineWidth = 1.2;
  for (let i = -cols; i <= cols; i++) {
    c.beginPath();
    c.moveTo(vx + i * W * 0.02, y0);
    c.lineTo(vx + i * W * 0.22, y1);
    c.stroke();
  }
  for (let j = 1; j <= bands; j++) {
    const t = Math.pow(j / bands, 1.8);
    const y = y0 + (y1 - y0) * t;
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
  }
  c.restore();
}

function vignette(c, W, H, a = 0.35) {
  const g = c.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

// ---------- Plattformen ----------
function platform(c, p, st) {
  const { x, y, rx, ry } = p;
  const th = ry * 0.5;
  if (st.water) {
    // Wasserring statt fester Plattform
    for (let i = 0; i < 3; i++) {
      c.strokeStyle = `rgba(255,255,255,${0.5 - i * 0.14})`;
      c.lineWidth = 2 - i * 0.4;
      ell(c, x, y + ry * 0.2, rx * (0.7 + i * 0.16), ry * (0.7 + i * 0.16)); c.stroke();
    }
    const g = c.createRadialGradient(x, y, 2, x, y, rx);
    g.addColorStop(0, st.glow || 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    ell(c, x, y + ry * 0.2, rx, ry); c.fill();
    return;
  }
  // Schatten
  const sg = c.createRadialGradient(x, y + th, rx * 0.2, x, y + th, rx * 1.15);
  sg.addColorStop(0, 'rgba(0,0,0,0.38)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sg;
  ell(c, x + rx * 0.05, y + th * 1.25, rx * 1.12, ry * 1.2); c.fill();
  // Seite
  c.fillStyle = st.side;
  c.beginPath();
  c.moveTo(x - rx, y);
  c.lineTo(x - rx, y + th);
  c.ellipse(x, y + th, rx, ry, 0, Math.PI, 0, true);
  c.lineTo(x + rx, y);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.beginPath();
  c.moveTo(x, y + ry);
  c.lineTo(x + rx, y);
  c.lineTo(x + rx, y + th);
  c.ellipse(x, y + th, rx, ry, 0, 0, Math.PI * 0.5);
  c.closePath();
  c.fill();
  // Oberseite
  const g = c.createRadialGradient(x - rx * 0.25, y - ry * 0.3, ry * 0.2, x, y, rx * 1.05);
  g.addColorStop(0, st.top[0]);
  g.addColorStop(1, st.top[1]);
  c.fillStyle = g;
  ell(c, x, y, rx, ry); c.fill();
  c.strokeStyle = st.rim;
  c.lineWidth = 1.6;
  ell(c, x, y, rx - 0.8, ry - 0.8); c.stroke();
  if (st.tiles) {
    c.save();
    ell(c, x, y, rx, ry); c.clip();
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    c.lineWidth = 1;
    for (let i = -4; i <= 4; i++) { c.beginPath(); c.moveTo(x + i * rx * 0.28, y - ry); c.lineTo(x + i * rx * 0.28, y + ry); c.stroke(); }
    c.restore();
  }
  if (st.glow) {
    c.strokeStyle = st.glow;
    c.lineWidth = 2;
    ell(c, x, y, rx * 0.86, ry * 0.86); c.stroke();
  }
}

// ---------- Umgebungen ----------
const OUT = {
  // Himmelsfarben oben/Horizont, Hügel, Boden oben/unten, Plattform
  [SCENE.GRASS]: { sky: ['#58b6f6', '#cdeeff'], hills: [['#9ed0a0', '#7fbf86'], ['#6cb768', '#4f9f54']], ground: ['#86cf5b', '#4d9c3c'], plat: { top: ['#a6e07a', '#6fb94d'], side: '#8c6a3d', rim: '#c9f3a0' }, trees: true, clouds: 4, tufts: ['#5aa944', '#3d8a33', '#9fdc72'] },
  [SCENE.LONG_GRASS]: { sky: ['#4aa8ee', '#bfe6fb'], hills: [['#86bb8c', '#68a876'], ['#4f9a58', '#387f45']], ground: ['#5fb04a', '#2f7d34'], plat: { top: ['#8bd46a', '#4f9d43'], side: '#6d5232', rim: '#b9eb90' }, trees: true, clouds: 3, tufts: ['#2f7d34', '#43a043', '#7ccf62'], tall: true },
  [SCENE.PLAIN]: { sky: ['#6cc1f7', '#e4f5ff'], hills: [['#b6d8a8', '#98c58c'], ['#9ccb6e', '#7fb356']], ground: ['#a9d46a', '#74aa43'], plat: { top: ['#c6e88a', '#8cc255'], side: '#907447', rim: '#e3f6b6' }, trees: false, clouds: 5, tufts: ['#80b24a', '#5f9a3c', '#bde58a'] },
  [SCENE.SAND]: { sky: ['#f9b86a', '#ffeccc'], hills: [['#f0cd8f', '#e3b86d'], ['#e2b060', '#c99743']], ground: ['#efce86', '#c89d52'], plat: { top: ['#f7dfa4', '#d9b16a'], side: '#a77d3d', rim: '#fff0c2' }, trees: false, clouds: 2, tufts: ['#d2a458', '#b98a3e', '#f4d99a'], dunes: true },
  [SCENE.MOUNTAIN]: { sky: ['#7fa8e8', '#e7efff'], hills: [['#b4bdd0', '#8f9bb5'], ['#8b8f96', '#6a6e78']], ground: ['#9b9486', '#6c665c'], plat: { top: ['#bdb6a7', '#857f72'], side: '#5d5850', rim: '#e0dacb' }, trees: false, clouds: 3, tufts: ['#756f64', '#5c574f', '#b0a899'], peaks: true },
  [SCENE.RAYQUAZA]: { sky: ['#14307a', '#ff9f6b'], hills: [['#5b4c93', '#463a7a'], ['#352c63', '#251f4a']], ground: ['#4b4380', '#2a2552'], plat: { top: ['#8f86d0', '#554d94'], side: '#2c2760', rim: '#c9c2f5' }, trees: false, clouds: 6, tufts: ['#3b3470'], clouds2: true },
};
const WATERS = {
  [SCENE.WATER]: { sky: ['#4fb0f5', '#d4efff'], sea: ['#52bdf0', '#1d68b4'], glow: 'rgba(255,255,255,0.4)', foam: true },
  [SCENE.POND]: { sky: ['#6fc3f0', '#dff4ff'], sea: ['#6ccfc8', '#2f8f9a'], glow: 'rgba(255,255,255,0.35)', pads: true },
  [SCENE.KYOGRE]: { sky: ['#06265a', '#0f5fa8'], sea: ['#1a74c4', '#031f4c'], glow: 'rgba(150,230,255,0.45)', deep: true },
  [SCENE.UNDERWATER]: { sky: ['#1a8fd8', '#0a4a96'], sea: ['#0f6cc0', '#031f4c'], glow: 'rgba(170,240,255,0.4)', deep: true },
};
const ROOMS = {
  [SCENE.BUILDING]: { wall: ['#e7dfcf', '#cfc4ad'], trim: '#8a6a45', floor: ['#cdbf9f', '#a79678'], line: '#8a7a5c', plat: { top: ['#f2eee4', '#c8c1b2'], side: '#8f8878', rim: '#ffffff' }, deco: 'windows', mood: 'light' },
  [SCENE.FRONTIER]: { wall: ['#1d2340', '#0f1226'], trim: '#6f7bd9', floor: ['#8c97b3', '#4d566f'], line: '#aab4d6', plat: { top: ['#d4dbef', '#8e99b8'], side: '#4b5472', rim: '#f2f5ff' }, deco: 'spots', mood: 'arena' },
  [SCENE.LEADER]: { wall: ['#3a2f55', '#1e1832'], trim: '#e6b94a', floor: ['#8d7a5a', '#4c4030'], line: '#d9c08a', plat: { top: ['#e9dcc0', '#a6935f'], side: '#5a4a2e', rim: '#fff3d2' }, deco: 'banners', mood: 'arena' },
  [SCENE.GYM]: { wall: ['#2b3a52', '#161f30'], trim: '#59d1c6', floor: ['#7d8aa0', '#3e485a'], line: '#9fb1cf', plat: { top: ['#d6e2f3', '#8497b5'], side: '#3d4a62', rim: '#f4faff' }, deco: 'spots', mood: 'arena' },
  [SCENE.CHAMPION]: { wall: ['#1a2f6b', '#0c1840'], trim: '#ffd166', floor: ['#f0e4c4', '#b39d6a'], line: '#d4bd82', plat: { top: ['#fff6dc', '#cdb87d'], side: '#7a6633', rim: '#ffffff' }, deco: 'columns', mood: 'grand' },
  [SCENE.MAGMA]: { wall: ['#4a1a14', '#220a08'], trim: '#ff7a3d', floor: ['#6a3a30', '#2e1612'], line: '#ff7a3d', plat: { top: ['#b86a50', '#6a3326'], side: '#3a1812', rim: '#ffb184' }, deco: 'pipes', mood: 'hot' },
  [SCENE.AQUA]: { wall: ['#15355e', '#0a1a33'], trim: '#4cc3ff', floor: ['#5a7ea8', '#2a4467'], line: '#7fc8ff', plat: { top: ['#a9d3f5', '#5b86b3'], side: '#25405f', rim: '#e4f4ff' }, deco: 'pipes', mood: 'cool' },
  [SCENE.SIDNEY]: { wall: ['#1d1426', '#0a0610'], trim: '#c04a5a', floor: ['#4a3a55', '#1a1222'], line: '#8a5a8a', plat: { top: ['#7a5f8d', '#3a2a4a'], side: '#1a1020', rim: '#c9a0e0' }, deco: 'hex', mood: 'dark' },
  [SCENE.PHOEBE]: { wall: ['#2a1d4a', '#120a28'], trim: '#a86bff', floor: ['#5a4a85', '#241a40'], line: '#b08aff', plat: { top: ['#9b86d6', '#4c3c80'], side: '#1d1240', rim: '#e0d0ff' }, deco: 'wisps', mood: 'ghost' },
  [SCENE.GLACIA]: { wall: ['#7fc4ea', '#356c9c'], trim: '#e6f7ff', floor: ['#cfeaf8', '#7fb4d6'], line: '#ffffff', plat: { top: ['#f4fbff', '#a6d4ee'], side: '#5a8fb4', rim: '#ffffff' }, deco: 'ice', mood: 'ice' },
  [SCENE.DRAKE]: { wall: ['#0f3a46', '#06191f'], trim: '#e0b84a', floor: ['#3e7a80', '#173a3f'], line: '#e0b84a', plat: { top: ['#7fc4c4', '#2f6a6e'], side: '#0f2f33', rim: '#d2f5ee' }, deco: 'scales', mood: 'drake' },
};
const CAVES = {
  [SCENE.CAVE]: { bg: ['#3a3142', '#17121c'], rock: ['#5b4c57', '#2d242d'], ground: ['#6b5a55', '#2f2623'], light: 'rgba(255,214,160,0.12)', plat: { top: ['#9c8a82', '#5e4f4a'], side: '#3c3030', rim: '#cdbdb2' }, crystals: false },
  [SCENE.GROUDON]: { bg: ['#4a0f0a', '#c8420f'], rock: ['#5a1f14', '#240a07'], ground: ['#4a2822', '#1a0c0a'], light: 'rgba(255,120,40,0.22)', plat: { top: ['#8a4a38', '#401c14'], side: '#220d09', rim: '#ff9a55' }, lava: true },
};

export function sceneKind(id) {
  if (id in OUT) return 'out';
  if (id in WATERS) return 'water';
  if (id in ROOMS) return 'room';
  if (id in CAVES) return 'cave';
  return 'out';
}

function platformsFor(lay, st) {
  // Plattformen der Kämpfer (GBA-Koordinaten der Pokémon-Mitte, Füße etwa 34 Pixel tiefer)
  return lay.plats.map((p) => ({ ...p, st }));
}

// ---------- ruhende Ebene ----------
export function drawStatic(c, W, H, scene, lay) {
  const kind = sceneKind(scene);
  const hy = lay.hy;
  c.save();
  c.clearRect(0, 0, W, H);
  if (kind === 'out') drawOutdoor(c, W, H, hy, OUT[scene] || OUT[SCENE.GRASS], scene, lay);
  else if (kind === 'water') drawWater(c, W, H, hy, WATERS[scene], scene, lay);
  else if (kind === 'room') drawRoom(c, W, H, hy, ROOMS[scene], scene, lay);
  else drawCave(c, W, H, hy, CAVES[scene], scene, lay);
  c.restore();
}

function drawOutdoor(c, W, H, hy, o, scene, lay) {
  const r = rng(1000 + scene);
  c.fillStyle = vgrad(c, 0, hy + 4, o.sky);
  c.fillRect(0, 0, W, hy + 90);
  // Sonne / Glanz
  const sun = c.createRadialGradient(W * 0.2, hy * 0.45, 4, W * 0.2, hy * 0.45, W * 0.7);
  sun.addColorStop(0, o.clouds2 ? 'rgba(255,200,150,0.55)' : 'rgba(255,255,230,0.65)');
  sun.addColorStop(0.25, 'rgba(255,255,230,0.18)');
  sun.addColorStop(1, 'rgba(255,255,230,0)');
  c.fillStyle = sun;
  c.fillRect(0, 0, W, hy + 4);
  if (o.peaks) {
    // Gebirgskette mit Schneekappen
    for (let layer = 0; layer < 2; layer++) {
      const base = hy + 6, rr = rng(77 + layer * 5);
      let x = -30;
      while (x < W + 30) {
        const w = 90 + rr() * 90, h = (layer ? 0.55 : 0.85) * (70 + rr() * 90);
        c.fillStyle = layer ? '#7c869d' : '#9aa6bf';
        c.beginPath(); c.moveTo(x, base); c.lineTo(x + w / 2, base - h); c.lineTo(x + w, base); c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.92)';
        c.beginPath(); c.moveTo(x + w / 2, base - h); c.lineTo(x + w / 2 - w * 0.13, base - h * 0.72); c.lineTo(x + w / 2 - w * 0.03, base - h * 0.78); c.lineTo(x + w / 2 + w * 0.05, base - h * 0.7); c.lineTo(x + w / 2 + w * 0.13, base - h * 0.74); c.closePath(); c.fill();
        c.fillStyle = 'rgba(30,40,70,0.22)';
        c.beginPath(); c.moveTo(x + w / 2, base - h); c.lineTo(x + w, base); c.lineTo(x + w * 0.55, base); c.closePath(); c.fill();
        x += w * (0.55 + rr() * 0.2);
      }
    }
  }
  for (let i = 0; i < o.clouds; i++) cloud(c, r() * W, hy * (0.12 + r() * 0.5), 60 + r() * 70, 0.85, o.clouds2 ? '#ffd9c4' : '#ffffff');
  hills(c, W, hy + 8, 26, hy + 40, o.hills[0][0], o.hills[0][1], 11 + scene, 0.9);
  if (o.trees) {
    const tr = rng(55 + scene);
    for (let x = 6; x < W; x += 20 + tr() * 26) tree(c, x, hy + 14 + tr() * 6, 30 + tr() * 22, '#2f7a3f', '#6cc26b');
  }
  hills(c, W, hy + 24, 20, hy + 70, o.hills[1][0], o.hills[1][1], 31 + scene, 1.2);
  // Boden
  c.fillStyle = vgrad(c, hy + 20, H, [o.ground[0], mix(o.ground[0], o.ground[1], 0.55), o.ground[1]]);
  c.fillRect(0, hy + 20, W, H - hy - 20);
  // Streifen (gemähte Bahnen) für Tiefe
  c.save();
  for (let i = 0; i < 9; i++) {
    const t0 = Math.pow(i / 9, 1.7), t1 = Math.pow((i + 0.5) / 9, 1.7);
    c.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    c.fillRect(0, hy + 20 + (H - hy - 20) * t0, W, (H - hy - 20) * (t1 - t0) + 1);
  }
  c.restore();
  if (o.dunes) {
    hills(c, W, hy + 60, 14, H, 'rgba(255,240,200,0.45)', 'rgba(255,240,200,0)', 91, 1.6);
    c.strokeStyle = 'rgba(120,80,20,0.14)'; c.lineWidth = 1.4;
    for (let i = 0; i < 30; i++) {
      const y = hy + 40 + r() * (H - hy - 40), x = r() * W, w = 30 + r() * 80;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, y - 5, x + w, y); c.stroke();
    }
  } else {
    blades(c, 0, hy + 36, W, H, o.tall ? 230 : 120, o.tufts, o.tall ? 30 : 15, 300 + scene);
  }
  if (!o.dunes && !o.peaks && !o.clouds2) {
    // kleine Blumen
    const fr = rng(900 + scene);
    for (let i = 0; i < 26; i++) {
      const x = fr() * W, y = hy + 40 + fr() * (H - hy - 40);
      c.fillStyle = ['#fff3a6', '#ffffff', '#ff9bb8'][i % 3];
      ell(c, x, y, 2.1, 1.6); c.fill();
    }
  }
  if (o.peaks) {
    const rr = rng(777);
    for (let i = 0; i < 14; i++) {
      const x = rr() * W, y = hy + 40 + rr() * (H - hy - 40), s = 8 + rr() * 22;
      c.fillStyle = 'rgba(40,36,30,0.25)'; ell(c, x, y + s * 0.3, s * 0.9, s * 0.25); c.fill();
      c.fillStyle = vgrad(c, y - s * 0.6, y + s * 0.4, ['#a9a396', '#6f695d']);
      c.beginPath(); c.ellipse(x, y, s * 0.8, s * 0.5, 0, 0, Math.PI * 2); c.fill();
    }
  }
  // Tiefe durch Dunst am Horizont
  const haze = c.createLinearGradient(0, hy - 10, 0, hy + 60);
  haze.addColorStop(0, 'rgba(255,255,255,0)');
  haze.addColorStop(0.35, 'rgba(255,255,255,0.22)');
  haze.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = haze;
  c.fillRect(0, hy - 10, W, 70);
  for (const p of platformsFor(lay, o.plat)) platform(c, p, o.plat);
  vignette(c, W, H, 0.22);
}

function drawWater(c, W, H, hy, o, scene, lay) {
  const r = rng(2000 + scene);
  c.fillStyle = vgrad(c, 0, hy + 2, o.sky);
  c.fillRect(0, 0, W, hy + 2);
  if (!o.deep) {
    const sun = c.createRadialGradient(W * 0.75, hy * 0.5, 4, W * 0.75, hy * 0.5, W * 0.6);
    sun.addColorStop(0, 'rgba(255,255,235,0.7)');
    sun.addColorStop(1, 'rgba(255,255,235,0)');
    c.fillStyle = sun; c.fillRect(0, 0, W, hy + 2);
    for (let i = 0; i < 4; i++) cloud(c, r() * W, hy * (0.15 + r() * 0.5), 60 + r() * 70, 0.8);
  }
  // Wasserfläche
  c.fillStyle = vgrad(c, hy, H, [o.sea[0], mix(o.sea[0], o.sea[1], 0.5), o.sea[1]]);
  c.fillRect(0, hy, W, H - hy);
  if (o.deep) {
    rays(c, W, 0, H * 0.8, 9, 'rgba(160,230,255,0.22)', 5 + scene, 0.35);
    // Meeresboden
    hills(c, W, H - 90, 16, H, '#2b6c86', '#10364a', 77, 1.1);
    const rr = rng(321);
    for (let i = 0; i < 16; i++) {
      const x = rr() * W, y = H - 40 - rr() * 40, s = 30 + rr() * 50;
      c.strokeStyle = ['#2fbf8f', '#e0668c', '#f0a548'][i % 3]; c.lineWidth = 3;
      c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x - 10, y - s * 0.4, x + 12, y - s * 0.7, x, y - s); c.stroke();
    }
  } else {
    // Horizontglanz
    const gl = c.createLinearGradient(0, hy, 0, hy + 40);
    gl.addColorStop(0, 'rgba(255,255,255,0.5)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gl; c.fillRect(0, hy, W, 40);
    if (o.pads) {
      for (let i = 0; i < 12; i++) {
        const x = r() * W, y = hy + 40 + r() * (H - hy - 40), s = 14 + r() * 18;
        c.fillStyle = 'rgba(40,120,60,0.8)'; ell(c, x, y, s, s * 0.35); c.fill();
        c.fillStyle = 'rgba(120,200,110,0.6)'; ell(c, x - 2, y - 1, s * 0.7, s * 0.22); c.fill();
        if (i % 4 === 0) { c.fillStyle = '#ffd1e6'; ell(c, x + s * 0.2, y - s * 0.25, 3.4, 2.4); c.fill(); }
      }
      // Schilf links und rechts
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < 24; i++) {
          const x = side ? W - r() * 40 : r() * 40, y = H - 10 - r() * 160, h = 40 + r() * 60;
          c.strokeStyle = ['#4a7a3a', '#6aa04c', '#3a6a30'][i % 3]; c.lineWidth = 2.4;
          c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + (side ? -8 : 8), y - h * 0.5, x + (side ? -16 : 16) * (r() - 0.2), y - h); c.stroke();
        }
      }
    }
  }
  for (const p of platformsFor(lay, { water: true, glow: o.glow })) platform(c, p, { water: true, glow: o.glow });
  vignette(c, W, H, 0.25);
}

function drawRoom(c, W, H, hy, o, scene, lay) {
  const r = rng(3000 + scene);
  // Wand
  c.fillStyle = vgrad(c, 0, hy + 10, o.wall);
  c.fillRect(0, 0, W, hy + 10);
  // Wandmuster
  c.save();
  switch (o.deco) {
    case 'windows':
      for (let i = 0; i < 3; i++) {
        const x = W * (0.12 + i * 0.3), y = hy * 0.2, w = W * 0.2, h = hy * 0.55;
        c.fillStyle = '#7a5a38'; c.fillRect(x - 4, y - 4, w + 8, h + 8);
        c.fillStyle = vgrad(c, y, y + h, ['#9fd8ff', '#e4f6ff']); c.fillRect(x, y, w, h);
        c.fillStyle = '#7a5a38'; c.fillRect(x + w / 2 - 2, y, 4, h); c.fillRect(x, y + h / 2 - 2, w, 4);
      }
      break;
    case 'spots':
      for (let i = 0; i < 3; i++) {
        const x = W * (0.2 + i * 0.3);
        const g = c.createRadialGradient(x, 0, 4, x, hy * 0.9, W * 0.35);
        g.addColorStop(0, o.mood === 'arena' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.22)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.moveTo(x - 10, 0); c.lineTo(x + 10, 0); c.lineTo(x + W * 0.3, hy + 10); c.lineTo(x - W * 0.3, hy + 10); c.closePath(); c.fill();
      }
      break;
    case 'banners':
      for (let i = 0; i < 4; i++) {
        const x = W * (0.12 + i * 0.25), w = W * 0.1;
        c.fillStyle = i % 2 ? '#8c2f3f' : '#2f4a8c';
        c.beginPath(); c.moveTo(x, 8); c.lineTo(x + w, 8); c.lineTo(x + w, hy * 0.7); c.lineTo(x + w / 2, hy * 0.6); c.lineTo(x, hy * 0.7); c.closePath(); c.fill();
        c.fillStyle = o.trim; c.fillRect(x, 8, w, 6);
      }
      break;
    case 'columns':
      for (let i = 0; i < 5; i++) {
        const x = W * (0.02 + i * 0.24), w = W * 0.1;
        const g = c.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, '#223a82'); g.addColorStop(0.35, '#5b78d0'); g.addColorStop(1, '#16275e');
        c.fillStyle = g; c.fillRect(x, 0, w, hy + 10);
        c.fillStyle = o.trim; c.fillRect(x - 3, 0, w + 6, 10); c.fillRect(x - 3, hy - 8, w + 6, 10);
      }
      break;
    case 'pipes':
      c.strokeStyle = o.trim; c.globalAlpha = 0.5; c.lineWidth = 8;
      for (let i = 0; i < 3; i++) { const y = 20 + i * hy * 0.28; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      c.globalAlpha = 0.25; c.lineWidth = 14;
      for (let i = 0; i < 4; i++) { const x = W * (0.1 + i * 0.27); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, hy + 10); c.stroke(); }
      break;
    case 'hex':
      c.strokeStyle = o.line; c.globalAlpha = 0.18; c.lineWidth = 1.5;
      for (let y = 0; y < hy; y += 38) for (let x = -20; x < W + 40; x += 66) { const ox = ((y / 38) | 0) % 2 ? 33 : 0; c.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; c.lineTo(x + ox + Math.cos(a) * 22, y + Math.sin(a) * 22); } c.closePath(); c.stroke(); }
      break;
    case 'wisps':
      for (let i = 0; i < 6; i++) {
        const x = r() * W, y = hy * (0.15 + r() * 0.6);
        const g = c.createRadialGradient(x, y, 2, x, y, 60 + r() * 50);
        g.addColorStop(0, 'rgba(190,140,255,0.45)'); g.addColorStop(1, 'rgba(190,140,255,0)');
        c.fillStyle = g; c.fillRect(x - 120, y - 120, 240, 240);
      }
      break;
    case 'ice':
      for (let i = 0; i < 12; i++) {
        const x = r() * W, w = 20 + r() * 40, h = 40 + r() * (hy * 0.7);
        c.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.2})`;
        c.beginPath(); c.moveTo(x, hy + 10); c.lineTo(x + w / 2, hy + 10 - h); c.lineTo(x + w, hy + 10); c.closePath(); c.fill();
      }
      break;
    case 'scales':
      c.strokeStyle = o.trim; c.globalAlpha = 0.2; c.lineWidth = 1.4;
      for (let y = 0; y < hy; y += 22) for (let x = -20; x < W + 40; x += 40) { const ox = ((y / 22) | 0) % 2 ? 20 : 0; c.beginPath(); c.arc(x + ox, y, 20, 0, Math.PI); c.stroke(); }
      break;
    default: break;
  }
  c.restore();
  // Sockelleiste
  c.fillStyle = o.trim;
  c.fillRect(0, hy + 2, W, 8);
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(0, hy + 10, W, 6);
  // Boden mit Fliesen/Linien in Perspektive
  c.fillStyle = vgrad(c, hy + 10, H, [o.floor[0], o.floor[1]]);
  c.fillRect(0, hy + 10, W, H - hy - 10);
  perspective(c, W, hy + 10, H, W / 2, o.line, 0.22, 9, 9);
  if (o.mood === 'ice') {
    const sh = c.createLinearGradient(0, hy, W, H);
    sh.addColorStop(0, 'rgba(255,255,255,0.4)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(255,255,255,0.25)');
    c.fillStyle = sh; c.fillRect(0, hy + 10, W, H - hy - 10);
  }
  if (o.mood === 'hot') {
    const g = c.createLinearGradient(0, H, 0, hy);
    g.addColorStop(0, 'rgba(255,100,40,0.35)'); g.addColorStop(1, 'rgba(255,100,40,0)');
    c.fillStyle = g; c.fillRect(0, hy, W, H - hy);
  }
  for (const p of platformsFor(lay, o.plat)) platform(c, p, { ...o.plat, tiles: true });
  vignette(c, W, H, o.mood === 'light' ? 0.2 : 0.45);
}

function drawCave(c, W, H, hy, o, scene, lay) {
  const r = rng(4000 + scene);
  c.fillStyle = vgrad(c, 0, H, o.bg);
  c.fillRect(0, 0, W, H);
  if (o.lava) {
    // glühender Hintergrund
    const g = c.createRadialGradient(W * 0.5, hy, 10, W * 0.5, hy, W * 0.8);
    g.addColorStop(0, 'rgba(255,200,80,0.7)'); g.addColorStop(0.4, 'rgba(255,100,30,0.3)'); g.addColorStop(1, 'rgba(255,60,10,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  // Felswand: Zacken oben
  const rock = vgrad(c, 0, hy, o.rock);
  c.fillStyle = rock;
  c.beginPath(); c.moveTo(0, 0);
  for (let x = 0; x <= W + 20; x += 18 + r() * 12) { c.lineTo(x, 20 + r() * hy * 0.35 + (Math.sin(x * 0.02) + 1) * 14); c.lineTo(x + 8 + r() * 8, 6 + r() * 20); }
  c.lineTo(W, 0); c.closePath(); c.fill();
  // Seitenfelsen
  for (let side = 0; side < 2; side++) {
    c.fillStyle = vgrad(c, 0, H, [o.rock[0], o.rock[1]]);
    c.beginPath();
    const x0 = side ? W : 0, dir = side ? -1 : 1;
    c.moveTo(x0, hy * 0.2);
    c.lineTo(x0 + dir * W * 0.16, hy * 0.55); c.lineTo(x0 + dir * W * 0.08, hy + 20); c.lineTo(x0 + dir * W * 0.2, hy + 40); c.lineTo(x0, hy + 70);
    c.closePath(); c.fill();
  }
  // Lichtkegel
  rays(c, W, 0, H * 0.7, 3, o.light, 12 + scene, 0.25);
  // Boden
  c.fillStyle = vgrad(c, hy + 12, H, o.ground);
  c.fillRect(0, hy + 12, W, H - hy - 12);
  hills(c, W, hy + 12, 8, hy + 40, o.rock[0], o.ground[0], 41, 2);
  const rr = rng(555 + scene);
  for (let i = 0; i < 22; i++) {
    const x = rr() * W, y = hy + 40 + rr() * (H - hy - 40), s = 6 + rr() * 18;
    c.fillStyle = 'rgba(0,0,0,0.22)'; ell(c, x, y + s * 0.3, s, s * 0.3); c.fill();
    c.fillStyle = vgrad(c, y - s * 0.5, y + s * 0.3, [mix(o.ground[0], '#ffffff', 0.15), o.ground[1]]);
    ell(c, x, y, s * 0.8, s * 0.5); c.fill();
  }
  if (o.lava) {
    // Lavarisse im Boden
    c.strokeStyle = 'rgba(255,130,40,0.85)'; c.lineWidth = 2.4;
    c.shadowColor = '#ff7a20'; c.shadowBlur = 10;
    for (let i = 0; i < 7; i++) {
      let x = rr() * W, y = hy + 50 + rr() * (H - hy - 60);
      c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rr() - 0.4) * 60; y += (rr() - 0.5) * 24; c.lineTo(x, y); }
      c.stroke();
    }
    c.shadowBlur = 0;
  }
  for (const p of platformsFor(lay, o.plat)) platform(c, p, o.plat);
  vignette(c, W, H, 0.5);
}

// ---------- bewegte Ebene ----------
const parts = { key: '', list: [] };

function seedParticles(kind, W, H, n) {
  const r = rng(kind.length * 977 + n);
  const list = [];
  for (let i = 0; i < n; i++) list.push({ x: r() * W, y: r() * H, s: 0.4 + r() * 0.9, p: r() * 6.28 });
  return list;
}

/**
 * Zeichnet die bewegte Ebene unter den Pokémon (t in Sekunden).
 */
export function drawDynamic(c, W, H, scene, lay, t) {
  const kind = sceneKind(scene);
  const hy = lay.hy;
  c.clearRect(0, 0, W, H);
  const key = scene + ':' + W + 'x' + H;
  if (parts.key !== key) { parts.key = key; parts.list = seedParticles('p', W, H, 140); }
  const L = parts.list;
  if (kind === 'out' && OUT[scene] && OUT[scene].clouds) {
    const o = OUT[scene];
    for (let i = 0; i < 3; i++) {
      const x = ((t * (4 + i * 2) + i * W * 0.45) % (W + 260)) - 130;
      cloud(c, x, hy * (0.18 + i * 0.16), 70 + i * 22, 0.55, o.clouds2 ? '#ffd9c4' : '#ffffff');
    }
  }
  if (kind === 'water') {
    const o = WATERS[scene];
    if (o.deep) {
      for (let i = 0; i < 40; i++) {
        const p = L[i], y = (H - ((t * (18 + p.s * 22) + p.y) % (H + 20)));
        const x = p.x + Math.sin(t * 1.2 + p.p) * 6;
        c.fillStyle = 'rgba(210,245,255,0.45)';
        ell(c, x, y, 1.5 + p.s * 3, 1.5 + p.s * 3); c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 0.8; c.stroke();
      }
    } else {
      // Wellenlinien
      c.lineWidth = 1.6;
      for (let row = 0; row < 14; row++) {
        const y = hy + 14 + Math.pow(row / 14, 1.6) * (H - hy - 14);
        const amp = 1 + row * 0.35, len = 40 + row * 14;
        c.strokeStyle = `rgba(255,255,255,${0.1 + row * 0.018})`;
        c.beginPath();
        for (let x = -len; x <= W + len; x += 10) {
          const yy = y + Math.sin(x / len * 6.28 + t * (0.9 + row * 0.06) + row) * amp;
          if (x === -len) c.moveTo(x, yy); else c.lineTo(x, yy);
        }
        c.stroke();
      }
    }
  }
  if (kind === 'cave' && CAVES[scene].lava) {
    for (let i = 0; i < 40; i++) {
      const p = L[i], y = H - ((t * (14 + p.s * 26) + p.y) % H), x = p.x + Math.sin(t + p.p) * 10;
      c.fillStyle = `rgba(255,${150 + (i % 4) * 25},60,${0.35 + p.s * 0.4})`;
      ell(c, x, y, 1.2 + p.s * 1.6, 1.2 + p.s * 1.6); c.fill();
    }
  }
  if (kind === 'room') {
    const o = ROOMS[scene];
    if (o.deco === 'wisps' || o.mood === 'ghost') {
      for (let i = 0; i < 18; i++) {
        const p = L[i], x = (p.x + t * 10 * p.s) % W, y = hy * 0.7 + Math.sin(t * 0.8 + p.p) * 30 + p.y * 0.2;
        const g = c.createRadialGradient(x, y, 1, x, y, 26);
        g.addColorStop(0, 'rgba(210,170,255,0.5)'); g.addColorStop(1, 'rgba(210,170,255,0)');
        c.fillStyle = g; c.fillRect(x - 30, y - 30, 60, 60);
      }
    }
    if (o.mood === 'ice') {
      for (let i = 0; i < 50; i++) {
        const p = L[i], x = (p.x + Math.sin(t * 0.7 + p.p) * 12), y = (p.y + t * (10 + p.s * 18)) % H;
        c.fillStyle = 'rgba(255,255,255,0.7)'; ell(c, x, y, 1 + p.s, 1 + p.s); c.fill();
      }
    }
    if (o.mood === 'hot') {
      for (let i = 0; i < 24; i++) {
        const p = L[i], y = H - ((t * (16 + p.s * 24) + p.y) % H), x = p.x + Math.sin(t + p.p) * 8;
        c.fillStyle = `rgba(255,${130 + (i % 3) * 30},50,0.55)`; ell(c, x, y, 1.4, 1.4); c.fill();
      }
    }
  }
}

/** Wetter (über den Pokémon gezeichnet). */
export function drawWeather(c, W, H, t, w) {
  c.clearRect(0, 0, W, H);
  if (!(w & 0xff)) return;
  if (!parts.list.length) parts.list = seedParticles('p', W, H, 140);
  weatherLayer(c, W, H, t, w, parts.list);
}

function weatherLayer(c, W, H, t, w, L) {
  if (w & 0x07) {
    // Regen: dunkler Schleier + schräge Striche
    c.fillStyle = 'rgba(20,40,80,0.22)'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(200,225,255,0.7)'; c.lineWidth = 1.3;
    c.beginPath();
    for (let i = 0; i < 110; i++) {
      const p = L[i % L.length];
      const sp = 520 + p.s * 340;
      const y = ((t * sp + p.y * 7 + i * 31) % (H + 60)) - 30;
      const x = ((p.x + i * 57) % (W + 80)) - 40 - y * 0.18;
      c.moveTo(x, y); c.lineTo(x - 5, y + 16);
    }
    c.stroke();
  } else if (w & 0x18) {
    c.fillStyle = 'rgba(200,160,90,0.30)'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) {
      const p = L[i % L.length];
      const x = ((t * (230 + p.s * 220) + p.x * 3 + i * 17) % (W + 40)) - 20, y = (p.y + i * 23 + Math.sin(t * 2 + p.p) * 8) % H;
      c.fillStyle = `rgba(245,215,150,${0.35 + p.s * 0.35})`;
      c.fillRect(x, y, 2.4 + p.s * 1.5, 1.6);
    }
  } else if (w & 0x60) {
    const g = c.createRadialGradient(W * 0.86, 40, 4, W * 0.86, 40, W * 1.0);
    g.addColorStop(0, 'rgba(255,240,170,0.65)'); g.addColorStop(0.3, 'rgba(255,210,110,0.22)'); g.addColorStop(1, 'rgba(255,200,100,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,190,80,0.10)'; c.fillRect(0, 0, W, H);
  } else if (w & 0x80) {
    c.fillStyle = 'rgba(170,200,235,0.20)'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      const p = L[i % L.length];
      const y = ((t * (200 + p.s * 140) + p.y * 4 + i * 29) % (H + 30)) - 15;
      const x = ((p.x + i * 41 + Math.sin(t * 2 + p.p) * 12) % (W + 40)) - 20;
      c.fillStyle = 'rgba(245,250,255,0.9)';
      ell(c, x, y, 1.8 + p.s * 1.6, 1.8 + p.s * 1.6); c.fill();
    }
  }
}
