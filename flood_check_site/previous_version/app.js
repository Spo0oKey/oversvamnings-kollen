/* Kustöversvämnings Kollen — client-side lookup of MSB coastal / Vänern flood thresholds. */
(() => {
'use strict';

// ---------------------------------------------------------------------------
// Language (Swedish by default, English as an option; the choice is remembered in this browser)
let LANG = 'sv';
try { const saved = localStorage.getItem('kk-lang'); if (saved && I18N[saved]) LANG = saved; } catch { /* storage unavailable */ }
const t = (key, vars = {}) => String(I18N[LANG][key] ?? I18N.sv[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

// ---------------------------------------------------------------------------
// SWEREF 99 TM forward projection (WGS84 lat/lon -> northing/easting), Gauss–Krüger
// formulas as published by Lantmäteriet.
const TM = (() => {
  const a = 6378137, f = 1 / 298.257222101, lon0 = 15 * Math.PI / 180, k0 = 0.9996, FE = 500000;
  const e2 = f * (2 - f), n = f / (2 - f);
  const ar = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
  const A = e2, B = (5 * e2 ** 2 - e2 ** 3) / 6, C = (104 * e2 ** 3 - 45 * e2 ** 4) / 120, D = (1237 * e2 ** 4) / 1260;
  const b1 = n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180;
  const b2 = 13 * n * n / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440;
  const b3 = 61 * n ** 3 / 240 - 103 * n ** 4 / 140;
  const b4 = 49561 * n ** 4 / 161280;
  return (lat, lon) => {
    const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
    const s = Math.sin(phi), s2 = s * s;
    const ps = phi - s * Math.cos(phi) * (A + B * s2 + C * s2 * s2 + D * s2 * s2 * s2);
    const dl = lam - lon0;
    const xi = Math.atan(Math.tan(ps) / Math.cos(dl));
    const eta = Math.atanh(Math.cos(ps) * Math.sin(dl));
    const N = k0 * ar * (xi + b1 * Math.sin(2 * xi) * Math.cosh(2 * eta) + b2 * Math.sin(4 * xi) * Math.cosh(4 * eta)
      + b3 * Math.sin(6 * xi) * Math.cosh(6 * eta) + b4 * Math.sin(8 * xi) * Math.cosh(8 * eta));
    const E = k0 * ar * (eta + b1 * Math.cos(2 * xi) * Math.sinh(2 * eta) + b2 * Math.cos(4 * xi) * Math.sinh(4 * eta)
      + b3 * Math.cos(6 * xi) * Math.sinh(6 * eta) + b4 * Math.cos(8 * xi) * Math.sinh(8 * eta)) + FE;
    return [E, N];
  };
})();

// ---------------------------------------------------------------------------
// Data access
const NONE = 255;
let META = null;
const cache = new Map();           // key -> Promise<Uint8Array|number>
const CACHE_MAX = 300;

async function inflate(buf) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Tiles live in a few "pack" files; each tile is fetched with an HTTP Range request.
// If a server ignores Range (plain 200 response), the whole pack is kept and sliced instead.
const wholePacks = new Map();
async function fetchRange(pack, off, len) {
  const url = `data/${META.packs[pack]}`;
  if (wholePacks.has(pack)) return (await wholePacks.get(pack)).slice(off, off + len);
  const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
  if (r.status === 206) return r.arrayBuffer();
  if (!r.ok) throw new Error(r.status);
  const whole = r.arrayBuffer(); wholePacks.set(pack, whole);
  return (await whole).slice(off, off + len);
}

function getTile(kind, tx, ty) {           // kind: 't' (5 m) or 'o' (50 m)
  const id = `${tx}_${ty}`, key = `${kind}/${id}`;
  if (cache.has(key)) { const p = cache.get(key); cache.delete(key); cache.set(key, p); return p; }
  let p;
  const loc = META.index[kind][id];
  if (kind === 't' && META.uniform[id] !== undefined) p = Promise.resolve(META.uniform[id]);
  else if (!loc) p = Promise.resolve(NONE);
  else p = fetchRange(...loc).then(inflate).catch(() => { cache.delete(key); return NONE; });
  cache.set(key, p);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

function cellOf(E, N, cell) {
  return [Math.floor((E - META.x0) / cell), Math.floor((META.y0 - N) / cell)];
}

async function valueAt(E, N) {
  const [c, r] = cellOf(E, N, META.cell);
  const T = META.tile;
  const t = await getTile('t', Math.floor(c / T), Math.floor(r / T));
  return typeof t === 'number' ? t : t[(r % T) * T + (c % T)];
}

// All cell values within `radius` metres of (E, N).
async function cellsAround(E, N, radius) {
  const cell = META.cell, T = META.tile;
  const [c0, r0] = cellOf(E - radius, N + radius, cell);
  const [c1, r1] = cellOf(E + radius, N - radius, cell);
  const need = new Map();
  for (let ty = Math.floor(r0 / T); ty <= Math.floor(r1 / T); ty++)
    for (let tx = Math.floor(c0 / T); tx <= Math.floor(c1 / T); tx++)
      need.set(`${tx}_${ty}`, getTile('t', tx, ty));
  const tiles = new Map();
  for (const [k, p] of need) tiles.set(k, await p);
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const cx = META.x0 + (c + .5) * cell, cy = META.y0 - (r + .5) * cell;
    if ((cx - E) ** 2 + (cy - N) ** 2 > radius * radius) continue;
    const t = tiles.get(`${Math.floor(c / T)}_${Math.floor(r / T)}`);
    out.push(typeof t === 'number' ? t : t[(r % T) * T + (c % T)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Interpreting cell values
const isCoast = v => v >= 1 && v <= 50;
const isVanern = v => v >= 101 && v <= 120;
// Height above "normal" water that floods this cell (m) — used for colouring both systems.
function riseOf(v) {
  if (isCoast(v)) return v / 10;
  if (isVanern(v)) return VANERN_CLASSES[v - 101][1] - VANERN_MEAN;
  return null;
}

const RISK = {
  vhigh: { key: 'risk.vhigh', color: 'var(--r-critical)', icon: '!!' },
  high: { key: 'risk.high', color: 'var(--r-serious)', icon: '!' },
  moderate: { key: 'risk.moderate', color: 'var(--r-warning)', icon: '~' },
  low: { key: 'risk.low', color: 'var(--r-low)', icon: '↓' },
  vlow: { key: 'risk.vlow', color: 'var(--r-good)', icon: '✓' },
};

function nearest(list, lat, lon) {
  let best = null, bd = Infinity;
  for (const s of list) {
    const d = ((s.lat - lat) * 111) ** 2 + ((s.lon - lon) * 111 * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return { ...best, km: Math.sqrt(bd) };
}

function assessCoast(v, lat, lon) {
  const h = v / 10;
  const st = nearest(SMHI_STATIONS, lat, lon);
  const rec = st.max / 100;
  let risk, text;
  let kind;
  if (v === 1) { risk = 'vhigh'; kind = 'sea'; }
  else if (h <= 1.0) risk = kind = 'vhigh';
  else if (h <= Math.max(1.5, rec)) risk = kind = 'high';
  else if (h <= 3.0) risk = kind = 'moderate';
  else risk = kind = 'low';
  text = () => t('coast.' + kind, { h: fmt(h), near: t('coast.near', { rec: fmt(rec), st: st.name, yr: st.date.slice(0, 4) }) });
  return { system: 'coast', risk, h, text, station: st, rec };
}

function assessVanern(v, lat, lon) {
  const [lo, hi] = VANERN_CLASSES[v - 101];
  const m = nearest(VANERN_LEVELS, lat, lon);
  let risk, text;
  const lake = () => t('van.lake', { mean: fmt(VANERN_MEAN), range: lo == null ? t('van.below', { hi: fmt(hi) }) : t('van.between', { lo: fmt(lo), hi: fmt(hi) }) });
  if (hi <= 44.8) risk = 'vhigh';
  else if (hi <= m.y100) risk = 'high';
  else if (hi <= m.max) risk = 'moderate';
  else risk = 'low';
  text = () => t('van.' + risk, { lake: lake(), y100: fmt(m.y100), max: fmt(m.max), muni: m.name });
  return { system: 'vanern', risk, lo, hi, text, muni: m };
}

const fmt = x => (Math.round(x * 100) / 100).toLocaleString(LANG === 'sv' ? 'sv-SE' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Map
const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([62.0, 16.5], 5);
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const base = {
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
};
base.osm.addTo(map);
// Flood layers get their own pane above the basemap, so switching basemap never hides them.
map.createPane('flood');
map.getPane('flood').style.zIndex = 450;
map.getPane('flood').style.pointerEvents = 'none';
let layerControl = null;
function buildLayerControl() {
  if (layerControl) layerControl.remove();
  layerControl = L.control.layers({ [t('base.osm')]: base.osm, [t('base.sat')]: base.sat }, null,
    { position: 'topright', collapsed: matchMedia('(max-width: 800px)').matches }).addTo(map);
}
buildLayerControl();
L.control.scale({ imperial: false }).addTo(map);

const state = { style: 'level', opacity: 0.7 };
// Which MSB layers are switched on: index 1..50 = kust_1..kust_50, 101..120 = nh_1..nh_20.
const layerOn = new Uint8Array(121);
for (let n = 2; n <= 50; n++) layerOn[n] = 1;           // kust_1 (+0.1 m) is essentially the sea itself: off by default
for (let n = 101; n <= 120; n++) layerOn[n] = 1;
// LUT: cell value -> the layer that paints it (0 = hidden). MSB layers are cumulative (kust_n = all
// land below +n dm), so a cell with value v is inside every layer n >= v; the lowest switched-on
// layer is drawn on top, as it would be if the layers were stacked in a GIS.
const LUT = new Uint8Array(256);
function rebuildLUT() {
  LUT.fill(0);
  for (const [lo, hi] of [[1, 50], [101, 120]]) {
    let next = 0;
    for (let v = hi; v >= lo; v--) { if (layerOn[v]) next = v; LUT[v] = next; }
  }
  LUT[1] = layerOn[1] ? 1 : 0;                         // don't paint the sea unless +0.1 m is on
}
rebuildLUT();

// Continuous sequential blue: a layer's colour depends on its water level (rise above normal).
const STOPS = [[0, '#0d366b'], [0.5, '#184f95'], [1, '#256abf'], [1.5, '#3987e5'], [2.5, '#6da7ec'], [3.5, '#9ec5f4'], [5, '#cde2fb']]
  .map(([t, h]) => [t, [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))]);
function colorAt(rise) {
  rise = Math.max(0, Math.min(5, rise));
  for (let i = 1; i < STOPS.length; i++) if (rise <= STOPS[i][0]) {
    const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], f = (rise - t0) / (t1 - t0);
    return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
  }
  return STOPS.at(-1)[1];
}
const LAYER_RGB = [];
for (let v = 1; v <= 120; v++) if (isCoast(v) || isVanern(v)) LAYER_RGB[v] = colorAt(riseOf(v));
const hex = c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');

// Smooth sampling: the 4 × 4 surrounding 5 m cells are blended with cubic B-spline weights, which are
// positive and sum to 1. A pixel is painted when the switched-on cells carry enough weight, and it takes
// their weighted-median layer. Borders become smooth curves instead of 5 m steps, while the point lookup
// in the result panel keeps using the exact cells.
const KS = new Uint8Array(16), WS = new Float32Array(16);
function bspline(t, out) {
  const t2 = t * t, t3 = t2 * t;
  out[0] = (1 - 3 * t + 3 * t2 - t3) / 6; out[1] = (3 * t3 - 6 * t2 + 4) / 6;
  out[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6; out[3] = t3 / 6;
}
const WX = new Float32Array(4), WY = new Float32Array(4);
// keys: KS[0..15] row-major around the pixel (0 = hidden); returns [key, alphaFactor]
function blend16() {
  let n = 0, wv = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const k = KS[j * 4 + i]; if (!k) continue;
    const w = WX[i] * WY[j]; wv += w;
    // insertion into sorted (by key) list at the front of KS/WS scratch
    let p = n++;
    while (p > 0 && SK16[p - 1] > k) { SK16[p] = SK16[p - 1]; SW16[p] = SW16[p - 1]; p--; }
    SK16[p] = k; SW16[p] = w;
  }
  if (wv <= 0.3) return BL_NONE;
  let acc = 0, key = SK16[n - 1];
  for (let i = 0; i < n; i++) { acc += SW16[i]; if (acc >= wv / 2) { key = SK16[i]; break; } }
  const t = Math.min(1, (wv - 0.3) / 0.4);             // soft edge between 30 % and 70 % coverage
  BL_OUT[0] = key; BL_OUT[1] = t * t * (3 - 2 * t);
  return BL_OUT;
}
const SK16 = new Uint8Array(16), SW16 = new Float32Array(16);
const BL_NONE = [0, 0], BL_OUT = [0, 0];

const FloodLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    this._draw(tile, coords).then(() => done(null, tile), e => done(e, tile));
    return tile;
  },
  async _draw(canvas, { x, y, z }) {
    if (!META) return;
    const detail = z >= 12;
    const cell = detail ? META.cell : META.ovcell, T = META.tile, kind = detail ? 't' : 'o';
    const W = 256 * 2 ** z;
    // per-pixel SWEREF coordinates, sampled at pixel centres
    const E = new Float64Array(65536), N = new Float64Array(65536);
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    for (let j = 0; j < 256; j++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y * 256 + j + .5) / W))) * 180 / Math.PI;
      for (let i = 0; i < 256; i++) {
        const lon = (x * 256 + i + .5) / W * 360 - 180;
        const [e, n] = TM(lat, lon);
        const k = j * 256 + i; E[k] = e; N[k] = n;
      }
    }
    for (const k of [0, 255, 65280, 65535, 128, 32768 + 255, 32768, 65408]) {
      const [c, r] = cellOf(E[k], N[k], cell);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    }
    minC -= 2; minR -= 2; maxC += 2; maxR += 2;          // margin for the 4 × 4 smoothing kernel
    const tx0 = Math.floor(minC / T), tx1 = Math.floor(maxC / T), ty0 = Math.floor(minR / T), ty1 = Math.floor(maxR / T);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64) return;
    const tw = tx1 - tx0 + 1, grid = new Array(tw * (ty1 - ty0 + 1));
    let any = false;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const t = await getTile(kind, tx, ty);
      grid[(ty - ty0) * tw + (tx - tx0)] = t;
      if (t !== NONE) any = true;
    }
    if (!any) return;
    const at = (c, r) => {                               // LUT key of cell (c, r)
      const tx = Math.floor(c / T), ty = Math.floor(r / T);
      if (tx < tx0 || tx > tx1 || ty < ty0 || ty > ty1) return 0;
      const t = grid[(ty - ty0) * tw + (tx - tx0)];
      return LUT[typeof t === 'number' ? t : t[(r - ty * T) * T + (c - tx * T)]];
    };
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(256, 256), px = img.data;
    const single = state.style === 'single', A = Math.round(255 * state.opacity);
    for (let k = 0; k < 65536; k++) {
      const fx = (E[k] - META.x0) / cell - 0.5, fy = (META.y0 - N[k]) / cell - 0.5;
      const c = Math.floor(fx), r = Math.floor(fy);
      let anyK = 0;
      for (let jj = 0; jj < 4; jj++) for (let ii = 0; ii < 4; ii++) anyK |= (KS[jj * 4 + ii] = at(c - 1 + ii, r - 1 + jj));
      if (!anyK) continue;
      bspline(fx - c, WX); bspline(fy - r, WY);
      const [key, f] = blend16();
      if (!key) continue;
      const col = single ? FLOOD_RGB : LAYER_RGB[key];
      const o = k * 4; px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = A * f;
    }
    ctx.putImageData(img, 0, 0);
  },
});
const FLOOD_RGB = dark ? [57, 135, 229] : [42, 120, 214];
const flood = new FloodLayer({ pane: 'flood', minZoom: 7, maxNativeZoom: 19, opacity: 1, updateWhenZooming: false, keepBuffer: 1 });

// ---------------------------------------------------------------------------
// UI
const $ = s => document.querySelector(s);
// ---- Flood layer picker -------------------------------------------------------------
const GROUPS = {
  coast: { lo: 1, hi: 50, chips: '#chipsCoast', all: '#allCoast', up: '#upCoast', upOut: '#upCoastOut', cnt: '#cntCoast',
    label: n => fmt(n / 10), title: n => t('adv.chip.coast', { n, h: fmt(n / 10) }), upLabel: n => `+${fmt(n / 10)} m` },
  vanern: { lo: 101, hi: 120, chips: '#chipsVanern', all: '#allVanern', up: '#upVanern', upOut: '#upVanernOut', cnt: '#cntVanern',
    label: n => fmt(VANERN_CLASSES[n - 101][1]), title: n => t('adv.chip.van', { n: n - 100, h: fmt(VANERN_CLASSES[n - 101][1]) }),
    upLabel: n => `${fmt(VANERN_CLASSES[n - 101][1])} m` },
};
let lastChip = null, layerTimer = null;
function layersChanged() {
  rebuildLUT();
  for (const g of Object.values(GROUPS)) {
    let on = 0, top = 0;
    for (let v = g.lo; v <= g.hi; v++) if (layerOn[v]) { on++; top = v; }
    const all = $(g.all); all.checked = on > 0; all.indeterminate = on > 0 && on < g.hi - g.lo + 1;
    $(g.cnt).textContent = t('adv.count', { on, n: g.hi - g.lo + 1 });
    $(g.upOut).textContent = g.upLabel(top || g.lo);
    document.querySelectorAll(`${g.chips} .chip`).forEach(ch => {
      const v = +ch.dataset.v; ch.classList.toggle('on', !!layerOn[v]); ch.setAttribute('aria-pressed', !!layerOn[v]);
    });
  }
  clearTimeout(layerTimer);
  layerTimer = setTimeout(() => { flood.redraw(); if (EX.on) paint(); }, 60);
}
function buildChips() {
  for (const [sys, g] of Object.entries(GROUPS)) {
    const box = $(g.chips);
    for (let v = g.lo; v <= g.hi; v++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.v = v; b.textContent = g.label(v); b.title = g.title(v);
      const c = LAYER_RGB[v], lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
      b.style.setProperty('--c', hex(c)); b.style.setProperty('--ink', lum > 0.55 ? '#0b0b0b' : '#ffffff');
      b.onclick = e => {
        if (e.altKey) { for (let x = g.lo; x <= g.hi; x++) layerOn[x] = 0; layerOn[v] = 1; }
        else if (e.shiftKey && lastChip && lastChip.sys === sys) {
          const on = layerOn[lastChip.v] ? 1 : 0;
          for (let x = Math.min(v, lastChip.v); x <= Math.max(v, lastChip.v); x++) layerOn[x] = on;
        } else layerOn[v] = layerOn[v] ? 0 : 1;
        lastChip = { sys, v };
        layersChanged();
      };
      box.appendChild(b);
    }
    $(g.all).onchange = e => { for (let x = g.lo; x <= g.hi; x++) layerOn[x] = e.target.checked && !(x === 1) ? 1 : 0; layersChanged(); };
    $(g.up).oninput = e => {
      const top = g.lo + +e.target.value - 1;
      for (let x = g.lo; x <= g.hi; x++) layerOn[x] = x <= top && x !== 1 ? 1 : 0;
      $(g.upOut).textContent = g.upLabel(top);
      layersChanged();
    };
  }
  layersChanged();
}
document.querySelectorAll('[data-style]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-style]').forEach(o => o.setAttribute('aria-checked', o === b));
  state.style = b.dataset.style; flood.redraw(); if (EX.on) paint();
});
$('#opacity').oninput = e => {
  state.opacity = e.target.value / 100; $('#opOut').textContent = pctText(e.target.value);
  clearTimeout(layerTimer); layerTimer = setTimeout(() => { flood.redraw(); if (EX.on) paint(); }, 60);
};

let marker = null, lastResult = null;

async function assess(lat, lon, label) {
  const [E, N] = TM(lat, lon);
  if (marker) marker.remove();
  marker = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [18, 18] }) }).addTo(map);
  const box = $('#result'); box.hidden = false;
  box.innerHTML = `<div class="addr">${esc(label || t('result.yourAddress'))}</div><p class="loading">${t('result.checking')}</p>`;

  const [v, near25, near100] = await Promise.all([valueAt(E, N), cellsAround(E, N, 25), cellsAround(E, N, 100)]);
  const mapped = x => x !== NONE;
  const lowest = arr => arr.filter(mapped).reduce((m, x) => Math.min(m, x), NONE);
  const res = { lat, lon, E, N, label, v, low25: lowest(near25), low100: lowest(near100), near100 };
  // Choose the system to report: the point itself, or the plot/surroundings if the point is dry.
  const sys = mapped(v) ? v : res.low25 !== NONE ? res.low25 : res.low100;
  res.a = sys === NONE ? null : isVanern(sys) ? assessVanern(sys, lat, lon) : assessCoast(sys, lat, lon);
  res.pointDry = !mapped(v);
  lastResult = res;
  render(res);
  openExplorer(res);                                    // always lock the view to the box around the address
}

const fmtN = x => (Math.round(x * 10) / 10).toLocaleString(LANG === 'sv' ? 'sv-SE' : 'en-GB');
const pctText = p => LANG === 'sv' ? `${p} %` : `${p}%`;
function share(arr, pred) { const m = arr.length ? arr.filter(pred).length / arr.length : 0; return pctText(Math.round(m * 100)); }

function render(res) {
  const box = $('#result');
  let html = `<div class="addr">${esc(res.label || t('result.yourAddress'))}</div>`;
  let details = '';
  if (!res.a) {
    html += badge(RISK.vlow) + `<p class="headline">${t('result.none.head')}</p><p class="explain">${t('result.none.text')}</p>`;
    details += `<p class="ctx">${t('result.none.ctx')}</p>`;
  } else {
    const a = res.a;
    let risk = RISK[a.risk];
    if (res.pointDry) risk = RISK[{ vhigh: 'high', high: 'moderate', moderate: 'low', low: 'low' }[a.risk]];
    html += badge(risk);
    if (a.system === 'coast') {
      html += a.h <= 0.1 ? `<p class="headline">${t('result.atSea')}</p>`
        : `<p class="headline">${t('result.coast.head', { h: fmt(a.h) })}<small>${t(res.pointDry ? 'result.coast.subDry' : 'result.coast.sub')}</small></p>`;
    } else {
      html += `<p class="headline">${t('result.van.head', { h: fmt(a.hi) })}<small>${t(res.pointDry ? 'result.van.subDry' : 'result.van.sub')}</small></p>`;
    }
    html += `<p class="explain">${a.text()}</p>`;
    const n = res.near100;
    if (a.system === 'coast') {
      details += `<div class="stats">
        <div class="stat"><b>${share(n, x => isCoast(x) && x > 1 && x <= 10)}</b><span>${t('stat.coast1')}</span></div>
        <div class="stat"><b>${share(n, x => isCoast(x) && x > 1 && x <= 20)}</b><span>${t('stat.coast2')}</span></div>
        <div class="stat"><b>${share(n, x => isCoast(x) && x > 1 && x <= 30)}</b><span>${t('stat.coast3')}</span></div></div>`;
      details += `<div class="ladder" id="ladder"></div><p class="ctx">${t('ctx.coast')}</p>`;
    } else {
      const m = a.muni;
      details += `<div class="stats">
        <div class="stat"><b>${fmt(m.y100)} m</b><span>${t('stat.van100', { muni: m.name })}</span></div>
        <div class="stat"><b>${fmt(m.y200)} m</b><span>${t('stat.van200')}</span></div>
        <div class="stat"><b>${fmt(m.max)} m</b><span>${t('stat.vanMax')}</span></div></div>`;
      details += `<div class="ladder" id="ladder"></div><p class="ctx">${t('ctx.van')}</p>`;
    }
  }
  details += `<p class="coords">${t('coords', { lat: res.lat.toFixed(5), lon: res.lon.toFixed(5), n: Math.round(res.N), e: Math.round(res.E) })}</p>`;
  const wasOpen = box.querySelector('details.more')?.open;
  html += `<details class="more"${wasOpen ? ' open' : ''}><summary>${t('details.summary')}</summary>${details}</details>`;
  box.innerHTML = html;
  if (res.a) drawLadder(res);
}

function badge(r) { return `<span class="badge"><i style="background:${r.color}">${r.icon}</i>${t('risk.badge', { r: t(r.key) })}</span>`; }

// A vertical "water level ladder": this location vs the reference level vs the scenario slider.
function drawLadder(res) {
  const el = $('#ladder'); if (!el || !res.a) return;
  const a = res.a, W = 340, H = 120, L0 = 40, R0 = W - 8;
  let lo, hi, ticks, marks;
  if (a.system === 'coast') {
    lo = 0; hi = 5; ticks = [0, 1, 2, 3, 4, 5];
    marks = [
      { v: a.h, label: t(res.pointDry ? 'ladder.nearby' : 'ladder.here'), color: 'var(--r-critical)', w: 3 },
      { v: a.rec, label: t('ladder.record', { st: a.station.name }), color: 'var(--text-2)', w: 2, dash: true },
      ...(EX.on && EX.sys === 'coast' ? [{ v: EX.level / 10, label: t('ladder.level'), color: 'var(--flood)', w: 2 }] : []),
    ];
  } else {
    lo = 44.5; hi = 48; ticks = [44.5, 45, 46, 47, 48];
    marks = [
      { v: a.hi, label: t(res.pointDry ? 'ladder.nearby' : 'ladder.here'), color: 'var(--r-critical)', w: 3 },
      { v: a.muni.y100, label: t('ladder.y100'), color: 'var(--text-2)', w: 2, dash: true },
      ...(EX.on && EX.sys === 'vanern' ? [{ v: VANERN_CLASSES[EX.level - 1][1], label: t('ladder.level'), color: 'var(--flood)', w: 2 }] : []),
    ];
  }
  const X = v => L0 + (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo) * (R0 - L0);
  const unit = a.system === 'coast' ? ' m' : '';
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('ladder.aria')}">`;
  s += `<rect x="${L0}" y="14" width="${R0 - L0}" height="10" rx="4" fill="var(--surface-2)"/>`;
  if (marks[2]) s += `<rect x="${L0}" y="14" width="${X(marks[2].v) - L0}" height="10" rx="4" fill="var(--flood)" opacity=".35"/>`;
  for (const tk of ticks) s += `<line class="tick" x1="${X(tk)}" x2="${X(tk)}" y1="26" y2="32"/><text x="${X(tk)}" y="44" text-anchor="middle">${a.system === 'coast' ? '+' + tk : (Number.isInteger(tk) ? tk : fmt(tk))}${tk === hi ? unit : ''}</text>`;
  s += `<text x="0" y="23">${t(a.system === 'coast' ? 'ladder.sea' : 'ladder.van')}</text>`;
  marks.forEach((m, i) => {
    const x = X(m.v), y = 62 + i * 19;
    s += `<line x1="${x}" x2="${x}" y1="8" y2="30" stroke="${m.color}" stroke-width="${m.w}" ${m.dash ? 'stroke-dasharray="3 2"' : ''}/>`;
    s += `<line x1="${L0}" x2="${L0 + 18}" y1="${y - 4}" y2="${y - 4}" stroke="${m.color}" stroke-width="${m.w}" ${m.dash ? 'stroke-dasharray="3 2"' : ''}/>`;
    s += `<text x="${L0 + 26}" y="${y}">${m.label}: <tspan font-weight="600">${a.system === 'coast' ? '+' : ''}${fmt(m.v)} m</tspan></text>`;
  });
  el.innerHTML = s + '</svg>';
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------------------
// Water level explorer: a locked, clipped view around one location, rendered
// once per location and recoloured instantly for every 0.1 m step.
const PLAY = () => t('ex.play'), PAUSE = () => t('ex.pause');
const START_ZOOM = 16, ZOOM_OUT_STEPS = 2;           // start at street level; 2 zoom steps out allowed
const EX = { on: false, overlay: null, grid: null, pix: null, canvas: null, sys: 'coast', level: 10, timer: null, hist: null, half: 1000 };
const DEPTH = [ // water depth (m) -> colour, sequential blue light -> dark
  [0.25, '#9ec5f4'], [0.5, '#6da7ec'], [1.0, '#3987e5'], [2.0, '#256abf'], [Infinity, '#184f95'],
];
const DEPTH_RGB = DEPTH.map(([t, h]) => [t, [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))]);
function drawDepthLegend() {
  const d = x => (x).toLocaleString(LANG === 'sv' ? 'sv-SE' : 'en-GB');
  $('#exLegend').innerHTML = `<span>${t('ex.depth')}</span>` + DEPTH.map(([lim, h], i) =>
    `<span><i style="background:${h}"></i>${i === 0 ? '< ' + d(0.25) : i === DEPTH.length - 1 ? '> 2' : `${d(DEPTH[i - 1][0])}–${d(lim)}`} m</span>`).join('');
}
drawDepthLegend();

// Load a rectangular block of 5 m cells covering SWEREF extent [E0,E1]x[N0,N1].
async function loadBlock(E0, N0, E1, N1) {
  const cell = META.cell, T = META.tile;
  const [c0, r0] = cellOf(E0, N1, cell), [c1, r1] = cellOf(E1, N0, cell);
  const w = c1 - c0 + 1, h = r1 - r0 + 1, data = new Uint8Array(w * h).fill(NONE);
  const jobs = [];
  for (let ty = Math.floor(r0 / T); ty <= Math.floor(r1 / T); ty++)
    for (let tx = Math.floor(c0 / T); tx <= Math.floor(c1 / T); tx++)
      jobs.push(getTile('t', tx, ty).then(t => {
        const ra = Math.max(r0, ty * T), rb = Math.min(r1, ty * T + T - 1);
        const ca = Math.max(c0, tx * T), cb = Math.min(c1, tx * T + T - 1);
        for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++)
          data[(r - r0) * w + (c - c0)] = typeof t === 'number' ? t : t[(r - ty * T) * T + (c - tx * T)];
      }));
  await Promise.all(jobs);
  return { c0, r0, w, h, data };
}

async function openExplorer(res) {
  closeExplorer(false);
  const { lat, lon } = res;
  // The box is exactly what the map shows when zoomed out ZOOM_OUT_STEPS from the start view, so the
  // user can zoom out that far without ever seeing the edge of the flood layer.
  const zMin = START_ZOOM - ZOOM_OUT_STEPS, size = map.getSize(), p = map.project([lat, lon], zMin);
  const nw = map.unproject(p.subtract(size.divideBy(2)), zMin), se = map.unproject(p.add(size.divideBy(2)), zMin);
  const north = nw.lat, south = se.lat, west = nw.lng, east = se.lng;
  const bounds = L.latLngBounds([south, west], [north, east]);
  // SWEREF extent of the four corners (the grid is slightly rotated relative to lat/lon)
  const cs = [[south, west], [south, east], [north, west], [north, east]].map(([a, b]) => TM(a, b));
  const Es = cs.map(c => c[0]), Ns = cs.map(c => c[1]);
  $('#explore').hidden = false; document.body.classList.add('exploring');
  $('#exArea').textContent = t('ex.loading');
  const m = 2 * META.cell;                              // two-cell margin for the 4 × 4 smoothing kernel
  const g = await loadBlock(Math.min(...Es) - m, Math.min(...Ns) - m, Math.max(...Es) + m, Math.max(...Ns) + m);
  EX.grid = g;

  // Which water body governs this area?

  // Pixel raster in Web Mercator, about 2.5 m per pixel (at most 1600 px wide), sampling the SWEREF cells.
  const widthM = (east - west) * 111320 * Math.cos(lat * Math.PI / 180), heightM = (north - south) * 111320;
  const S = Math.min(1600, Math.max(600, widthM / 2.5)) / ((east - west) / 360);   // world size in px
  const mx = l => (l + 180) / 360 * S;
  const my = a => (1 - Math.log(Math.tan(a * Math.PI / 180) + 1 / Math.cos(a * Math.PI / 180)) / Math.PI) / 2 * S;
  const x0 = mx(west), x1 = mx(east), y0 = my(north), y1 = my(south);
  const W = Math.round(x1 - x0), H = Math.round(y1 - y0);
  const pix = new Uint8Array(W * H).fill(NONE);        // nearest cell (for area statistics)
  const org = new Int32Array(W * H).fill(-1);          // index in g.data of the kernel's top-left cell
  const wa = new Uint8Array(W * H), wb = new Uint8Array(W * H);      // fractional position (0-255)
  const cellAt = (c, r) => (c >= 0 && r >= 0 && c < g.w && r < g.h) ? g.data[r * g.w + c] : NONE;
  for (let j = 0; j < H; j++) {
    const la = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y0 + j + .5) / S))) * 180 / Math.PI;
    for (let i = 0; i < W; i++) {
      const lo = (x0 + i + .5) / S * 360 - 180;
      const [E, N] = TM(la, lo);
      const fx = (E - META.x0) / META.cell - 0.5 - g.c0, fy = (META.y0 - N) / META.cell - 0.5 - g.r0;
      const c = Math.floor(fx), r = Math.floor(fy), a = fx - c, b = fy - r, p = j * W + i;
      if (c >= 1 && r >= 1 && c + 2 < g.w && r + 2 < g.h) org[p] = (r - 1) * g.w + (c - 1);
      wa[p] = Math.round(a * 255); wb[p] = Math.round(b * 255);
      pix[p] = cellAt(c + (a >= .5 ? 1 : 0), r + (b >= .5 ? 1 : 0));
    }
  }
  EX.org = org; EX.wa = wa; EX.wb = wb; EX.gw = g.w; EX.gdata = g.data;
  EX.pix = pix;
  let nC = 0, nV = 0;
  const hist = new Float64Array(121);
  for (const v of pix) { if (isCoast(v)) { nC++; hist[v]++; } else if (isVanern(v)) { nV++; hist[v]++; } }
  EX.sys = nV > nC ? 'vanern' : 'coast';
  EX.canvas = document.createElement('canvas'); EX.canvas.width = W; EX.canvas.height = H;
  EX.bounds = bounds;
  EX.res = res;
  EX.boxArea = widthM * heightM; EX.zMin = zMin;
  EX.cellArea = EX.boxArea / (W * H);   // m² per pixel
  // cumulative flooded land area per level (sea / lake itself excluded)
  const steps = EX.sys === 'coast' ? 50 : 20, base = EX.sys === 'coast' ? 0 : 100;
  EX.curve = [];
  let acc = 0;
  for (let k = 1; k <= steps; k++) { if (!(EX.sys === 'coast' && k === 1)) acc += hist[base + k]; EX.curve.push(acc / (W * H) * 100); }

  // slider setup
  const sl = $('#exSlider');
  sl.min = EX.sys === 'coast' ? 2 : 1; sl.max = steps;
  EX.addrLevel = EX.sys === 'coast' ? (isCoast(res.v) ? Math.max(2, res.v) : null) : (isVanern(res.v) ? res.v - 100 : null);
  EX.level = +sl.min; sl.value = sl.min;
  $('#exPlay').classList.add('pulse');
  $('#exNote').innerHTML = t(EX.sys === 'coast' ? 'ex.note.coast' : 'ex.note.van');

  // overlay + locked camera
  flood.remove();
  EX.overlay = L.imageOverlay(EX.canvas.toDataURL(), bounds, { pane: 'flood', className: 'ex-overlay', opacity: 1, interactive: false }).addTo(map);
  EX.on = true;
  lockView();
  paint();
}

function lockView() {
  if (!EX.on) return;
  map.setMinZoom(0);
  map.setMaxBounds(EX.bounds);
  map.options.maxBoundsViscosity = 1.0;
  map.setView([EX.res.lat, EX.res.lon], START_ZOOM, { animate: false });
  map.setMinZoom(Math.max(EX.zMin, map.getBoundsZoom(EX.bounds, true)));
}
map.on('resize', lockView);

function closeExplorer(restore = true) {
  clearInterval(EX.timer); EX.timer = null; $('#exPlay').innerHTML = PLAY();
  if (EX.overlay) { EX.overlay.remove(); EX.overlay = null; }
  EX.on = false;
  map.setMaxBounds(null); map.setMinZoom(0);
  if (restore) {
    $('#explore').hidden = true; document.body.classList.remove('exploring');
    if (!map.hasLayer(flood)) flood.addTo(map);
  }
}

function levelLabel(k) {
  return EX.sys === 'coast' ? `+${fmt(k / 10)} m` : `${fmt(VANERN_CLASSES[k - 1][1])} m`;
}
function levelValue(k) { return EX.sys === 'coast' ? k / 10 : VANERN_CLASSES[k - 1][1]; }

function paint() {
  if (!EX.pix) return;
  const k = EX.level, ctx = EX.canvas.getContext('2d');
  const W = EX.canvas.width, H = EX.canvas.height, img = ctx.createImageData(W, H), px = img.data, P = EX.pix;
  const coast = EX.sys === 'coast', lvl = levelValue(k), base = coast ? 0 : 100;
  const ORG = EX.org, WA = EX.wa, WB = EX.wb, GW = EX.gw, GD = EX.gdata, A = Math.round(255 * Math.max(state.opacity, 0.5));
  const keyOf = new Uint8Array(256);
  for (let v = base + (coast ? 2 : 1); v <= base + k; v++) keyOf[v] = LUT[v] ? v : 0;
  const DEPTH_OF = new Float32Array(256);
  for (let v = 1; v <= 120; v++) if (keyOf[v]) DEPTH_OF[v] = coast ? (k - v) / 10 + 0.05 : lvl - (VANERN_CLASSES[v - 101][0] ?? VANERN_CLASSES[v - 101][1] - 0.1);
  const single = state.style === 'single';
  for (let i = 0; i < P.length; i++) {
    const o0 = ORG[i]; if (o0 < 0) continue;
    let anyK = 0;
    for (let jj = 0; jj < 4; jj++) { const row = o0 + jj * GW; for (let ii = 0; ii < 4; ii++) anyK |= (KS[jj * 4 + ii] = keyOf[GD[row + ii]]); }
    if (!anyK) continue;
    bspline(WA[i] / 255, WX); bspline(WB[i] / 255, WY);
    const [key, f] = blend16();
    if (!key) continue;
    let col = FLOOD_RGB;
    if (!single) { const depth = DEPTH_OF[key]; col = DEPTH_RGB[DEPTH_RGB.length - 1][1]; for (const [t, c] of DEPTH_RGB) if (depth <= t) { col = c; break; } }
    const o = i * 4; px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = A * f;
  }
  ctx.putImageData(img, 0, 0);
  EX.overlay.setUrl(EX.canvas.toDataURL());
  const pct = EX.curve[k - 1];
  $('#exLevel').textContent = levelLabel(k);
  $('#exArea').textContent = t('ex.area', { p: pct < 1 && pct > 0 ? t('ex.areaSmall') : Math.round(pct) });
  const wet = EX.addrLevel != null && k >= EX.addrLevel;
  const st = $('#exStatus');
  st.className = 'ex-status ' + (wet ? 'wet' : 'dry');
  st.textContent = EX.addrLevel == null ? t('ex.never')
    : t(wet ? 'ex.wet' : 'ex.dry', { l: levelLabel(EX.addrLevel) });
  const pin = marker && marker.getElement && marker.getElement();
  if (pin) pin.firstElementChild?.classList.toggle('wet', wet);
  drawCurve();
  if (lastResult) drawLadder(lastResult);
}

// Cumulative flooded area vs water level (single series; the title names it).
function drawCurve(hoverK) {
  const W = 340, H = 150, L0 = 34, R0 = W - 6, T0 = 18, B0 = H - 22;
  const n = EX.curve.length, kMin = EX.sys === 'coast' ? 2 : 1;
  const maxA = Math.max(...EX.curve, 0.01);
  const X = k => L0 + (k - kMin) / (n - kMin) * (R0 - L0), Y = a => B0 - a / maxA * (B0 - T0);
  let d = `M${X(kMin)},${Y(0)}`;
  for (let k = kMin; k <= n; k++) d += ` L${X(k)},${Y(EX.curve[k - 1])}`;
  const area = d + ` L${X(n)},${Y(0)} Z`;
  const nice = (() => { const s = maxA / 3, p = 10 ** Math.floor(Math.log10(s)), m = s / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : 5) * p; })();
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('ex.chart.aria')}">`;
  s += `<text x="0" y="10" style="fill:var(--text-2);font-weight:600">${t('ex.chart.title')}</text>`;
  for (let v = 0; v <= maxA + 1e-9; v += nice) s += `<line class="grid" x1="${L0}" x2="${R0}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L0 - 4}" y="${Y(v) + 3}" text-anchor="end">${pctText(fmtN(v))}</text>`;
  const ticks = EX.sys === 'coast' ? [2, 10, 20, 30, 40, 50] : [1, 5, 10, 15, 20];
  for (const t of ticks) s += `<text x="${X(t)}" y="${H - 6}" text-anchor="middle">${levelLabel(t).replace(' m', '')}</text>`;
  s += `<path d="${area}" fill="var(--flood)" opacity=".18"/><path d="${d}" fill="none" stroke="var(--flood)" stroke-width="2" stroke-linejoin="round"/>`;
  const k = EX.level;
  s += `<line x1="${X(k)}" x2="${X(k)}" y1="${T0 - 4}" y2="${B0}" stroke="var(--text)" stroke-width="1.5"/>`;
  s += `<circle cx="${X(k)}" cy="${Y(EX.curve[k - 1])}" r="4" fill="var(--flood)" stroke="var(--surface)" stroke-width="2"/>`;
  const a = EX.res && EX.res.a;
  if (EX.addrLevel != null) {
    const tk = EX.addrLevel;
    if (tk && tk >= kMin) s += `<line x1="${X(tk)}" x2="${X(tk)}" y1="${T0}" y2="${B0}" stroke="var(--r-critical)" stroke-width="1.5" stroke-dasharray="3 2"/><text x="${X(tk) + (X(tk) > W * .6 ? -4 : 4)}" y="${T0 + 8}" text-anchor="${X(tk) > W * .6 ? 'end' : 'start'}" style="fill:var(--r-critical)">${t('ex.chart.addr')}</text>`;
  }
  if (hoverK) s += `<line x1="${X(hoverK)}" x2="${X(hoverK)}" y1="${T0}" y2="${B0}" stroke="var(--muted)" stroke-dasharray="2 2"/><text x="${X(hoverK) + (X(hoverK) > W * .6 ? -4 : 4)}" y="${B0 - 4}" text-anchor="${X(hoverK) > W * .6 ? 'end' : 'start'}" style="fill:var(--text)">${levelLabel(hoverK)}: ${pctText(fmtN(EX.curve[hoverK - 1]))}</text>`;
  s += `<rect x="${L0}" y="${T0}" width="${R0 - L0}" height="${B0 - T0}" fill="transparent" id="exHit"/></svg>`;
  const el = $('#exChart'); el.innerHTML = s;
  const svg = el.querySelector('svg');
  const kAt = e => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W; return Math.min(n, Math.max(kMin, Math.round(kMin + (x - L0) / (R0 - L0) * (n - kMin)))); };
  svg.onmousemove = e => drawCurve(kAt(e));
  svg.onmouseleave = () => drawCurve();
  svg.onclick = e => setLevel(kAt(e));
}

function setLevel(k) {
  const sl = $('#exSlider');
  EX.level = Math.min(+sl.max, Math.max(+sl.min, k)); sl.value = EX.level; paint();
}
$('#exSlider').addEventListener('input', e => setLevel(+e.target.value));
$('#exUp').onclick = () => setLevel(EX.level + 1);
$('#exDown').onclick = () => setLevel(EX.level - 1);
$('#exPlay').onclick = () => {
  $('#exPlay').classList.remove('pulse');
  if (EX.timer) { clearInterval(EX.timer); EX.timer = null; $('#exPlay').innerHTML = PLAY(); return; }
  if (EX.level >= +$('#exSlider').max) setLevel(+$('#exSlider').min);
  $('#exPlay').innerHTML = PAUSE();
  EX.timer = setInterval(() => {
    if (EX.level >= +$('#exSlider').max) { clearInterval(EX.timer); EX.timer = null; $('#exPlay').innerHTML = PLAY(); return; }
    setLevel(EX.level + 1);
  }, 180);
};

// ---------------------------------------------------------------------------
// Geocoding (Nominatim; one request per explicit search or click, per its usage policy)
const NOM = 'https://nominatim.openstreetmap.org';
$('#search').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#q').value.trim(); if (!q) return;
  const ul = $('#suggestions'); ul.hidden = false; ul.innerHTML = `<li class="loading">${t('search.searching')}</li>`;
  try {
    const r = await fetch(`${NOM}/search?format=jsonv2&countrycodes=se&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': LANG === 'sv' ? 'sv,en' : 'en,sv' } });
    const js = await r.json();
    if (!js.length) { ul.innerHTML = `<li class="loading">${t('search.none')}</li>`; return; }
    if (js.length === 1) { ul.hidden = true; pick(js[0]); return; }
    ul.innerHTML = '';
    js.forEach(p => {
      const li = document.createElement('li'); li.setAttribute('role', 'option');
      const [first, second] = niceName(p);
      li.innerHTML = `${esc(first)}<small>${esc(second)}</small>`;
      li.onclick = () => { ul.hidden = true; pick(p); };
      ul.appendChild(li);
    });
  } catch { ul.innerHTML = `<li class="loading">${t('search.error')}</li>`; }
});
// "Storgatan 5" + "Skanör, Vellinge" from Nominatim address parts (falls back to display_name).
function niceName(p) {
  const a = p.address || {};
  const street = [a.road || a.pedestrian || a.footway || a.path, a.house_number].filter(Boolean).join(' ');
  const place = a.city || a.town || a.village || a.hamlet || a.suburb || a.municipality;
  const first = street || p.name || p.display_name.split(', ')[0];
  const second = [place, a.municipality && a.municipality !== place ? a.municipality : null].filter(Boolean).join(', ');
  return [first, second || p.display_name.split(', ').slice(1, 3).join(', ')];
}
function pick(p) {
  const lat = +p.lat, lon = +p.lon;
  leaveLanding();
  closeExplorer(false);
  map.setView([lat, lon], 16);
  assess(lat, lon, niceName(p).filter(Boolean).join(', '));
}
// ---------------------------------------------------------------------------
// Apply the chosen language to the fixed page texts, then redraw everything that holds text.
function applyStatic() {
  document.documentElement.lang = LANG;
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]').content = t('meta.description');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === LANG));
  $('#exPlay').innerHTML = EX.timer ? PAUSE() : PLAY();
  $('#opOut').textContent = pctText(Math.round(state.opacity * 100));
}
function setLang(lang) {
  if (!I18N[lang] || lang === LANG) return;
  LANG = lang;
  try { localStorage.setItem('kk-lang', lang); } catch { /* not remembered, that's fine */ }
  applyStatic();
  buildLayerControl();
  drawDepthLegend();
  for (const g of Object.values(GROUPS)) document.querySelectorAll(`${g.chips} .chip`).forEach(ch => {
    const v = +ch.dataset.v; ch.textContent = g.label(v); ch.title = g.title(v);
  });
  if (META) layersChanged();
  if (lastResult) render(lastResult);
  if (EX.on) { $('#exNote').innerHTML = t(EX.sys === 'coast' ? 'ex.note.coast' : 'ex.note.van'); paint(); }
}
document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
applyStatic();

// ---------------------------------------------------------------------------
// Landing: the site opens with only an address box over a blurred map. The map can't be browsed
// freely; after a search it is locked to the box around that address, and the only way to look
// somewhere else is to search for a new address.
const MAP_HANDLERS = ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'];
function enterLanding() {
  document.body.classList.add('landing');
  $('#landingSearch').append($('#search'), $('#suggestions'));
  MAP_HANDLERS.forEach(h => map[h] && map[h].disable());
  map.invalidateSize({ pan: false });                  // the map now fills the whole window
  map.setView([62.0, 16.5], window.innerWidth < 800 ? 4 : 5, { animate: false });
  setTimeout(() => $('#q').focus(), 50);
}
function leaveLanding() {
  if (!document.body.classList.contains('landing')) return;
  document.body.classList.remove('landing');
  $('#panelSearch').append($('#search'), $('#suggestions'));
  MAP_HANDLERS.forEach(h => map[h] && map[h].enable());
  map.invalidateSize({ pan: false });                  // the sidebar appeared: the map got narrower
}
enterLanding();

// ---------------------------------------------------------------------------
// Boot
fetch('data/meta.json').then(r => r.json()).then(m => {
  META = m;
  buildChips();
  // Every visit starts at the address box, even from an old link with coordinates in it.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}).catch(() => {
  const msg = `<p style="color:var(--r-critical)">${t('error.data')}</p>`;
  $('#intro').insertAdjacentHTML('afterbegin', msg); $('#landNote').insertAdjacentHTML('beforebegin', msg);
});
window.FloodCheck = { flood: () => flood, assess, TM, valueAt, state };
})();
