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
const map = L.map('map', { zoomControl: false, preferCanvas: true, attributionControl: true }).setView([62.0, 16.5], 5);
L.control.zoom({ position: 'topleft' }).addTo(map);
L.control.scale({ imperial: false, position: 'topleft' }).addTo(map);
const base = {
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
};
base.osm.addTo(map);
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution('Översvämningsdata © MSB');
// Flood layers get their own pane above the basemap, so switching basemap never hides them.
map.createPane('flood');
map.getPane('flood').style.zIndex = 450;
map.getPane('flood').style.pointerEvents = 'none';

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
  if (wv <= 0.4) return BL_NONE;
  let acc = 0, key = SK16[n - 1];
  for (let i = 0; i < n; i++) { acc += SW16[i]; if (acc >= wv / 2) { key = SK16[i]; break; } }
  const t = Math.min(1, (wv - 0.4) / 0.2);             // narrow soft edge (40–60 % coverage): crisp, not jagged
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
const FLOOD_RGB = [31, 111, 168];
const flood = new FloodLayer({ pane: 'flood', minZoom: 7, maxNativeZoom: 19, opacity: 1, updateWhenZooming: false, keepBuffer: 1 });

// ---------------------------------------------------------------------------
// UI
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtN = x => (Math.round(x * 10) / 10).toLocaleString(LANG === 'sv' ? 'sv-SE' : 'en-GB');
const pctText = p => LANG === 'sv' ? `${p} %` : `${p}%`;
function share(arr, pred) { const m = arr.length ? arr.filter(pred).length / arr.length : 0; return pctText(Math.round(m * 100)); }

// ---- Flood layer picker (settings drawer) ------------------------------------------
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
  layerTimer = setTimeout(() => { if (EX.on) paint(); }, 60);
}
function buildChips() {
  for (const [sys, g] of Object.entries(GROUPS)) {
    const box = $(g.chips);
    for (let v = g.lo; v <= g.hi; v++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.v = v; b.textContent = g.label(v); b.title = g.title(v);
      const c = LAYER_RGB[v], lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
      b.style.setProperty('--c', hex(c)); b.style.setProperty('--ink2c', lum > 0.55 ? '#0f2b3a' : '#ffffff');
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
  state.style = b.dataset.style; if (EX.on) paint();
});
$('#opacity').oninput = e => {
  state.opacity = e.target.value / 100; $('#opOut').textContent = pctText(e.target.value);
  clearTimeout(layerTimer); layerTimer = setTimeout(() => { if (EX.on) paint(); }, 60);
};
// The aerial photos stop at zoom 18 (the 30 m scale) in much of Sweden: cap the map there while they
// are shown. Leaflet zooms out by itself if the map is closer in when the cap is set.
const BASE_MAX = { osm: 19, sat: 18 };
document.querySelectorAll('input[name="base"]').forEach(r => r.onchange = () => {
  Object.values(base).forEach(l => map.removeLayer(l));
  base[r.value].addTo(map);
  map.setMaxZoom(BASE_MAX[r.value] || 19);
});

// ---------------------------------------------------------------------------
// Looking up an address
let marker = null, lastResult = null;
const HOUSE_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path class="body" d="M7.5 15.5V27h17V15.5"/><path class="roof" d="M3.2 16.6 16 4.8l12.8 11.8-2.1 2.2L16 9 5.3 18.8z"/><rect class="roof" x="13.6" y="19.5" width="4.8" height="7.5" rx=".6"/></svg>';

async function assess(lat, lon, label) {
  const [E, N] = TM(lat, lon);
  if (marker) marker.remove();
  map.closePopup();
  marker = L.marker([lat, lon], {
    icon: L.divIcon({ className: '', html: `<div class="house" tabindex="0">${HOUSE_SVG}</div>`, iconSize: [40, 40], iconAnchor: [20, 34] }),
    keyboard: true, riseOnHover: true, draggable: true, autoPan: false,
  }).addTo(map);
  marker.on('click', () => onHouseClick());
  marker.on('dragstart', () => { stopPlay(); map.closePopup(); hideCallout(); marker.getElement()?.classList.add('dragging'); });
  marker.on('drag', () => clampHouse());
  marker.on('dragend', () => { marker.getElement()?.classList.remove('dragging'); moveHouse(marker.getLatLng()); });
  syncHouseDrag();
  lastResult = { lat, lon, label };
  showCallout(`<p class="c-addr">${esc(label)}</p><p class="c-loading">${t('result.checking')}</p>`, 'loading');
  const res = await evaluate(lat, lon, label);
  res.origin = { lat, lon };
  lastResult = res;
  await openExplorer(res);
}
// Everything the answer needs for one point: its own cell, the plot around it, and the assessment.
async function evaluate(lat, lon, label) {
  const [E, N] = TM(lat, lon);
  const [val, near25, near100] = await Promise.all([valueAt(E, N), cellsAround(E, N, 25), cellsAround(E, N, 100)]);
  const mapped = x => x !== NONE;
  const lowest = arr => arr.filter(mapped).reduce((m, x) => Math.min(m, x), NONE);
  const res = { lat, lon, E, N, label, v: val, low25: lowest(near25), low100: lowest(near100), near100 };
  // Report on the point itself, or on the plot around it if the point is dry.
  const sys = mapped(val) ? val : res.low25 !== NONE ? res.low25 : res.low100;
  res.a = sys === NONE ? null : isVanern(sys) ? assessVanern(sys, lat, lon) : assessCoast(sys, lat, lon);
  res.pointDry = !mapped(val);
  res.riskKey = !res.a ? 'vlow' : res.pointDry ? { vhigh: 'high', high: 'moderate', moderate: 'low', low: 'low' }[res.a.risk] : res.a.risk;
  return res;
}

// ---- Moving the house: geocoding sometimes lands on the street, so the user may drag the house
// (up to MOVE_MAX metres from the found address) onto the right building. The answer follows.
const MOVE_MAX = 150;
function syncHouseDrag() {
  if (!marker || !marker.dragging) return;
  if (EX.on && !EX.story && !EX.away) marker.dragging.enable(); else marker.dragging.disable();
}
function clampLL(ll) {
  const o = lastResult && lastResult.origin; if (!o) return ll;
  const d = map.distance([o.lat, o.lon], ll);
  if (d <= MOVE_MAX) return ll;
  const f = MOVE_MAX / d, lat = ll.lat ?? ll[0], lng = ll.lng ?? ll[1];
  return L.latLng(o.lat + (lat - o.lat) * f, o.lon + (lng - o.lon) * f);
}
function clampHouse() { const ll = marker.getLatLng(), c = clampLL(ll); if (c !== ll) marker.setLatLng(c); }
async function moveHouse(ll) {
  if (!EX.on || !lastResult) return;
  ll = clampLL(ll); marker.setLatLng(ll);
  const lat = ll.lat, lon = ll.lng, origin = lastResult.origin;
  const token = (moveHouse.token = (moveHouse.token || 0) + 1);
  const res = await evaluate(lat, lon, lastResult.label);
  if (token !== moveHouse.token || !EX.on) return;
  res.origin = origin;
  res.moved = map.distance([origin.lat, origin.lon], [lat, lon]) > 2;
  lastResult = res; EX.res = res;
  EX.addrLevel = EX.sys === 'coast' ? (isCoast(res.v) ? Math.max(2, res.v) : null) : (isVanern(res.v) ? res.v - 100 : null);
  placeStation();
  buildGauge(); paint();
  renderVerdict(true);
  if (drawerOpen === 'details') renderDetails();
}

// ---- The verdict card: one answer, then one line that follows the gauge ----------------
const RISK_COLOR = { vhigh: 'var(--r-vhigh)', high: 'var(--r-high)', moderate: 'var(--r-moderate)', low: 'var(--r-low)', vlow: 'var(--r-vlow)' };
function headline(res) {
  const a = res.a;
  if (!a) return t('result.none.head');
  if (a.system === 'coast') {
    if (a.h <= 0.1) return t('result.atSea');
    return t(res.pointDry ? 'verdict.coast.dryHead' : 'result.coast.head', { h: fmt(a.h) });
  }
  return t(res.pointDry ? 'verdict.van.dryHead' : 'result.van.head', { h: fmt(a.hi) });
}
// The record storm at the nearest SMHI station, as one clickable row in the answer box.
function recordRow() {
  const st = stationInfo; if (!st || EX.sys !== 'coast') return '';
  const p = map.latLngToContainerPoint([st.lat, st.lon]), house = map.latLngToContainerPoint([EX.res.lat, EX.res.lon]);
  const km = map.distance([EX.res.lat, EX.res.lon], [st.lat, st.lon]) / 1000;
  const ang = Math.atan2(p.y - house.y, p.x - house.x) * 180 / Math.PI;
  const kmTxt = km < 1 ? fmt(Math.max(0.1, Math.round(km * 10) / 10)) : Math.round(km);
  return `<button type="button" class="c-rec" id="actRec" title="${esc(t('st.goTo'))}">
    <span class="c-rec-text"><span class="c-rec-label">${t('st.edgeRec')}</span><span class="c-rec-label short">${t('st.edgeShort')}</span>
      <span class="c-rec-line"><b class="c-rec-level">+${fmt(st.max / 100)} m</b>
      <span class="c-rec-where">${esc(t('st.edgeWhere', { st: st.name, km: kmTxt }))}</span></span></span>
    <span class="arrow" style="transform:rotate(${ang}deg)"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5"/></svg></span>
  </button>`;
}
function renderVerdict(animate) {
  const res = lastResult; if (!res || !res.riskKey) return;
  showCallout(`<button type="button" class="c-close" id="cClose" aria-label="${t('drawer.close')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <p class="c-addr">${esc(res.label)}${res.moved ? ` · <span class="c-moved">${t('house.moved')}</span>` : ''}</p>
    <p class="c-risk"><i></i>${t('risk.label.' + res.riskKey)}</p>
    <h1 class="c-head">${headline(res)}</h1>
    <p class="c-now" id="vNow"></p>
    ${recordRow()}
    <div class="c-actions">
      <button type="button" class="link-btn" id="actWhy" aria-controls="drawer">${t('act.why')}</button>
      ${EX.addrLevel != null ? `<button type="button" class="link-btn" id="actShow">${t('act.show')}</button>` : ''}
    </div>
    ${res.moved ? `<p class="c-hint"><button type="button" class="link-btn" id="actReset">${t('house.reset')}</button></p>`
      : `<p class="c-hint"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>${t('house.hint')}</p>`}`, 'verdict', animate ? '' : 'still');
  syncHouseDrag();
  callout.style.setProperty('--risk', RISK_COLOR[res.riskKey]);
  $('#cClose').onclick = () => hideCallout();
  $('#actWhy').onclick = () => toggleDrawer('details');
  if ($('#actShow')) $('#actShow').onclick = () => { stopPlay(); setLevel(EX.addrLevel); };
  if ($('#actRec')) $('#actRec').onclick = () => goToStation(stationInfo);
  if ($('#actReset')) $('#actReset').onclick = () => { const o = res.origin; moveHouse(L.latLng(o.lat, o.lon)); };
  updateNow();
  placeCallout();
}
function updateNow() {
  const el = $('#vNow'); if (!el || !EX.on) return;
  const k = EX.level, l = levelLabel(k), A = EX.addrLevel;
  let html, wet = false;
  if (A == null) html = t('now.never', { l });
  else if (k < A) html = t('now.dry', { l });
  else if (k === A) { html = t('now.just', { l }); wet = true; }
  else { html = t('now.wet', { l, d: fmt(levelValue(k) - levelValue(A)) }); wet = true; }
  el.innerHTML = html; el.classList.toggle('wet', wet);
  marker?.getElement()?.firstElementChild?.classList.toggle('wet', wet);
}

// ---- The details drawer --------------------------------------------------------------
function renderDetails() {
  const res = lastResult; if (!res) return;
  const a = res.a;
  let html = '';
  if (!a) {
    html += `<p>${t('result.none.text')}</p><h3>${t('det.good')}</h3><p class="fine">${t('result.none.ctx')}</p>`;
  } else {
    html += `<p>${a.text()}</p><h3>${t('det.around')}</h3>`;
    if (a.system === 'coast') {
      const n = res.near100;
      html += `<div class="stats">
        <div class="stat"><b>${share(n, x => isCoast(x) && x > 1 && x <= 10)}</b><span>${t('stat.coast1')}</span></div>
        <div class="stat"><b>${share(n, x => isCoast(x) && x > 1 && x <= 20)}</b><span>${t('stat.coast2')}</span></div>
        <div class="stat"><b>${share(n, x => isCoast(x) && x > 1 && x <= 30)}</b><span>${t('stat.coast3')}</span></div></div>`;
    } else {
      const m = a.muni;
      html += `<div class="stats">
        <div class="stat"><b>${fmt(m.y100)} m</b><span>${t('stat.van100', { muni: m.name })}</span></div>
        <div class="stat"><b>${fmt(m.y200)} m</b><span>${t('stat.van200')}</span></div>
        <div class="stat"><b>${fmt(m.max)} m</b><span>${t('stat.vanMax')}</span></div></div>`;
    }
    html += `<h3>${t('det.area')}</h3><div class="chart" id="chartArea"></div>`;
    html += `<h3>${t('det.good')}</h3><p class="fine">${t(a.system === 'coast' ? 'ctx.coast' : 'ctx.van')}</p>`;
  }
  html += `<p class="coords">${t('coords', { lat: res.lat.toFixed(5), lon: res.lon.toFixed(5), n: Math.round(res.N), e: Math.round(res.E) })}</p>`;
  $('#paneDetails').innerHTML = html;
  drawCurve();
}

let drawerOpen = null;
const DRAWERS = { details: ['#paneDetails', 'drawer.details', '#actWhy'], about: ['#paneAbout', 'drawer.about', '#btnAbout'], settings: ['#paneSettings', 'drawer.settings', '#btnSettings'] };
function toggleDrawer(which) {
  if (drawerOpen === which || !which) {
    $('#drawer').hidden = true; drawerOpen = null;
  } else {
    drawerOpen = which;
    for (const [k, [pane]] of Object.entries(DRAWERS)) $(pane).hidden = k !== which;
    $('#drawerTitle').textContent = t(DRAWERS[which][1]);
    $('#drawer').hidden = false;
    if (which === 'details') { renderDetails(); }
    $('#drawerClose').focus({ preventScroll: true });
  }
  for (const [k, [, , btn]] of Object.entries(DRAWERS)) $(btn)?.setAttribute('aria-expanded', drawerOpen === k);
}
$('#btnAbout').onclick = () => toggleDrawer('about');
$('#btnSettings').onclick = () => toggleDrawer('settings');
$('#drawerClose').onclick = () => toggleDrawer(null);
addEventListener('keydown', e => { if (e.key === 'Escape' && drawerOpen) toggleDrawer(null); });

// ---------------------------------------------------------------------------
// The flood around the address: a locked, clipped view rendered once per address and
// recoloured instantly for every 0.1 m step of the gauge.
const START_ZOOM = 16, ZOOM_OUT_STEPS = 2;           // start at street level; 2 zoom steps out allowed
const EX = { on: false, overlay: null, pix: null, canvas: null, sys: 'coast', level: 2, timer: null, addrLevel: null };
const DEPTH = [ // water depth (m) -> colour, light (shallow) to dark (deep)
  [0.25, '#bfe0f2'], [0.5, '#8cc3e6'], [1.0, '#4f9bd0'], [2.0, '#1f6fa8'], [Infinity, '#123e63'],
];
const DEPTH_RGB = DEPTH.map(([lim, h]) => [lim, [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))]);
function drawDepthKey() {
  $('#depthKey').innerHTML = `<span>${t('depth.key')}:</span><span>${t('depth.shallow')}</span>
    <span class="swatches">${DEPTH.map(([, h]) => `<span style="background:${h}"></span>`).join('')}</span><span>${t('depth.deep')}</span>`;
}

// Load a rectangular block of 5 m cells covering SWEREF extent [E0,E1]x[N0,N1].
async function loadBlock(E0, N0, E1, N1) {
  const cell = META.cell, T = META.tile;
  const [c0, r0] = cellOf(E0, N1, cell), [c1, r1] = cellOf(E1, N0, cell);
  const w = c1 - c0 + 1, h = r1 - r0 + 1, data = new Uint8Array(w * h).fill(NONE);
  const jobs = [];
  for (let ty = Math.floor(r0 / T); ty <= Math.floor(r1 / T); ty++)
    for (let tx = Math.floor(c0 / T); tx <= Math.floor(c1 / T); tx++)
      jobs.push(getTile('t', tx, ty).then(tile => {
        const ra = Math.max(r0, ty * T), rb = Math.min(r1, ty * T + T - 1);
        const ca = Math.max(c0, tx * T), cb = Math.min(c1, tx * T + T - 1);
        for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++)
          data[(r - r0) * w + (c - c0)] = typeof tile === 'number' ? tile : tile[(r - ty * T) * T + (c - tx * T)];
      }));
  await Promise.all(jobs);
  return { c0, r0, w, h, data };
}

async function openExplorer(res) {
  closeExplorer();
  const { lat, lon } = res;
  // The box is exactly what the map shows when zoomed out ZOOM_OUT_STEPS from the start view, so the
  // user can zoom out that far without ever seeing the edge of the flood layer.
  map.invalidateSize({ pan: false });
  let size = map.getSize();
  if (size.x < 200 || size.y < 200) size = L.point(1280, 800);   // hidden window: assume a normal screen
  const zMin = START_ZOOM - ZOOM_OUT_STEPS, p = map.project([lat, lon], zMin);
  const nw = map.unproject(p.subtract(size.divideBy(2)), zMin), se = map.unproject(p.add(size.divideBy(2)), zMin);
  const north = nw.lat, south = se.lat, west = nw.lng, east = se.lng;
  const bounds = L.latLngBounds([south, west], [north, east]);
  const cs = [[south, west], [south, east], [north, west], [north, east]].map(([a, b]) => TM(a, b));
  const Es = cs.map(c => c[0]), Ns = cs.map(c => c[1]);
  const m = 2 * META.cell;                              // two-cell margin for the 4 × 4 smoothing kernel
  const g = await loadBlock(Math.min(...Es) - m, Math.min(...Ns) - m, Math.max(...Es) + m, Math.max(...Ns) + m);

  // Coarse raster over the whole box (one pixel ≈ one 5 m cell), only for the area statistics.
  const widthM = (east - west) * 111320 * Math.cos(lat * Math.PI / 180);
  const S = Math.min(900, Math.max(300, widthM / 5)) / ((east - west) / 360);
  const mx = l => (l + 180) / 360 * S;
  const my = a => (1 - Math.log(Math.tan(a * Math.PI / 180) + 1 / Math.cos(a * Math.PI / 180)) / Math.PI) / 2 * S;
  const x0 = mx(west), x1 = mx(east), y0 = my(north), y1 = my(south);
  const W = Math.round(x1 - x0), H = Math.round(y1 - y0);
  const pix = new Uint8Array(W * H).fill(NONE);
  for (let j = 0; j < H; j++) {
    const la = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y0 + j + .5) / S))) * 180 / Math.PI;
    for (let i = 0; i < W; i++) {
      const [E, N] = TM(la, (x0 + i + .5) / S * 360 - 180);
      const c = Math.floor((E - META.x0) / META.cell) - g.c0, r = Math.floor((META.y0 - N) / META.cell) - g.r0;
      if (c >= 0 && r >= 0 && c < g.w && r < g.h) pix[j * W + i] = g.data[r * g.w + c];
    }
  }
  Object.assign(EX, { gw: g.w, gh: g.h, gc0: g.c0, gr0: g.r0, gdata: g.data, pix, bounds, res, zMin });
  let nC = 0, nV = 0;
  const hist = new Float64Array(121);
  for (const v of pix) { if (isCoast(v)) { nC++; hist[v]++; } else if (isVanern(v)) { nV++; hist[v]++; } }
  EX.sys = res.a ? res.a.system : nV > nC ? 'vanern' : 'coast';
  const steps = EX.sys === 'coast' ? 50 : 20, baseV = EX.sys === 'coast' ? 0 : 100;
  EX.curve = [];
  let acc = 0;
  for (let k = 1; k <= steps; k++) { if (!(EX.sys === 'coast' && k === 1)) acc += hist[baseV + k]; EX.curve.push(acc / (W * H) * 100); }
  EX.kMin = EX.sys === 'coast' ? 2 : 1; EX.kMax = steps;
  EX.addrLevel = EX.sys === 'coast' ? (isCoast(res.v) ? Math.max(2, res.v) : null) : (isVanern(res.v) ? res.v - 100 : null);
  EX.level = EX.kMin;

  EX.on = true;
  lockView();
  EX.overlay = new FloodCanvas().addTo(map);           // drawn at screen resolution for the current view
  $('#gauge').hidden = false; $('#depthKey').hidden = false;
  EX.revealed = false; EX.shown = new Set();
  if (drawerOpen === 'details') renderDetails();
  placeStation();
  // The rising water is the content itself, so the story always plays (it can be skipped); with
  // reduced motion only the decorative pop and pulse effects are turned off, in CSS.
  runStory();
}

// The flood layer: one canvas covering the map view, re-sampled at screen resolution after every
// pan or zoom (the sampling is cached, so each 10 cm step only recolours it).
const FloodCanvas = L.Layer.extend({
  onAdd(m) {
    this._c = L.DomUtil.create('canvas', 'flood-canvas');
    m.getPane('flood').appendChild(this._c);
    m.on('moveend zoomend resize viewreset', this._reset, this);
    m.on('zoomstart', this._hide, this);
    this._reset();
  },
  onRemove(m) {
    this._c.remove(); EX.view = null;
    m.off('moveend zoomend resize viewreset', this._reset, this);
    m.off('zoomstart', this._hide, this);
  },
  _hide() { this._c.style.visibility = 'hidden'; },
  _reset() {
    const m = this._map; if (!m || !EX.gdata) return;
    const size = m.getSize(); if (!size.x || !size.y) return;
    const scale = 1;
    const W = size.x, H = size.y, c = this._c;
    c.width = W; c.height = H; c.style.width = W + 'px'; c.style.height = H + 'px';
    L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
    const z = m.getZoom(), world = 256 * 2 ** z, p0 = m.project(m.containerPointToLatLng([0, 0]), z);
    // Project a coarse grid of points (every 8 px) exactly, and interpolate in between: the projection
    // is smooth, so this is exact to well under a centimetre and many times faster.
    const STEP = 8, gw = Math.ceil(W / STEP) + 1, gh = Math.ceil(H / STEP) + 1;
    const GE = new Float64Array(gw * gh), GN = new Float64Array(gw * gh);
    for (let gj = 0; gj < gh; gj++) {
      const la = Math.atan(Math.sinh(Math.PI * (1 - 2 * (p0.y + gj * STEP) / world))) * 180 / Math.PI;
      for (let gi = 0; gi < gw; gi++) {
        const [E, N] = TM(la, (p0.x + gi * STEP) / world * 360 - 180);
        GE[gj * gw + gi] = E; GN[gj * gw + gi] = N;
      }
    }
    const org = new Int32Array(W * H).fill(-1), wa = new Uint8Array(W * H), wb = new Uint8Array(W * H);
    const GW = EX.gw, GH = EX.gh, C0 = EX.gc0, R0 = EX.gr0, cell = META.cell, X0 = META.x0, Y0 = META.y0;
    for (let j = 0; j < H; j++) {
      const gy = (j + .5) / STEP, gj = Math.min(gh - 2, Math.floor(gy)), ty = gy - gj;
      for (let i = 0; i < W; i++) {
        const gx = (i + .5) / STEP, gi = Math.min(gw - 2, Math.floor(gx)), tx = gx - gi;
        const k00 = gj * gw + gi, k01 = k00 + 1, k10 = k00 + gw, k11 = k10 + 1;
        const E = (GE[k00] * (1 - tx) + GE[k01] * tx) * (1 - ty) + (GE[k10] * (1 - tx) + GE[k11] * tx) * ty;
        const N = (GN[k00] * (1 - tx) + GN[k01] * tx) * (1 - ty) + (GN[k10] * (1 - tx) + GN[k11] * tx) * ty;
        const fx = (E - X0) / cell - 0.5 - C0, fy = (Y0 - N) / cell - 0.5 - R0;
        const cc = Math.floor(fx), rr = Math.floor(fy), q = j * W + i;
        if (cc >= 1 && rr >= 1 && cc + 2 < GW && rr + 2 < GH) org[q] = (rr - 1) * GW + (cc - 1);
        wa[q] = Math.round((fx - cc) * 255); wb[q] = Math.round((fy - rr) * 255);
      }
    }
    // Lowest flood value (land only) among each pixel's 4 × 4 cells, so dry pixels are skipped fast.
    const minK = new Uint8Array(W * H).fill(255), GD = EX.gdata;
    for (let q = 0; q < org.length; q++) {
      const o0 = org[q]; if (o0 < 0) continue;
      let mn = 255;
      for (let jj = 0; jj < 4; jj++) { const row = o0 + jj * GW; for (let ii = 0; ii < 4; ii++) { const v = GD[row + ii]; if (v > 1 && v < mn) mn = v; } }
      minK[q] = mn;
    }
    EX.view = { canvas: c, W, H, org, wa, wb, minK };
    paint();
    c.style.visibility = 'visible';
  },
});

// Where the house sits in the view: a bit left of centre (room for the gauge) and, on computers,
// a bit below centre so the answer box fits above it.
function houseOffset() { return innerWidth < 720 ? [36, 0] : [60, -Math.round(innerHeight * 0.15)]; }
function lockView() {
  if (!EX.on) return;
  map.setMinZoom(0);
  map.setMaxBounds(EX.bounds);
  map.options.maxBoundsViscosity = 1.0;
  map.setView([EX.res.lat, EX.res.lon], START_ZOOM, { animate: false });
  // keep the house clear of the gauge on the right: show it a little left of centre
  map.panBy(houseOffset(), { animate: false });
  map.setMinZoom(Math.max(EX.zMin, map.getBoundsZoom(EX.bounds, true)));
}
map.on('resize', () => { if (EX.away) return; lockView(); if (EX.on) buildGauge(); });

function closeExplorer() {
  stopPlay();
  if (EX.overlay) { EX.overlay.remove(); EX.overlay = null; }
  EX.on = false;
  clearStation();
  map.setMaxBounds(null); map.setMinZoom(0);
}

function levelLabel(k) { return EX.sys === 'coast' ? `+${fmt(k / 10)} m` : `${fmt(VANERN_CLASSES[k - 1][1])} m`; }
function levelValue(k) { return EX.sys === 'coast' ? k / 10 : VANERN_CLASSES[k - 1][1]; }
function levelFromValue(v) {                           // nearest gauge step at or above a water level
  if (EX.sys === 'coast') return Math.min(EX.kMax, Math.max(EX.kMin, Math.round(v * 10)));
  for (let k = 1; k <= 20; k++) if (VANERN_CLASSES[k - 1][1] >= v - 1e-9) return k;
  return 20;
}

function paint() {
  if (!EX.pix || !EX.view) return;
  const V = EX.view, k = EX.level, ctx = V.canvas.getContext('2d');
  const W = V.W, H = V.H, img = V.img || (V.img = ctx.createImageData(W, H)), px = img.data;
  px.fill(0);
  const coast = EX.sys === 'coast', lvl = levelValue(k), baseV = coast ? 0 : 100;
  const ORG = V.org, WA = V.wa, WB = V.wb, GW = EX.gw, GD = EX.gdata, A = Math.round(255 * Math.max(state.opacity, 0.3));
  const keyOf = new Uint8Array(256);
  for (let v = baseV + (coast ? 2 : 1); v <= baseV + k; v++) keyOf[v] = LUT[v] ? v : 0;
  const DEPTH_OF = new Float32Array(256);
  for (let v = 1; v <= 120; v++) if (keyOf[v]) DEPTH_OF[v] = coast ? (k - v) / 10 + 0.05 : lvl - (VANERN_CLASSES[v - 101][0] ?? VANERN_CLASSES[v - 101][1] - 0.1);
  const single = state.style === 'single';
  const MINK = V.minK, TOP = baseV + k;
  for (let i = 0; i < ORG.length; i++) {
    if (MINK[i] > TOP) continue;
    const o0 = ORG[i]; if (o0 < 0) continue;
    let anyK = 0;
    for (let jj = 0; jj < 4; jj++) { const row = o0 + jj * GW; for (let ii = 0; ii < 4; ii++) anyK |= (KS[jj * 4 + ii] = keyOf[GD[row + ii]]); }
    if (!anyK) continue;
    bspline(WA[i] / 255, WX); bspline(WB[i] / 255, WY);
    const [key, f] = blend16();
    if (!key) continue;
    let col = FLOOD_RGB;
    if (!single) { const depth = DEPTH_OF[key]; col = DEPTH_RGB[DEPTH_RGB.length - 1][1]; for (const [lim, c] of DEPTH_RGB) if (depth <= lim) { col = c; break; } }
    const o = i * 4; px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = A * f;
  }
  ctx.putImageData(img, 0, 0);
  $('#depthKey').hidden = single;
  updateGauge();
  updateNow();
  if (drawerOpen === 'details') drawCurve();
}

// ---------------------------------------------------------------------------
// The tide gauge (vattenståndsskala): the one control for the water level.
function gaugeRange() { return EX.sys === 'coast' ? [0, 5] : [44.4, 48]; }
function flagsFor() {
  const res = EX.res, a = res && res.a, f = [];
  if (EX.addrLevel != null) f.push({ key: 'house', cls: 'is-house', v: levelValue(EX.addrLevel), label: t('flag.house') });
  if (a && a.system === 'coast' && EX.sys === 'coast') f.push({ key: 'record', cls: 'is-record', v: a.rec, label: t('flag.record', { yr: a.station.date.slice(0, 4) }) });
  if (a && a.system === 'vanern' && EX.sys === 'vanern') {
    f.push({ key: 'y100', v: a.muni.y100, label: t('flag.y100') });
    f.push({ key: 'max', v: a.muni.max, label: t('flag.max') });
  }
  return f;
}
function buildGauge() {
  const board = $('#gaugeBoard'), H = board.clientHeight, Wd = board.clientWidth;
  if (!H) return;
  const [lo, hi] = gaugeRange(), Y = v => H - (v - lo) / (hi - lo) * H;
  let s = `<svg class="scale" viewBox="0 0 ${Wd} ${H}" aria-hidden="true">`;
  // the black E-pattern of a real gauge board: alternating 10 cm blocks on the left
  for (let d = Math.round(lo * 10); d < Math.round(hi * 10); d++) {
    if (d % 2) continue;
    const y1 = Y((d + 1) / 10), y0 = Y(d / 10);
    s += `<rect class="e-mark" x="5" y="${y1.toFixed(1)}" width="${(Wd * 0.3).toFixed(1)}" height="${(y0 - y1).toFixed(1)}"/>`;
  }
  s += `<rect class="e-mark" x="5" y="0" width="3" height="${H}"/><g class="ticks">`;
  for (let d = Math.round(lo * 10); d <= Math.round(hi * 10); d++) {
    const y = Y(d / 10).toFixed(1), major = d % 10 === 0, half = d % 5 === 0;
    s += `<line x1="${(Wd * 0.3 + 5).toFixed(1)}" x2="${(Wd * (major ? 0.62 : half ? 0.5 : 0.42)).toFixed(1)}" y1="${y}" y2="${y}" stroke-width="${major ? 2 : 1}"/>`;
  }
  s += '</g>';
  for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
    if (EX.sys === 'coast' && m === 0) continue;
    const y = Y(m);
    s += `<text class="num" x="${Wd - 5}" y="${(y + 6).toFixed(1)}" text-anchor="end">${m}</text>`;
  }
  s += '</svg><div class="gauge-water" id="gaugeWater"></div><div class="gauge-handle" id="gaugeHandle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 9l4-4 4 4M8 15l4 4 4-4"/></svg></div>';
  // flags (the address, the record storm, the planning levels) — each is clickable
  const flags = flagsFor().sort((a, b) => a.v - b.v);
  let lastTop = Infinity;
  for (const f of flags) {
    let top = Y(Math.min(hi, Math.max(lo, f.v)));
    if (lastTop - top < 26) top = lastTop - 26;             // keep labels from overlapping
    lastTop = top;
    s += `<button type="button" class="gauge-flag ${f.cls || ''}${EX.story && !EX.shown.has(f.key) ? ' pending' : ''}" data-key="${f.key}" style="top:${top.toFixed(1)}px" data-v="${f.v}" title="${esc(f.label)}"><i></i><span class="fl-label">${esc(f.label)}</span> <b>${EX.sys === 'coast' ? '+' : ''}${fmt(f.v)}</b></button>`;
  }
  board.innerHTML = s;
  board.querySelectorAll('.gauge-flag').forEach(b => b.onclick = e => { e.stopPropagation(); stopPlay(); setLevel(levelFromValue(+b.dataset.v)); });
  board.setAttribute('aria-valuemin', levelValue(EX.kMin)); board.setAttribute('aria-valuemax', levelValue(EX.kMax));
  $('#gaugeHint').textContent = t('gauge.hint');
  updateGauge();
}
function updateGauge() {
  const w = $('#gaugeWater'); if (!w) return;
  const [lo, hi] = gaugeRange(), v = levelValue(EX.level);
  w.style.height = `${((v - lo) / (hi - lo) * 100).toFixed(2)}%`;
  const hd = $('#gaugeHandle'); if (hd) hd.style.bottom = w.style.height;
  $('#gaugeRead').textContent = levelLabel(EX.level);
  const b = $('#gaugeBoard');
  b.setAttribute('aria-valuenow', v); b.setAttribute('aria-valuetext', levelLabel(EX.level));
}
function setLevel(k) {
  EX.level = Math.min(EX.kMax, Math.max(EX.kMin, k));
  paint();
}
// drag on the board
(() => {
  const b = $('#gaugeBoard');
  const fromEvent = e => {
    const r = b.getBoundingClientRect(), [lo, hi] = gaugeRange();
    return levelFromValue(lo + (1 - (e.clientY - r.top) / r.height) * (hi - lo));
  };
  let dragging = false;
  b.addEventListener('pointerdown', e => { if (e.target.closest('.gauge-flag')) return; dragging = true; b.setPointerCapture(e.pointerId); stopPlay(); setLevel(fromEvent(e)); });
  b.addEventListener('pointermove', e => { if (dragging) { const k = fromEvent(e); if (k !== EX.level) setLevel(k); } });
  b.addEventListener('pointerup', () => { dragging = false; });
  b.addEventListener('keydown', e => {
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
    if (step) { e.preventDefault(); stopPlay(); setLevel(EX.level + step); }
    if (e.key === 'Home') { e.preventDefault(); setLevel(EX.kMin); }
    if (e.key === 'End') { e.preventDefault(); setLevel(EX.kMax); }
  });
})();
// ---- The story: the water rises by itself, and the important levels are revealed one at a time ----
function milestones() {
  const a = EX.res && EX.res.a, list = [];
  for (const f of flagsFor()) {
    const k = levelFromValue(f.v);
    if (k < EX.kMin || k > EX.kMax) continue;
    let text;
    if (f.key === 'house') text = t('story.house');
    else if (f.key === 'record') text = t('story.record', { st: a.station.name, yr: a.station.date.slice(0, 4) });
    else if (f.key === 'y100') text = t('story.y100', { muni: a.muni.name });
    else text = t('story.max', { muni: a.muni.name });
    list.push({ k, key: f.key, text, v: f.v });
  }
  return list.sort((x, y) => x.k - y.k || (x.key === 'house') - (y.key === 'house'));
}
function caption(levelText, text, sub, cls = '') {
  showCallout(`<button type="button" class="c-skip" id="storySkip">${t('story.skip')}</button>
    <p class="c-level">${esc(levelText)}</p><p class="c-text">${esc(text)}</p>${sub ? `<p class="c-sub">${esc(sub)}</p>` : ''}`, 'story', cls);
  $('#storySkip').onclick = () => finishStory(true);
}
const areaLine = k => t('story.area', { p: pctText(Math.round(EX.curve[k - 1] || 0)) });
function revealFlag(key) {
  EX.shown.add(key);
  const f = document.querySelector(`.gauge-flag[data-key="${key}"]`);
  if (f) { f.classList.remove('pending'); f.classList.add('pop'); }
}
function runStory() {
  stopPlay();
  const ms = milestones();
  EX.story = { i: 0, ms, hold: performance.now() + 1400, top: false };
  syncHouseDrag();
  EX.shown = new Set();
  EX.level = EX.kMin;
  buildGauge(); paint();
  // Focus: everything not needed for the story fades away until it ends.
  if (drawerOpen) toggleDrawer(null);
  $('#gauge').classList.remove('beckon');
  document.body.classList.add('story');
  caption(levelLabel(EX.level), t(EX.sys === 'coast' ? 'story.start' : 'story.startVan'), '');
  $('#gaugePlay').classList.add('playing');
  EX.timer = setInterval(storyTick, 140);
}
function storyTick() {
  const S = EX.story; if (!S) return;
  if (performance.now() < S.hold) return;
  const next = S.ms[S.i];
  if (next && EX.level >= next.k) {
    revealFlag(next.key);
    const house = next.key === 'house';
    caption(`${EX.sys === 'coast' ? '+' : ''}${fmt(next.v)} m`, next.text, areaLine(EX.level), house ? 'is-house' : '');
    if (house) marker?.getElement()?.firstElementChild?.classList.add('ping');
    S.i++; S.hold = performance.now() + (house ? 3200 : 2600);
    return;
  }
  if (EX.level >= EX.kMax) {
    if (!S.top) {
      S.top = true;
      caption(levelLabel(EX.level), t(EX.addrLevel == null ? 'story.dry' : 'story.top'), areaLine(EX.level), EX.addrLevel == null ? 'is-dry' : '');
      S.hold = performance.now() + 2600;
      return;
    }
    finishStory(true);
    return;
  }
  setLevel(EX.level + 1);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// End of the story, as one smooth sequence: the last caption fades out, the water eases back down
// to the address' level, the answer grows out of the house, the other controls fade back in, and
// finally the gauge flashes to show that it can be used. An interruption (drag, skip) runs a
// shorter version without the easing.
async function finishStory(settle) {
  const wasStory = !!EX.story;
  clearInterval(EX.timer); EX.timer = null; EX.story = null;
  $('#gaugePlay').classList.remove('playing');
  document.querySelectorAll('.gauge-flag.pending').forEach(f => { f.classList.remove('pending'); EX.shown.add(f.dataset.key); });
  marker?.getElement()?.firstElementChild?.classList.remove('ping');
  if (!(!EX.revealed || wasStory)) { document.body.classList.remove('story'); return; }
  EX.revealed = true;
  const token = (finishStory.token = (finishStory.token || 0) + 1);
  EX.outro = true;
  const still = () => token === finishStory.token && EX.on;
  if (!callout.hidden) { callout.classList.add('leave'); await sleep(320); if (!still()) return; hideCallout(); }
  if (settle && EX.addrLevel != null && EX.level !== EX.addrLevel) {
    // ease down: big steps first, small steps near the target
    while (EX.level !== EX.addrLevel) {
      const gap = EX.addrLevel - EX.level, step = Math.sign(gap) * Math.max(1, Math.round(Math.abs(gap) / 4));
      setLevel(EX.level + step);
      await sleep(70);
      if (!still() || EX.story) return;
    }
    await sleep(250); if (!still()) return;
  }
  renderVerdict(true);
  await sleep(450); if (!still()) return;
  document.body.classList.remove('story');           // controls fade back in (CSS transition)
  await sleep(700); if (!still()) return;
  EX.outro = false;
  beckonGauge();
  setTimeout(() => { if (!EX.story && !EX.away) beckonStation(); }, 2600);
}
// The user takes over during the outro: finish it at once.
function cancelOutro() {
  if (!EX.outro) return;
  EX.outro = false; finishStory.token++;
  if (calloutMode !== 'verdict') renderVerdict(true);
  document.body.classList.remove('story');
}
// After the story, make it obvious that the gauge can be used: flash it a few times.
function beckonGauge() {
  const g = $('#gauge');
  g.classList.remove('beckon'); void g.offsetWidth; g.classList.add('beckon');
  clearTimeout(beckonGauge.t); beckonGauge.t = setTimeout(() => g.classList.remove('beckon'), 5200);
}
function stopPlay() { if (EX.story) finishStory(false); else cancelOutro(); clearInterval(EX.timer); EX.timer = null; $('#gaugePlay').classList.remove('playing'); }
$('#gaugePlay').onclick = () => { if (EX.story) { finishStory(false); return; } runStory(); };

// Share of the map area under water, per water level (single series; the heading names it).
function drawCurve(hoverK) {
  const el = $('#chartArea'); if (!el || !EX.curve) return;
  const W = 380, H = 170, L0 = 40, R0 = W - 8, T0 = 10, B0 = H - 24;
  const n = EX.curve.length, kMin = EX.kMin;
  const maxA = Math.max(...EX.curve, 0.01);
  const X = k => L0 + (k - kMin) / (n - kMin) * (R0 - L0), Y = a => B0 - a / maxA * (B0 - T0);
  let d = `M${X(kMin)},${Y(0)}`;
  for (let k = kMin; k <= n; k++) d += ` L${X(k)},${Y(EX.curve[k - 1])}`;
  const nice = (() => { const s = maxA / 3, p = 10 ** Math.floor(Math.log10(s)), m = s / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : 5) * p; })();
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('ex.chart.aria')}">`;
  for (let v = 0; v <= maxA + 1e-9; v += nice) s += `<line class="grid" x1="${L0}" x2="${R0}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L0 - 6}" y="${Y(v) + 4}" text-anchor="end">${pctText(fmtN(v))}</text>`;
  const ticks = EX.sys === 'coast' ? [2, 10, 20, 30, 40, 50] : [1, 5, 10, 15, 20];
  for (const tk of ticks) s += `<text x="${X(tk)}" y="${H - 6}" text-anchor="middle">${levelLabel(tk).replace(' m', '')}</text>`;
  s += `<path d="${d} L${X(n)},${Y(0)} Z" fill="var(--sea)" opacity=".16"/><path d="${d}" fill="none" stroke="var(--sea)" stroke-width="2" stroke-linejoin="round"/>`;
  if (EX.addrLevel != null && EX.addrLevel >= kMin) {
    const x = X(EX.addrLevel);
    s += `<line x1="${x}" x2="${x}" y1="${T0}" y2="${B0}" stroke="var(--signal)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  }
  const k = EX.level;
  s += `<line x1="${X(k)}" x2="${X(k)}" y1="${T0}" y2="${B0}" stroke="var(--ink)" stroke-width="1.5"/><circle cx="${X(k)}" cy="${Y(EX.curve[k - 1])}" r="4.5" fill="var(--sea)" stroke="#fff" stroke-width="2"/>`;
  if (hoverK) {
    const hx = X(hoverK), right = hx > W * .6;
    s += `<line x1="${hx}" x2="${hx}" y1="${T0}" y2="${B0}" stroke="var(--ink-3)" stroke-dasharray="2 2"/><text x="${hx + (right ? -6 : 6)}" y="${T0 + 12}" text-anchor="${right ? 'end' : 'start'}" style="fill:var(--ink);font-weight:600">${levelLabel(hoverK)}: ${pctText(fmtN(EX.curve[hoverK - 1]))}</text>`;
  }
  s += `<rect x="${L0}" y="${T0}" width="${R0 - L0}" height="${B0 - T0}" fill="transparent"/></svg>`;
  el.innerHTML = s;
  const svg = el.querySelector('svg');
  const kAt = e => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W; return Math.min(n, Math.max(kMin, Math.round(kMin + (x - L0) / (R0 - L0) * (n - kMin)))); };
  svg.onmousemove = e => drawCurve(kAt(e));
  svg.onmouseleave = () => drawCurve();
  svg.onclick = e => { stopPlay(); setLevel(kAt(e)); };
}

// ---------------------------------------------------------------------------
// The callout: a speech-bubble box attached to the house. It carries the story captions while the
// water rises, and afterwards the answer. It follows the house when the map moves.
const callout = document.createElement('div');
callout.id = 'callout'; callout.className = 'callout'; callout.hidden = true;
callout.setAttribute('role', 'status'); callout.setAttribute('aria-live', 'polite');
document.body.appendChild(callout);                   // above the map and the gauge; the map fills the window
L.DomEvent.disableClickPropagation(callout);
if (L.DomEvent.disableScrollPropagation) L.DomEvent.disableScrollPropagation(callout);
let calloutMode = null, calloutAt = null;            // calloutAt: {ll, gap} or null for the house
function showCallout(html, mode, cls = '', at = null) {
  calloutMode = mode; calloutAt = at; placeCallout.nudged = false;
  callout.innerHTML = `<div class="c-body">${html}</div><span class="c-tail" aria-hidden="true"></span>`;
  callout.className = `callout ${mode} ${cls}`;
  callout.hidden = false;
  if (cls !== 'still') { callout.classList.remove('show'); void callout.offsetWidth; callout.classList.add('show'); }
  placeCallout();
}
function hideCallout() { callout.hidden = true; calloutMode = null; }
function placeCallout() {
  if (callout.hidden || !lastResult) return;
  const size = map.getSize(), p = map.latLngToContainerPoint(calloutAt ? calloutAt.ll : [lastResult.lat, lastResult.lon]);
  const gap = calloutAt ? calloutAt.gap : 44;
  const w = callout.offsetWidth, h = callout.offsetHeight, narrow = innerWidth < 720;
  const topLimit = narrow ? 118 : 70;
  let right = size.x - (narrow ? 8 : 150);
  if (narrow) {                                          // phones: keep clear of the gauge
    const r = $('#gaugeBoard').getBoundingClientRect(); if (r.width) right = Math.min(right, r.left - 8);
  }
  const x = Math.max(8, Math.min(p.x - w / 2, right - w));
  let y = p.y - gap - h, below = false;
  if (y < topLimit) { y = p.y + (calloutAt ? 26 : 14); below = true; }
  const wantY = y;
  y = Math.max(topLimit, Math.min(y, size.y - h - 8));   // never outside the window
  // Box below the house but pushed up over it (small screens): nudge the map up so the house shows.
  if (below && y < wantY - 2 && !EX.away && !placeCallout.panning && !placeCallout.nudged) {
    const room = p.y - 34 - (topLimit + 6);             // how far the house can go up and stay visible
    const need = Math.min(wantY - y, Math.max(0, room));
    if (need > 2) {
      placeCallout.panning = placeCallout.nudged = true;    // once per box, never a loop
      map.once('moveend', () => { placeCallout.panning = false; placeCallout(); });
      setTimeout(() => { placeCallout.panning = false; }, 900);
      map.panBy([0, Math.round(need)], { animate: true, duration: 0.35 });
    }
  }
  callout.style.left = `${x}px`; callout.style.top = `${y}px`;
  callout.classList.toggle('below', below);
  callout.style.setProperty('--tail-x', `${Math.max(18, Math.min(w - 18, p.x - x))}px`);
}
map.on('move zoomend resize viewreset', placeCallout);
if (window.ResizeObserver) new ResizeObserver(() => placeCallout()).observe(callout);
map.on('zoomstart', () => { callout.style.visibility = 'hidden'; });
map.on('zoomend', () => { callout.style.visibility = ''; });

// ---------------------------------------------------------------------------
// Things on the map you can tap: the house, the SMHI gauge station, any spot.
function onHouseClick() {
  if (!lastResult || !lastResult.riskKey || EX.story || EX.away) return;
  if (!callout.hidden && calloutMode === 'verdict') hideCallout(); else renderVerdict(true);
}
let stationMarker = null, edgeEl = null, stationInfo = null;
const STATION_SVG = '<svg viewBox="0 0 26 26" aria-hidden="true"><rect x="9" y="2" width="8" height="22" rx="1.5" fill="#fff" stroke="#0f2b3a" stroke-width="1.6"/><path d="M11 5h4M11 9h4M11 13h4M11 17h4" stroke="#0f2b3a" stroke-width="1.6"/><path d="M2 20c2-1.4 4-1.4 6 0s4 1.4 6 0 4-1.4 6 0 4 1.4 4 0" stroke="#1f6fa8" stroke-width="1.8" fill="none"/></svg>';
// ---- Visiting the SMHI station: fly there, show its record, fly back to the address ------------
function showStationCallout(st) {
  showCallout(`<p class="c-addr">${t('st.title', { st: esc(st.name) })}</p>
    <p class="c-level">+${fmt(st.max / 100)} m</p>
    <p class="c-text">${t('st.recText', { date: st.date })}</p>
    <div class="c-buttons">
      <button type="button" class="pop-btn" id="stBack">${t('st.back')}</button>
      <button type="button" class="link-btn" id="stShowHome">${t('st.showHome')}</button>
    </div>`, 'is-station', '', { ll: [st.lat, st.lon], gap: 26 });
  $('#stBack').onclick = () => returnHome();
  $('#stShowHome').onclick = () => returnHome(levelFromValue(st.max / 100));
}
let awayMarker = null;
function goToStation(st) {
  if (EX.away) return;
  stopPlay();
  EX.away = true;
  syncHouseDrag();
  map.closePopup(); hideCallout();
  document.body.classList.add('away');                  // gauge and address controls rest while away
  map.setMaxBounds(null); map.setMinZoom(0);
  if (!stationMarker) awayMarker = L.marker([st.lat, st.lon], { icon: stationIcon(st), title: st.name }).addTo(map);
  map.once('moveend', () => { if (EX.away) showStationCallout(st); });
  map.flyTo([st.lat, st.lon], 15, { duration: 2.2 });
}
function returnHome(level) {
  if (!EX.away) return;
  hideCallout();
  const z = START_ZOOM, o = houseOffset(), off = L.point(o[0], o[1]);
  const target = map.unproject(map.project([EX.res.lat, EX.res.lon], z).add(off), z);
  map.once('moveend', () => {
    EX.away = false;
    if (awayMarker) { awayMarker.remove(); awayMarker = null; }
    map.setMaxBounds(EX.bounds);
    map.setMinZoom(Math.max(EX.zMin, map.getBoundsZoom(EX.bounds, true)));
    document.body.classList.remove('away');
    if (level != null) setLevel(level);
    renderVerdict(true);
    updateEdge();
  });
  map.flyTo(target, z, { duration: 2 });
}
function clearStation() {
  if (stationMarker) { stationMarker.remove(); stationMarker = null; }
  if (edgeEl) { edgeEl.remove(); edgeEl = null; }
  $('#gauge').classList.remove('has-record');
  stationInfo = null;
}
function stationIcon(st) {
  return L.divIcon({ className: '', iconSize: [30, 30],
    html: `<div class="station">${STATION_SVG}<span class="st-tag">+${fmt(st.max / 100)} m</span></div>` });
}
function placeStation() {
  clearStation();
  const a = EX.res && EX.res.a;
  if (EX.sys !== 'coast') return;
  const st = a && a.station ? a.station : nearest(SMHI_STATIONS, EX.res.lat, EX.res.lon);
  stationInfo = st;
  if (EX.bounds.contains([st.lat, st.lon])) {
    stationMarker = L.marker([st.lat, st.lon], { icon: stationIcon(st), title: st.name }).addTo(map);
    stationMarker.on('click', () => goToStation(st));
  }
}
function updateEdge() {
  if (!edgeEl || !stationInfo || EX.away) return;
  const st = stationInfo;
  const p = map.latLngToContainerPoint([st.lat, st.lon]), house = map.latLngToContainerPoint([EX.res.lat, EX.res.lon]);
  const km = map.distance([EX.res.lat, EX.res.lon], [st.lat, st.lon]) / 1000;
  const ang = Math.atan2(p.y - house.y, p.x - house.x) * 180 / Math.PI;
  const kmTxt = km < 1 ? fmt(Math.max(0.1, Math.round(km * 10) / 10)) : Math.round(km);
  const html = `<span class="arrow" style="transform:rotate(${ang}deg)"><svg viewBox="0 0 12 12"><path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5"/></svg></span>
    <span class="ep-text"><span class="ep-label">${t('st.edgeRec')}</span><span class="ep-short">${t('st.edgeShort')}</span><b class="ep-level">+${fmt(st.max / 100)} m</b>
    <span class="ep-where">${esc(t('st.edgeWhere', { st: st.name, km: kmTxt }))}</span></span>`;
  if (edgeEl.innerHTML !== html) edgeEl.innerHTML = html;
  edgeEl.title = t('st.goTo');
}
// After the story: draw the eye to the record, once the gauge has had its turn.
function beckonStation() {
  const els = [$('#actRec'), stationMarker && stationMarker.getElement ? stationMarker.getElement() : null,
    document.querySelector('.gauge-flag.is-record')].filter(Boolean);
  els.forEach(e => { e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash'); });
  clearTimeout(beckonStation.t); beckonStation.t = setTimeout(() => els.forEach(e => e.classList.remove('flash')), 4200);
}

// ---------------------------------------------------------------------------
// Geocoding (Nominatim; one request per explicit search, per its usage policy)
const NOM = 'https://nominatim.openstreetmap.org';
// Keyboard: ↓/↑ move through the suggestions, Enter picks the highlighted one (or searches when
// none is highlighted), Esc closes the list. The input keeps focus the whole time (combobox pattern).
let suggestions = [], activeIdx = -1;
function setActive(i) {
  const items = [...document.querySelectorAll('#suggestions li[role="option"]')];
  if (!items.length) return;
  activeIdx = (i + items.length) % items.length;
  items.forEach((li, n) => li.setAttribute('aria-selected', n === activeIdx));
  const li = items[activeIdx];
  $('#q').setAttribute('aria-activedescendant', li.id);
  li.scrollIntoView({ block: 'nearest' });
}
function closeSuggestions() {
  $('#suggestions').hidden = true; suggestions = []; activeIdx = -1;
  $('#q').removeAttribute('aria-activedescendant'); $('#q').setAttribute('aria-expanded', 'false');
}
const qInput = $('#q');
qInput.setAttribute('role', 'combobox'); qInput.setAttribute('aria-controls', 'suggestions');
qInput.setAttribute('aria-autocomplete', 'list'); qInput.setAttribute('aria-expanded', 'false');
qInput.addEventListener('keydown', e => {
  const open = !$('#suggestions').hidden && suggestions.length;
  if (e.key === 'ArrowDown' && open) { e.preventDefault(); setActive(activeIdx + 1); }
  else if (e.key === 'ArrowUp' && open) { e.preventDefault(); setActive(activeIdx - 1); }
  else if (e.key === 'Enter' && open && activeIdx >= 0) { e.preventDefault(); const p = suggestions[activeIdx]; closeSuggestions(); pick(p); }
  else if (e.key === 'Escape' && !$('#suggestions').hidden) { e.preventDefault(); closeSuggestions(); }
});
qInput.addEventListener('input', () => { if (!$('#suggestions').hidden) closeSuggestions(); });
$('#search').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#q').value.trim(); if (!q) return;
  const ul = $('#suggestions'); suggestions = []; activeIdx = -1;
  ul.hidden = false; ul.innerHTML = `<li class="msg">${t('search.searching')}</li>`;
  try {
    const r = await fetch(`${NOM}/search?format=jsonv2&countrycodes=se&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': LANG === 'sv' ? 'sv,en' : 'en,sv' } });
    const js = await r.json();
    if (!js.length) { ul.innerHTML = `<li class="msg">${t('search.none')}</li>`; return; }
    if (js.length === 1) { closeSuggestions(); pick(js[0]); return; }
    ul.innerHTML = '';
    suggestions = js;
    js.forEach((p, n) => {
      const li = document.createElement('li'); li.setAttribute('role', 'option'); li.id = `sugg-${n}`;
      const [first, second] = niceName(p);
      li.innerHTML = `${esc(first)}<small>${esc(second)}</small>`;
      li.onmousedown = ev => ev.preventDefault();          // keep focus in the input
      li.onclick = () => { closeSuggestions(); pick(p); };
      li.onmousemove = () => { if (activeIdx !== n) setActive(n); };
      ul.appendChild(li);
    });
    $('#q').setAttribute('aria-expanded', 'true');
    setActive(0);                                          // the first result is highlighted: Enter picks it
  } catch { ul.innerHTML = `<li class="msg">${t('search.error')}</li>`; }
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
  if (awayMarker) { awayMarker.remove(); awayMarker = null; }
  EX.away = false; document.body.classList.remove('away');
  closeExplorer();
  finishStory.token = (finishStory.token || 0) + 1;     // cancel any running outro
  document.body.classList.remove('story');
  hideCallout();
  if (drawerOpen === 'details') toggleDrawer(null);
  map.setView([lat, lon], START_ZOOM);
  assess(lat, lon, niceName(p).filter(Boolean).join(', '));
}

// ---------------------------------------------------------------------------
// Language: apply to the fixed page texts, then redraw everything that holds text.
function applyStatic() {
  document.documentElement.lang = LANG;
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]').content = t('meta.description');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === LANG));
  $('#opOut').textContent = pctText(Math.round(state.opacity * 100));
  if (drawerOpen) $('#drawerTitle').textContent = t(DRAWERS[drawerOpen][1]);
  drawDepthKey();
}
function setLang(lang) {
  if (!I18N[lang] || lang === LANG) return;
  LANG = lang;
  try { localStorage.setItem('kk-lang', lang); } catch { /* not remembered, that's fine */ }
  applyStatic();
  for (const g of Object.values(GROUPS)) document.querySelectorAll(`${g.chips} .chip`).forEach(ch => {
    const v = +ch.dataset.v; ch.textContent = g.label(v); ch.title = g.title(v);
  });
  if (META) layersChanged();
  map.closePopup();
  if (EX.on) { buildGauge(); if (calloutMode === 'verdict') renderVerdict(); if (drawerOpen === 'details') renderDetails(); updateEdge(); }
}
document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
applyStatic();

// ---------------------------------------------------------------------------
// Landing: the site opens with only the question and an address box over a blurred map. After a
// search the map is locked around that address; the only way elsewhere is a new search.
const MAP_HANDLERS = ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'];
function enterLanding() {
  document.body.classList.add('landing');
  $('#landingSearch').append($('#search'), $('#suggestions'));
  MAP_HANDLERS.forEach(h => map[h] && map[h].disable());
  map.invalidateSize({ pan: false });
  map.setView([62.0, 16.5], innerWidth < 800 ? 4 : 5, { animate: false });
  setTimeout(() => $('#q').focus(), 50);
}
function leaveLanding() {
  if (!document.body.classList.contains('landing')) return;
  document.body.classList.remove('landing');
  $('#barSearch').append($('#search'), $('#suggestions'));
  MAP_HANDLERS.forEach(h => map[h] && map[h].enable());
  map.invalidateSize({ pan: false });
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
  $('#landNote').insertAdjacentHTML('beforebegin', `<p style="color:var(--signal)">${t('error.data')}</p>`);
});
window.FloodCheck = { assess, TM, valueAt, state, setLevel, EX };
})();
