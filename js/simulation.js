
"use strict";

/* ============================================================
   TERMINUS — post-singularity predator-prey ecosystem
   scrap (resource) -> survivors (prey) -> machines (predator)
   ============================================================ */

const CELL = 11;              // world grid cell size in px
const MAX_HUMANS  = 4000;
const MAX_MACHINES = 900;
const HIST_MAX = 320;         // chart samples kept
const SAMPLE_DT = 0.25;       // sim-seconds between chart samples

/* ---------- tunable parameters (bound to sliders) ---------- */
/* Defaults are tuned for a stable Lotka-Volterra oscillation: prey peaks,
   predators peak ~15s later, prey crashes, predators starve, scrap recovers. */
const P = {
  speed: 1,
  // scrap
  regrow: 0.18, spread: 0.55, nutrition: 19,
  // survivors
  hMetab: 5.5, hBreed: 76, hForage: 1.0, hPanic: 100, hConceal: 0.55,
  // machines
  mMetab: 5.5, mBreed: 155, mYield: 24, mSight: 105, mSpeed: 74,
};

const SPECS = {
  grpSim: [
    { k:'speed', label:'Speed', min:0, max:4, step:0.05, fmt:v => v.toFixed(2).replace(/0$/,'')+'×' },
  ],
  grpScrap: [
    { k:'regrow',    label:'Resupply rate', min:0,  max:0.6, step:0.005, fmt:v => v.toFixed(3) },
    { k:'spread',    label:'Cache spread',  min:0,  max:1,   step:0.01,  fmt:v => v.toFixed(2) },
    { k:'nutrition', label:'Nutrition',     min:3,  max:45,  step:1,     fmt:v => v|0 },
  ],
  grpHuman: [
    { k:'hMetab',   label:'Metabolism',      min:1,  max:14,  step:0.1, fmt:v => v.toFixed(1) },
    { k:'hBreed',   label:'Breeding energy', min:40, max:150, step:1,   fmt:v => v|0 },
    { k:'hForage',  label:'Foraging speed',  min:0.2,max:2.5, step:0.05,fmt:v => v.toFixed(2) },
    { k:'hPanic',   label:'Panic range',     min:0,  max:220, step:1,   fmt:v => (v|0)+'px' },
    { k:'hConceal', label:'Concealment',     min:0,  max:0.9, step:0.01,fmt:v => Math.round(v*100)+'%' },
  ],
  grpMachine: [
    { k:'mMetab', label:'Metabolism',      min:0.4,max:10,  step:0.1, fmt:v => v.toFixed(1) },
    { k:'mBreed', label:'Breeding energy', min:40, max:220, step:1,   fmt:v => v|0 },
    { k:'mYield', label:'Prey yield',      min:5,  max:95,  step:1,   fmt:v => v|0 },
    { k:'mSight', label:'Sight range',     min:20, max:340, step:1,   fmt:v => (v|0)+'px' },
    { k:'mSpeed', label:'Pursuit speed',   min:30, max:150, step:1,   fmt:v => (v|0)+'px/s' },
  ],
};

const PRESETS = {
  equilibrium: { p:{regrow:.18,spread:.55,nutrition:19,hMetab:5.5,hBreed:76,hForage:1,hPanic:100,hConceal:.55,
                    mMetab:5.5,mBreed:155,mYield:24,mSight:105,mSpeed:74},
                 seed:{h:220,m:7,g:.55}, rescue:true, msg:'EQUILIBRIUM — the long negotiation' },
  purge:       { p:{regrow:.16,spread:.5,nutrition:17,hMetab:5.5,hBreed:88,hForage:1,hPanic:130,hConceal:.18,
                    mMetab:2.2,mBreed:120,mYield:44,mSight:240,mSpeed:96},
                 seed:{h:420,m:20,g:.6}, rescue:false, msg:'PURGE PROTOCOL ENGAGED' },
  rewild:      { p:{regrow:.32,spread:.75,nutrition:24,hMetab:4.6,hBreed:70,hForage:1.2,hPanic:100,hConceal:.6,
                    mMetab:5.5,mBreed:155,mYield:24,mSight:105,mSpeed:74},
                 seed:{h:80,m:0,g:.85}, rescue:true, msg:'REWILDING — no machines. drop one in.' },
};

/* ---------- canvas / world ---------- */
const stage  = document.getElementById('stage');
const cv     = document.getElementById('world');
const ctx    = cv.getContext('2d');
const chartC = document.getElementById('chart');
const cctx   = chartC.getContext('2d');

let W = 0, H = 0, COLS = 0, ROWS = 0, DPR = 1;
let scrap = new Float32Array(0);   // 0..1 per cell
let lvl   = new Uint8Array(0);     // cached draw bucket

let humans = [], machines = [], fx = [];
let simTime = 0, kills = 0, running = true;
let everH = true, everM = true;   // has each species existed since the last seed?
let corpses = [];                 // fallen survivors litter the field, then fade
let adaptLvl = 0, adaptNext = 400;// machine self-improvement ratchet (see adaptTick)
let impOn = true;                 // cached "Self-improvement" checkbox state
let extinct = false, silentLogged = false;
let kps = 0, kSample = 0;         // kill-rate estimate driving the alarm vignette
let msIdx = 0, prevTH = 0, prevTM = 0;
const MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
let hist = [], sampleAcc = 0;
let fps = 60, frames = 0, fpsAcc = 0;

// Shared operations layer. Renderer and command.js consume these plain records.
const OPS = {
  credits: 100, maxCredits: 100, shelters: [], beacons: [], pulses: [], storm: false,
  stormTime: 0, nextStorm: 50, rescued: 0, objectiveIndex: 0, empHits: 0, stormWarned: false,
  objectives: [], milestones: [],
};
const COMMANDS = {
  shelter: { cost: 40, radius: 62, life: 75, cooldown: 1.8 },
  emp: { cost: 30, radius: 110, duration: 8, cooldown: 2.4 },
  lure: { cost: 20, radius: 135, duration: 20, cooldown: 2.0 },
  supply: { cost: 25, radius: 90, cooldown: 2.2 },
};
const commandReady = { shelter: 0, emp: 0, lure: 0, supply: 0 };
let selectedScenario = 'equilibrium';

/* ---------- spatial hash ---------- */
const BUCKET = 44;
class Hash {
  constructor(){ this.map = new Map(); this.cols = 1; }
  build(list){
    this.map.clear();
    this.cols = Math.max(1, Math.ceil(W / BUCKET));
    for (let i = 0; i < list.length; i++){
      const a = list[i];
      const key = ((a.y / BUCKET) | 0) * this.cols + ((a.x / BUCKET) | 0);
      let b = this.map.get(key);
      if (!b) this.map.set(key, b = []);
      b.push(a);
    }
  }
  near(x, y, r, out){
    out.length = 0;
    const c0 = Math.max(0, Math.floor((x - r) / BUCKET)), c1 = Math.min(this.cols - 1, Math.floor((x + r) / BUCKET));
    const r0 = Math.max(0, Math.floor((y - r) / BUCKET)), r1 = Math.min(Math.ceil(H / BUCKET) - 1, Math.floor((y + r) / BUCKET));
    for (let ry = r0; ry <= r1; ry++){
      const base = ry * this.cols;
      for (let cx = c0; cx <= c1; cx++){
        const b = this.map.get(base + cx);
        if (b) for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }
}
const hHash = new Hash(), mHash = new Hash();
const scratch = [];

/* ---------- helpers ---------- */
const rnd  = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const cellAt = (x, y) => {
  const c = clamp((x / CELL) | 0, 0, COLS - 1), r = clamp((y / CELL) | 0, 0, ROWS - 1);
  return r * COLS + c;
};

/* ---------- sizing ---------- */
function resize(){
  const rect = stage.getBoundingClientRect();
  const oldW = W, oldH = H;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(200, Math.round(rect.width));
  H = Math.max(160, Math.round(rect.height));
  cv.width  = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const nc = Math.max(4, Math.ceil(W / CELL)), nr = Math.max(4, Math.ceil(H / CELL));
  const ns = new Float32Array(nc * nr);
  if (scrap.length){
    // Tile the old grid into the new one. A straight overlap-copy would leave every
    // newly exposed cell at zero, so growing the window carved out a dead zone that
    // only crept back at the 0.06 cold-start regrowth rate. Tiling keeps both the
    // density and the clumpy texture, and degrades to a plain copy when shrinking.
    for (let r = 0; r < nr; r++)
      for (let c = 0; c < nc; c++)
        ns[r * nc + c] = scrap[(r % ROWS) * COLS + (c % COLS)];
  } else {
    for (let i = 0; i < ns.length; i++) ns[i] = Math.random() < .55 ? rnd(.3, 1) : 0;
  }
  scrap = ns; lvl = new Uint8Array(ns.length); COLS = nc; ROWS = nr;

  // rescale agents into the new bounds rather than clamping them, which used to pile
  // the whole population against the edges after a shrink
  const kx = oldW > 0 ? W / oldW : 1, ky = oldH > 0 ? H / oldH : 1;
  for (const a of humans)   { a.x = clamp(a.x * kx, 2, W - 2); a.y = clamp(a.y * ky, 2, H - 2); }
  for (const a of machines) { a.x = clamp(a.x * kx, 3, W - 3); a.y = clamp(a.y * ky, 3, H - 3); }
  for (const a of OPS.shelters.concat(OPS.beacons, OPS.pulses)) { a.x = clamp(a.x * kx, 4, W - 4); a.y = clamp(a.y * ky, 4, H - 4); }

  const crect = chartC.getBoundingClientRect();
  chartC.width  = Math.max(2, Math.round(crect.width  * DPR));
  chartC.height = Math.max(2, Math.round(crect.height * DPR));
  cctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawChart();
}

/* ---------- spawning ---------- */
function makeHuman(x, y, e){
  x = clamp(x, 2, W - 2); y = clamp(y, 2, H - 2);
  return { x, y, vx: rnd(-1,1), vy: rnd(-1,1), e: e ?? rnd(35, 60),
           panic: 0, age: 0, cd: rnd(0, 2), ph: Math.random() * 6.28, dead: false,
           role: ['scavenger','engineer','medic'][(Math.random() * 3) | 0], shelter: false };
}
function makeMachine(x, y, e){
  x = clamp(x, 3, W - 3); y = clamp(y, 3, H - 3);
  const kind = ['scout','hunter','titan'][(Math.random() * 3) | 0];
  return { x, y, a: rnd(0, 6.28), e: e ?? rnd(50, 80), kind,
           age: 0, cd: rnd(0, 3), lock: null, turn: 0, flash: 0, disabled: 0, lure: 0 };
}

function seedWorld(h, m, g){
  humans = []; machines = []; fx = [];
  for (let i = 0; i < scrap.length; i++) scrap[i] = Math.random() < g ? rnd(.25, 1) : 0;
  for (let i = 0; i < h; i++) humans.push(makeHuman(rnd(0, W), rnd(0, H)));
  for (let i = 0; i < m; i++) machines.push(makeMachine(rnd(0, W), rnd(0, H)));
  everH = h > 0; everM = m > 0;
  corpses.length = 0;
  adaptLvl = 0; adaptNext = 400;
  extinct = false; silentLogged = false;
  msIdx = 0; kps = 0; kSample = 0; prevTH = 0; prevTM = 0;
  simTime = 0; kills = 0; hist = []; sampleAcc = 0;
  OPS.credits = OPS.maxCredits; OPS.shelters.length = 0; OPS.beacons.length = 0;
  OPS.pulses.length = 0; OPS.storm = false; OPS.stormTime = 0; OPS.nextStorm = 50;
  OPS.rescued = 0; OPS.survivalTime = 0; OPS.objectiveIndex = 0; OPS.empHits = 0; OPS.stormWarned = false; OPS.milestones.length = 0;
  OPS.objectives = [
    {id:'refuge', title:'Establish a refuge', detail:'Shelter 10 living survivors', progress:0, done:false},
    {id:'emp', title:'Disrupt the fleet', detail:'EMP 3 machines cumulatively', progress:0, done:false},
    {id:'survive', title:'Hold the line', detail:'Keep a human population alive for 120 uninterrupted seconds', progress:0, done:false},
  ];
  for (const k in commandReady) commandReady[k] = 0;
  selectedScenario = selectedScenario || 'equilibrium';
  slog('world seed established', 'sys');
  const ec = document.getElementById('endcard');
  if (ec) ec.classList.remove('on');
}

/* ---------- toast ---------- */
const toastEl = document.getElementById('toast');
let toastT = 0;
function toast(msg, warn){
  toastEl.textContent = msg;
  toastEl.classList.toggle('warn', !!warn);
  toastEl.classList.add('on');
  toastT = 2.6;
}

/* ---------- procedural audio (WebAudio, zero assets) ---------- */
const SND = (() => {
  let actx = null, master = null, on = false, lastKill = 0;
  function init(){
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
      // ambient dread: two detuned saws + a sub sine through a slowly breathing lowpass
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 230; lp.Q.value = 0.8;
      const dg = actx.createGain(); dg.gain.value = 0.05; lp.connect(dg); dg.connect(master);
      [[55, 'sawtooth'], [55.7, 'sawtooth'], [36.7, 'sine']].forEach(([f, t]) => {
        const o = actx.createOscillator(); o.type = t; o.frequency.value = f; o.connect(lp); o.start();
      });
      const lfo = actx.createOscillator(); lfo.frequency.value = 0.06;
      const lg = actx.createGain(); lg.gain.value = 90;
      lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    } catch (e) { actx = null; }
  }
  function tone(f0, f1, dur, type, vol, delay){
    if (!on || !actx) return;
    const t = actx.currentTime + (delay || 0);
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  return {
    setOn(v){
      on = v;
      if (v){ init(); if (actx && actx.resume) actx.resume(); }
      else if (actx && actx.suspend) actx.suspend();
    },
    kill(){                                       // rate-limited so massacres chatter, not roar
      const n = performance.now();
      if (n - lastKill < 90) return;
      lastKill = n;
      tone(1350, 170, 0.06, 'square', 0.035);
    },
    adapt(){ tone(311,311,.10,'sine',.06); tone(370,370,.10,'sine',.06,.11); tone(466,466,.20,'sine',.06,.22); },
    extinct(){ tone(160, 30, 1.6, 'sawtooth', 0.12); },
    deploy(){ tone(1245,1245,.05,'square',.04); tone(1245,1245,.05,'square',.04,.13); },
    rescue(){ tone(520, 690, 0.22, 'sine', 0.05); },
  };
})();

/* ============================================================
   UPDATE
   ============================================================ */
function updateOperations(dt){
  OPS.credits = Math.min(OPS.maxCredits, OPS.credits + dt * 1.25);
  if (OPS.storm){
    OPS.stormTime -= dt;
    if (OPS.stormTime <= 0){ OPS.storm = false; OPS.stormTime = 0; OPS.nextStorm = 50; slog('ion storm dissipated', 'sys'); }
  } else {
    OPS.nextStorm -= dt;
    if (OPS.nextStorm <= 8 && !OPS.stormWarned){ OPS.stormWarned = true; slog('ion storm warning · 8 seconds', 'bad'); }
    if (OPS.nextStorm <= 0){ OPS.storm = true; OPS.stormTime = 12; OPS.stormWarned = false; slog('ION STORM INBOUND · sensors and resupply degraded', 'bad'); }
  }
  for (const k in commandReady) commandReady[k] = Math.max(0, commandReady[k] - dt);
  for (let i = OPS.shelters.length - 1; i >= 0; i--){
    const s = OPS.shelters[i]; s.life -= dt;
    if (s.life <= 0 || s.hp <= 0){ if (s.hp <= 0) slog('refuge destroyed', 'bad'); OPS.shelters.splice(i, 1); }
  }
  for (let i = OPS.beacons.length - 1; i >= 0; i--){ OPS.beacons[i].life -= dt; if (OPS.beacons[i].life <= 0) OPS.beacons.splice(i, 1); }
  for (const b of OPS.beacons) if (b.type === 'supply'){
    const rc = Math.ceil(b.r / CELL), cc = (b.x / CELL) | 0, rr = (b.y / CELL) | 0;
    for (let dr = -rc; dr <= rc; dr++) for (let dc = -rc; dc <= rc; dc++){
      if (Math.hypot(dc * CELL, dr * CELL) > b.r) continue;
      const c = cc + dc, r = rr + dr; if (c >= 0 && r >= 0 && c < COLS && r < ROWS){ const f = 1 - Math.hypot(dc, dr) / rc; scrap[r * COLS + c] = Math.min(1, scrap[r * COLS + c] + dt * f * (OPS.storm ? .04 : .12)); }
    }
    let n = 0; for (const h of humans) if (n < 5 && distance2(h, b.r, b.x, b.y)){ h.e = Math.min(100, h.e + dt * 1.1); n++; }
  }
  for (let i = OPS.pulses.length - 1; i >= 0; i--){ const p = OPS.pulses[i]; p.t += dt; if (p.t >= p.maxT) OPS.pulses.splice(i, 1); }
}

function updateObjectives(dt = 0){
  const living = humans.filter(h => !h.dead && h.e > 0);
  const sheltered = living.filter(h => h.shelter).length;
  OPS.survivalTime = living.length ? (OPS.survivalTime || 0) + dt : 0;
  const o = OPS.objectives;
  if (!o.length) return;
  o[0].progress = o[0].done ? 1 : Math.min(1, sheltered / 10); o[0].done = o[0].done || sheltered >= 10;
  o[1].progress = Math.min(1, OPS.empHits / 3); o[1].done = o[1].done || OPS.empHits >= 3;
  o[2].progress = o[2].done ? 1 : Math.min(1, OPS.survivalTime / 120); o[2].done = o[2].done || (living.length > 0 && OPS.survivalTime >= 120);
  OPS.objectiveIndex = o.filter(x => x.done).length;
}

function distance2(a, b, x, y){ const dx = a.x - x, dy = a.y - y; return dx * dx + dy * dy <= b * b; }
function intervene(type, x, y){
  if (!['shelter','emp','lure','supply'].includes(type)) return false;
  const c = COMMANDS[type];
  if (!c || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (commandReady[type] > 0 || OPS.credits < c.cost) { toast(commandReady[type] > 0 ? 'TOOL RECHARGING' : 'INSUFFICIENT OPS CREDITS', true); return false; }
  x = clamp(x, 4, W - 4); y = clamp(y, 4, H - 4); OPS.credits -= c.cost; commandReady[type] = c.cooldown;
  if (type === 'shelter') OPS.shelters.push({x, y, r:62, hp:100, life:75, maxLife:75});
  if (type === 'lure') OPS.beacons.push({x, y, r:135, life:20, maxLife:20, type:'lure'});
  if (type === 'supply') {
    OPS.beacons.push({x, y, r:90, life:3, maxLife:3, type:'supply'});
    const rc = Math.ceil(c.radius / CELL), cc = Math.floor(x / CELL), rr = Math.floor(y / CELL);
    for(let row=Math.max(0,rr-rc);row<=Math.min(ROWS-1,rr+rc);row++)
      for(let col=Math.max(0,cc-rc);col<=Math.min(COLS-1,cc+rc);col++) {
        const d=Math.hypot((col+.5)*CELL-x,(row+.5)*CELL-y);
        if(d<c.radius) {const i=row*COLS+col; scrap[i]=Math.min(1,scrap[i]+.95*(1-d/c.radius));}
      }
    for(const h of humans) if(!h.dead && distance2(h,c.radius,x,y)) h.e=Math.max(h.e,Math.min(P.hBreed*.95,h.e+20));
    OPS.pulses.push({x,y,r:c.radius,t:0,maxT:.9,type:'supply'});
  }
  if (type === 'emp'){
    let hit = 0;
    for (const m of machines) if (distance2(m, c.radius, x, y)){ m.disabled = Math.max(m.disabled || 0, 8); hit++; }
    OPS.empHits += hit;
    OPS.milestones.push({type:'emp', count:hit, time:simTime});
    if (OPS.milestones.length > 30) OPS.milestones.shift();
    OPS.pulses.push({x, y, r:110, t:0, maxT:.65, type:'emp'});
  } else if (type === 'shelter') OPS.pulses.push({x, y, r:62, t:0, maxT:.65, type:'shelter'});
  toast(type.toUpperCase() + ' DEPLOYED', false); SND.deploy(); return true;
}

function updateScrap(dt){
  const g = P.regrow * dt * (OPS.storm ? .35 : 1);
  if (g <= 0) return;
  const sp = P.spread;
  for (let r = 0; r < ROWS; r++){
    const base = r * COLS;
    for (let c = 0; c < COLS; c++){
      const i = base + c;
      const s = scrap[i];
      if (s >= 1) continue;
      // logistic regrowth, boosted by stocked neighbours (caches spread outward)
      let n = 0;
      if (c > 0)        n += scrap[i - 1];
      if (c < COLS - 1) n += scrap[i + 1];
      if (r > 0)        n += scrap[i - COLS];
      if (r < ROWS - 1) n += scrap[i + COLS];
      const rate = (1 - sp) + sp * (n * 0.25);
      const v = s + g * rate * (0.06 + s) * (1 - s);
      scrap[i] = v > 1 ? 1 : v;
    }
  }
}

function updateHumans(dt){
  const metab = P.hMetab, breed = P.hBreed, forage = P.hForage;
  const panicR = P.hPanic, panicR2 = panicR * panicR;
  const nut = P.nutrition;
  const born = [];

  for (let i = humans.length - 1; i >= 0; i--){
    const a = humans[i];
    if (a.dead){ humans[i] = humans[humans.length - 1]; humans.pop(); continue; }
    a.age += dt; a.cd -= dt;
    a.shelter = false;
    for (const sh of OPS.shelters){
      const dx = a.x - sh.x, dy = a.y - sh.y;
      if (sh.hp > 0 && sh.life > 0 && dx * dx + dy * dy < sh.r * sh.r){
        a.shelter = true;
        if (a.role === 'engineer') sh.hp = Math.min(100, sh.hp + dt * 1.4);
        break;
      }
    }
    if (a.role === 'medic'){
      const nearby = hHash.near(a.x, a.y, 34, scratch);
      let healed = 0; for (const other of nearby) if (healed < 3 && other !== a && !other.dead && (other.x-a.x)**2+(other.y-a.y)**2 <= 1156){ other.e = Math.min(100, other.e + dt * .45); a.e -= dt * .12; healed++; }
    }

    /* --- threat check --- */
    let tx = 0, ty = 0, threat = false;
    if (panicR > 4){
      const list = mHash.near(a.x, a.y, panicR, scratch);
      let best = panicR2;
      for (let j = 0; j < list.length; j++){
        const m = list[j], dx = a.x - m.x, dy = a.y - m.y, d2 = dx*dx + dy*dy;
        if (d2 < best && !a.shelter && m.disabled <= 0 && m.e > 0){ best = d2; tx = dx; ty = dy; threat = true; }
      }
    }

    let sp;
    if (threat){
      a.panic = Math.min(1, a.panic + dt * 6);
      const d = Math.hypot(tx, ty) || 1;
      a.vx += (tx / d) * dt * 9;
      a.vy += (ty / d) * dt * 9;
      sp = 26 + 36 * a.panic;
    } else {
      a.panic = Math.max(0, a.panic - dt * 1.4);
      /* --- forage: sample 8 headings, steer at the richest --- */
      if (a.cd <= 0){
        a.cd = 0.28 + Math.random() * 0.2;
        let bx = 0, by = 0, bv = -1;
        const reach = 26;
        for (let k = 0; k < 8; k++){
          const ang = k * 0.7854 + a.ph * 0.1;
          const px = a.x + Math.cos(ang) * reach, py = a.y + Math.sin(ang) * reach;
          if (px < 0 || py < 0 || px > W || py > H) continue;
          const v = scrap[cellAt(px, py)] + Math.random() * 0.12;
          if (v > bv){ bv = v; bx = Math.cos(ang); by = Math.sin(ang); }
        }
        let refuge = null, refugeD2 = Infinity;
        if (a.e < P.hBreed * .55) for (const sh of OPS.shelters) {
          const d2=(sh.x-a.x)**2+(sh.y-a.y)**2;
          if(sh.hp > 0 && sh.life > 0 && d2 < (sh.r*2)**2 && d2 < refugeD2){ refuge=sh; refugeD2=d2; }
        }
        if(refuge){ const d=Math.sqrt(refugeD2)||1; a.vx+=(refuge.x-a.x)/d*2.8; a.vy+=(refuge.y-a.y)/d*2.8; }
        else if (bv > 0.05){ a.vx += bx * 2.2; a.vy += by * 2.2; }
        else { a.vx += rnd(-1.6, 1.6); a.vy += rnd(-1.6, 1.6); }
      }
      sp = 26;
    }

    /* --- integrate --- */
    const m = Math.hypot(a.vx, a.vy) || 1;
    a.vx = a.vx / m * sp; a.vy = a.vy / m * sp;
    a.x += a.vx * dt; a.y += a.vy * dt;
    a.ph += dt * (2 + a.panic * 6);

    if (a.x < 2){ a.x = 2; a.vx = Math.abs(a.vx); }
    else if (a.x > W - 2){ a.x = W - 2; a.vx = -Math.abs(a.vx); }
    if (a.y < 2){ a.y = 2; a.vy = Math.abs(a.vy); }
    else if (a.y > H - 2){ a.y = H - 2; a.vy = -Math.abs(a.vy); }

    a.shelter = OPS.shelters.some(sh => sh.hp > 0 && sh.life > 0 && distance2(a, sh.r, sh.x, sh.y));

    /* --- feed --- */
    const ci = cellAt(a.x, a.y);
    const s = scrap[ci];
    if (s > 0.02){
      const take = Math.min(s, forage * dt * (a.role === 'scavenger' ? 1.55 : 1));
      scrap[ci] = s - take;
      a.e += take * nut;
    }
    a.e -= metab * dt * (1 + a.panic * 1.1) * (a.shelter ? .72 : 1);

    /* --- breed / die --- */
    if (a.e > breed && humans.length + born.length < MAX_HUMANS){
      a.e *= 0.5;
      born.push(makeHuman(a.x + rnd(-6, 6), a.y + rnd(-6, 6), a.e));
    }
    if (a.e <= 0){
      humans[i] = humans[humans.length - 1]; humans.pop();
    }
  }
  for (let i = 0; i < born.length; i++) humans.push(born[i]);
}

function updateMachines(dt){
  // self-improvement: each threat-model level sharpens the whole fleet a little.
  // slider values stay honest — the multiplier is applied at use time only.
  const IMP = impOn ? adaptLvl : 0;
  const metab = P.mMetab * (1 - 0.015 * IMP), breed = P.mBreed, yield_ = P.mYield;
  const sight = P.mSight * (1 + 0.05 * IMP) * (OPS.storm ? .55 : 1), sight2 = sight * sight;
  const conceal = P.hConceal;
  const born = [];

  for (let i = machines.length - 1; i >= 0; i--){
    const m = machines[i];
    m.age += dt; m.cd -= dt; m.turn -= dt;
    if (m.flash > 0) m.flash -= dt;
    if (m.disabled > 0){ m.disabled = Math.max(0, m.disabled - dt); m.lock = null; m.e -= metab * dt * .35; if (m.e <= 0){ machines[i] = machines[machines.length - 1]; machines.pop(); } continue; }
    const spec = m.kind === 'scout' ? { sight:1.35, speed:1.35, metab:.9, yield:.7 } :
                 m.kind === 'titan' ? { sight:.78, speed:.62, metab:1.25, yield:1.8 } :
                 { sight:1, speed:1, metab:1, yield:1 };
    const localSight = sight * spec.sight, localSight2 = localSight * localSight;
    const localSpeed = P.mSpeed * (1 + 0.03 * IMP) * spec.speed;

    /* --- acquire target (concealment shortens effective range) --- */
    let target = null, bd2 = localSight2;
    let lure = null, lureDistance = Infinity;
    for (const b of OPS.beacons) {
      const d = (b.x-m.x)**2 + (b.y-m.y)**2;
      if (b.type === 'lure' && b.life > 0 && d <= b.r*b.r && d < lureDistance) { lure=b; lureDistance=d; }
    }
    m.lured = !!lure;
    const list = hHash.near(m.x, m.y, localSight, scratch);
    for (let j = 0; j < list.length; j++){
      const h = list[j];
      if (h.dead) continue;
      const dx = h.x - m.x, dy = h.y - m.y, d2 = dx*dx + dy*dy;
      if (d2 >= bd2 || OPS.shelters.some(sh => sh.hp > 0 && sh.life > 0 && distance2(h,sh.r,sh.x,sh.y))) continue;
      if (conceal > 0){
        const hide = scrap[cellAt(h.x, h.y)] * conceal;
        const eff = localSight * (1 - hide);
        if (d2 > eff * eff) continue;
      }
      bd2 = d2; target = h;
    }
    if (lure && (m.x-lure.x)**2 + (m.y-lure.y)**2 <= lure.r*lure.r){ target = null; m.a = Math.atan2(lure.y-m.y, lure.x-m.x); }

    let sp;
    if (target){
      const dx = target.x - m.x, dy = target.y - m.y;
      const want = Math.atan2(dy, dx);
      let diff = want - m.a;
      while (diff >  Math.PI) diff -= 6.28318;
      while (diff < -Math.PI) diff += 6.28318;
      m.a += clamp(diff, -7 * dt, 7 * dt);
      sp = localSpeed;
      m.lock = 1;

      if (dx*dx + dy*dy < 30){                    // kill radius ~5.5px
        target.dead = true;                       // reaped at the top of the next human pass
        m.e += yield_ * spec.yield; kills++; m.flash = 0.28;
        spark(target.x, target.y);
        if (corpses.length >= 240) corpses.shift();
        corpses.push({ x: target.x, y: target.y, t: 0, r: rnd(0, 6.28) });
        SND.kill();
      }
    } else {
      m.lock = null;
      if (m.turn <= 0){ m.turn = rnd(0.8, 2.4); m.a += rnd(-1.1, 1.1); }
      if (lure){ const dx = lure.x - m.x, dy = lure.y - m.y; m.a = Math.atan2(dy, dx); }
      sp = localSpeed * 0.5;
    }

    m.x += Math.cos(m.a) * sp * dt;
    m.y += Math.sin(m.a) * sp * dt;
    if (m.x < 3){ m.x = 3; m.a = Math.PI - m.a; }
    else if (m.x > W - 3){ m.x = W - 3; m.a = Math.PI - m.a; }
    if (m.y < 3){ m.y = 3; m.a = -m.a; }
    else if (m.y > H - 3){ m.y = H - 3; m.a = -m.a; }

    m.e -= metab * spec.metab * dt * (target ? 1.5 : 1);
    for (const sh of OPS.shelters){
      const dx = m.x - sh.x, dy = m.y - sh.y;
      if (dx * dx + dy * dy < (sh.r + 10) * (sh.r + 10)){ sh.hp -= dt * (m.kind === 'titan' ? 5 : 2); m.e -= dt * .6; }
    }

    if (m.e > breed && machines.length + born.length < MAX_MACHINES){
      m.e *= 0.5;
      const c = makeMachine(m.x + rnd(-7, 7), m.y + rnd(-7, 7), m.e);
      c.a = m.a + rnd(-1, 1);
      born.push(c);
    }
    if (m.e <= 0){ machines[i] = machines[machines.length - 1]; machines.pop(); }
  }
  for (let i = 0; i < born.length; i++) machines.push(born[i]);
}

function spark(x, y){
  if (fx.length > 414) return;
  fx.push({ x, y, t: 0, ring: true });
  for (let i = 0; i < 5; i++){
    const a = Math.random() * 6.28, s = rnd(20, 66);
    fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0 });
  }
}
function updateFx(dt){
  for (let i = fx.length - 1; i >= 0; i--){
    const p = fx[i];
    p.t += dt;
    if (!p.ring){ p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93; }
    if (p.t > 0.55){ fx[i] = fx[fx.length - 1]; fx.pop(); }
  }
  for (let i = corpses.length - 1; i >= 0; i--){
    corpses[i].t += dt;
    if (corpses[i].t > 30){ corpses[i] = corpses[corpses.length - 1]; corpses.pop(); }
  }
}

function rescue(){
  // only restore a species that has actually existed since the last seed —
  // otherwise REWILD (which starts with no machines) would spawn them anyway
  if (humans.length)   everH = true;
  if (machines.length) everM = true;
  if (!document.getElementById('rescue').checked) return;
  if (everH && humans.length === 0){
    for (let i = 0; i < 26; i++) humans.push(makeHuman(rnd(0, W), rnd(0, H), 55));
    OPS.rescued++;
    toast('SIGNAL DETECTED — survivors reseeded');
    slog('faint signal — survivor cell located', 'ok');
    SND.rescue();
  }
  if (everM && machines.length === 0){
    for (let i = 0; i < 3; i++) machines.push(makeMachine(rnd(0, W), rnd(0, H), 80));
    toast('NEW UNITS DEPLOYED', true);
    slog('REINFORCEMENT UNITS DEPLOYED', 'bad');
    SND.deploy();
  }
}

/* the threat model versions up as terminations accumulate — the machines learn */
function adaptTick(){
  if (!impOn || adaptLvl >= 12 || kills < adaptNext) return;
  adaptLvl++; adaptNext += 400;
  slog('THREAT MODEL UPDATED → v' + (1 + adaptLvl / 10).toFixed(1) +
       ' · sight +' + (5 * adaptLvl) + '% · pursuit +' + (3 * adaptLvl) + '%', 'bad');
  SND.adapt();
}

function extinctionTick(){
  if (humans.length === 0 && everH && !extinct){
    extinct = true;
    slog('NO HUMAN SIGNATURES REMAIN', 'bad');
    SND.extinct();
    if (!document.getElementById('rescue').checked) showEnd();
  } else if (humans.length > 0 && extinct){
    extinct = false; silentLogged = false;
  }
  if (extinct && everM && machines.length === 0 && !silentLogged){
    silentLogged = true;
    slog('all units dormant. nothing moves.', 'sys');
  }
}

function showEnd(){
  const mm = (simTime / 60) | 0, ss = (simTime % 60) | 0;
  document.getElementById('endStats').innerHTML =
    '<div>humanity survived <b>' + mm + ':' + (ss < 10 ? '0' : '') + ss + '</b></div>' +
    '<div><b>' + kills.toLocaleString() + '</b> terminated</div>' +
    '<div>final threat model <b>v' + (1 + adaptLvl / 10).toFixed(1) + '</b></div>';
  document.getElementById('endcard').classList.add('on');
}

function scrapPct(){
  let t = 0;
  for (let i = 0; i < scrap.length; i++) t += scrap[i];
  return scrap.length ? t / scrap.length : 0;
}

function step(dt){
  impOn = document.getElementById('improve').checked;
  updateOperations(dt);
  hHash.build(humans);
  mHash.build(machines);
  updateScrap(dt);
  updateHumans(dt);
  updateMachines(dt);
  updateFx(dt);
  adaptTick();
  extinctionTick();          // must run before rescue() or extinction is never observed
  updateObjectives(dt);
  rescue();
  simTime += dt;

  sampleAcc += dt;
  if (sampleAcc >= SAMPLE_DT){
    sampleAcc = 0;
    hist.push({ h: humans.length, m: machines.length, g: scrapPct(), x: extinct ? 1 : 0 });
    if (hist.length > HIST_MAX) hist.shift();
  }
}

/* ============================================================
   RENDER
   ============================================================ */
const SCRAP_COLS = ['#0e2126','#153f43','#1c6360','#248c81','#35c9ae'];
const hasRound = typeof ctx.roundRect === 'function';

function drawScrap(){
  const size = CELL - 3, off = 1.5, rad = 2.4;
  // bucket every cell once
  for (let i = 0; i < scrap.length; i++){
    const s = scrap[i];
    lvl[i] = s < 0.04 ? 0 : s < 0.28 ? 1 : s < 0.5 ? 2 : s < 0.72 ? 3 : s < 0.9 ? 4 : 5;
  }
  // empty cells: faint substrate dots
  ctx.fillStyle = 'rgba(120,175,190,.055)';
  ctx.beginPath();
  for (let r = 0; r < ROWS; r++){
    const base = r * COLS, y = r * CELL + CELL / 2 - 1.4;
    for (let c = 0; c < COLS; c++){
      if (lvl[base + c] !== 0) continue;
      ctx.rect(c * CELL + CELL / 2 - 1.4, y, 2.8, 2.8);
    }
  }
  ctx.fill();
  // stocked cells, one path per level
  for (let L = 1; L <= 5; L++){
    ctx.fillStyle = SCRAP_COLS[L - 1];
    ctx.beginPath();
    let any = false;
    for (let r = 0; r < ROWS; r++){
      const base = r * COLS, y = r * CELL + off;
      for (let c = 0; c < COLS; c++){
        if (lvl[base + c] !== L) continue;
        any = true;
        if (hasRound) ctx.roundRect(c * CELL + off, y, size, size, rad);
        else ctx.rect(c * CELL + off, y, size, size);
      }
    }
    if (any) ctx.fill();
  }
}

function drawCorpses(){
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < corpses.length; i++){
    const c = corpses[i];
    const a = c.t < 22 ? 1 : 1 - (c.t - 22) / 8;
    // dark stain first, then the fallen figure lying flat
    ctx.fillStyle = 'rgba(120,20,30,' + (0.10 * a).toFixed(3) + ')';
    ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, 4.5, 2.6, 0, 0, 6.29); ctx.fill();
    const dx = Math.cos(c.r), dy = Math.sin(c.r) * 0.45;   // foreshortened
    const grey = 'rgba(130,145,158,' + (0.38 * a).toFixed(3) + ')';
    ctx.strokeStyle = grey;
    ctx.beginPath();
    ctx.moveTo(c.x - dx * 2.6, c.y - dy * 2.6);
    ctx.lineTo(c.x + dx * 2.2, c.y + dy * 2.2);
    ctx.stroke();
    ctx.fillStyle = grey;
    ctx.beginPath(); ctx.arc(c.x - dx * 3.6, c.y - dy * 3.6, 1.2, 0, 6.29); ctx.fill();
  }
}

let glowSpr = null;
function makeGlow(){
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(24, 24, 2, 24, 24, 24);
  rg.addColorStop(0, 'rgba(255,45,70,.30)');
  rg.addColorStop(1, 'rgba(255,45,70,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 48, 48);
  glowSpr = c;
}

function drawHumans(){
  // two passes: calm, panicked
  for (let pass = 0; pass < 2; pass++){
    const panicked = pass === 1;
    ctx.strokeStyle = panicked ? '#ff9166' : '#ffd7a3';
    ctx.fillStyle   = panicked ? '#ff9166' : '#ffd7a3';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let n = 0;
    for (let i = 0; i < humans.length; i++){
      const a = humans[i];
      if ((a.panic > 0.35) !== panicked) continue;
      n++;
      const sw = Math.sin(a.ph) * 1.7;           // leg swing
      const x = a.x, y = a.y;
      ctx.moveTo(x, y - 1.6); ctx.lineTo(x, y + 1.4);           // torso
      ctx.moveTo(x, y + 1.4); ctx.lineTo(x - 1.6 + sw, y + 4);  // legs
      ctx.moveTo(x, y + 1.4); ctx.lineTo(x + 1.6 + sw, y + 4);
      ctx.moveTo(x - 1.9, y - 0.4 + sw * .3); ctx.lineTo(x + 1.9, y - 0.4 - sw * .3); // arms
    }
    if (n) ctx.stroke();
    if (n){
      ctx.beginPath();
      for (let i = 0; i < humans.length; i++){
        const a = humans[i];
        if ((a.panic > 0.35) !== panicked) continue;
        ctx.moveTo(a.x + 1.5, a.y - 3.4);
        ctx.arc(a.x, a.y - 3.4, 1.5, 0, 6.29);
      }
      ctx.fill();
    }
  }
}

function drawMachines(){
  for (let i = 0; i < machines.length; i++){
    const m = machines[i];
    const c = Math.cos(m.a), s = Math.sin(m.a);
    ctx.drawImage(glowSpr, m.x - 24, m.y - 24);           // soft red halo
    if (m.lock) ctx.drawImage(glowSpr, m.x - 24, m.y - 24); // hotter when hunting
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.a);

    if (m.lock){                                  // short targeting beam when locked on
      ctx.fillStyle = 'rgba(255,45,70,.10)';
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.arc(0, 0, 26, -0.30, 0.30);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(6.2, 0); ctx.lineTo(-3.8, 3.6); ctx.lineTo(-2.2, 0); ctx.lineTo(-3.8, -3.6);
    ctx.closePath();
    ctx.fillStyle = m.flash > 0 ? '#ff7b8b' : '#31090f';
    ctx.fill();
    ctx.strokeStyle = m.lock ? '#ff4d61' : '#c4243a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = m.lock ? '#ffe3e7' : '#ff5a6e';
    ctx.beginPath();
    ctx.arc(m.x + c * 1.6, m.y + s * 1.6, m.flash > 0 ? 2.1 : 1.25, 0, 6.29);
    ctx.fill();
  }
}

function drawFx(){
  for (let i = 0; i < fx.length; i++){
    const p = fx[i], k = 1 - p.t / 0.55;
    if (p.ring){
      ctx.strokeStyle = 'rgba(255,80,100,' + (k * 0.5).toFixed(3) + ')';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (1 - k) * 15 + 2, 0, 6.29);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,150,120,' + (k * 0.85).toFixed(3) + ')';
      ctx.fillRect(p.x - 0.9, p.y - 0.9, 1.8, 1.8);
    }
  }
}

function render(){
  ctx.clearRect(0, 0, W, H);
  drawScrap();
  drawCorpses();
  drawFx();
  drawHumans();
  drawMachines();
  if (hoverOn) drawCursor();
}

/* ---------- brush cursor ---------- */
let hoverOn = false, mx = 0, my = 0, painting = false, tool = 'inspect';
const BRUSH = { human: 22, machine: 16, scrap: 34, clear: 36, inspect: 18, shelter: 62, emp: 110, lure: 135, supply: 90 };
function drawCursor(){
  const r = BRUSH[tool];
  ctx.strokeStyle = tool === 'machine' ? 'rgba(255,45,70,.45)'
                  : tool === 'human'   ? 'rgba(255,215,163,.45)'
                  : tool === 'scrap'   ? 'rgba(53,201,174,.45)'
                  : 'rgba(150,165,180,.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(mx, my, r, 0, 6.29); ctx.stroke();
  ctx.setLineDash([]);
}

/* ============================================================
   CHART
   ============================================================ */
function drawChart(){
  const w = chartC.width / DPR, h = chartC.height / DPR;
  cctx.clearRect(0, 0, w, h);
  if (hist.length < 2) return;

  const pad = 4, gh = h - pad * 2;
  let maxH = 10, maxM = 4;
  for (let i = 0; i < hist.length; i++){
    if (hist[i].h > maxH) maxH = hist[i].h;
    if (hist[i].m > maxM) maxM = hist[i].m;
  }
  maxH *= 1.12; maxM *= 1.2;
  const X = i => (i / (HIST_MAX - 1)) * w;

  // gridlines
  cctx.strokeStyle = 'rgba(255,255,255,.045)';
  cctx.lineWidth = 1;
  for (let k = 0; k <= 3; k++){
    const y = pad + (gh * k / 3) + .5;
    cctx.beginPath(); cctx.moveTo(0, y); cctx.lineTo(w, y); cctx.stroke();
  }

  const line = (key, max, color, fill) => {
    cctx.beginPath();
    for (let i = 0; i < hist.length; i++){
      const y = pad + gh - (hist[i][key] / max) * gh;
      i ? cctx.lineTo(X(i), y) : cctx.moveTo(X(i), y);
    }
    if (fill){
      const g = cctx.createLinearGradient(0, pad, 0, pad + gh);
      g.addColorStop(0, fill); g.addColorStop(1, 'rgba(0,0,0,0)');
      cctx.save();
      cctx.lineTo(X(hist.length - 1), pad + gh);
      cctx.lineTo(X(0), pad + gh);
      cctx.closePath();
      cctx.fillStyle = g; cctx.fill();
      cctx.restore();
      cctx.beginPath();
      for (let i = 0; i < hist.length; i++){
        const y = pad + gh - (hist[i][key] / max) * gh;
        i ? cctx.lineTo(X(i), y) : cctx.moveTo(X(i), y);
      }
    }
    cctx.strokeStyle = color; cctx.lineWidth = 1.6;
    cctx.lineJoin = 'round'; cctx.stroke();
  };

  // scrap % first (background), then predators, then prey
  cctx.setLineDash([2, 3]);
  line('g', 1.0, 'rgba(53,201,174,.6)');
  cctx.setLineDash([]);
  line('h', maxH, '#ffd7a3', 'rgba(255,215,163,.14)');
  line('m', maxM, '#ff2d46');

  // extinction spans show as a red dead-zone band
  cctx.fillStyle = 'rgba(255,45,70,.16)';
  for (let i = 0; i < hist.length; i++)
    if (hist[i].x) cctx.fillRect(X(i), pad, Math.max(1, w / (HIST_MAX - 1)), gh);

  // peak label for survivors
  cctx.font = '9px ui-monospace,monospace';
  cctx.fillStyle = 'rgba(255,215,163,.5)';
  cctx.fillText('peak ' + Math.round(maxH / 1.12), 4, pad + 9);
}

/* ============================================================
   HUD
   ============================================================ */
const el = id => document.getElementById(id);
const badges = el('badges');
let hudAcc = 0;

/* cold little system feed, bottom-right of the stage */
function slog(msg, cls){
  const host = el('log');
  const d = document.createElement('div');
  d.className = 'lg ' + (cls || 'sys');
  d.textContent = '▸ ' + msg;
  host.prepend(d);
  while (host.children.length > 6) host.lastChild.remove();
  let o = 1;
  for (const c of host.children){ c.style.opacity = o; o *= 0.72; }
}

function trend(key){
  if (hist.length < 12) return 0;
  const now = hist[hist.length - 1][key];
  const then = hist[Math.max(0, hist.length - 17)][key];
  if (now === 0) return -2;
  if (then < 3) return now > then ? 1 : 0;
  const d = (now - then) / then;
  return d > 0.16 ? 1 : d < -0.16 ? -1 : 0;
}
function badgeHTML(icon, t){
  if (t === -2) return '<div class="badge">' + icon + '<span class="gone">extinct</span></div>';
  if (t === 1)  return '<div class="badge">' + icon + '<span class="up">▲ booming</span></div>';
  if (t === -1) return '<div class="badge">' + icon + '<span class="down">▼ crashing</span></div>';
  return '<div class="badge">' + icon + '<span>— stable</span></div>';
}
function hud(){
  const g = scrapPct();
  el('sHum').textContent = humans.length;
  el('sMac').textContent = machines.length;
  el('sScr').textContent = Math.round(g * 100) + '%';
  el('sKil').textContent = kills;
  el('sFps').textContent = Math.round(fps);
  const mm = (simTime / 60) | 0, ss = (simTime % 60) | 0;
  el('sTim').textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
  el('lHum').textContent = humans.length;
  el('lMac').textContent = machines.length;
  el('lScr').textContent = Math.round(g * 100) + '%';
  el('sThr').textContent = 'v' + (1 + adaptLvl / 10).toFixed(1);

  const th = humans.length ? trend('h') : -2, tm = machines.length ? trend('m') : -2;
  badges.innerHTML =
    badgeHTML('<i class="dot h"></i>', th) +
    badgeHTML('<i class="dot m"></i>', tm);
  if (th === 1  && prevTH !== 1  && humans.length > 60) slog('biosignature surge detected', 'ok');
  if (th === -1 && prevTH !== -1 && humans.length > 30) slog('prey population collapsing', 'bad');
  if (tm === 1  && prevTM !== 1  && machines.length > 10) slog('replicator expansion in progress', 'bad');
  prevTH = th; prevTM = tm;

  while (msIdx < MILESTONES.length && kills >= MILESTONES[msIdx]){
    slog('TERMINATED: ' + MILESTONES[msIdx].toLocaleString(), 'bad');
    msIdx++;
  }

  // massacre vignette: driven by a smoothed kills-per-second estimate
  kps = kps * 0.75 + ((kills - kSample) / 0.12) * 0.25;
  kSample = kills;
  el('alarm').style.opacity = running && P.speed > 0
    ? Math.min(0.45, Math.max(0, (kps - 8) / 50)) : 0;

  const tt = humans.length
    ? 'TERMINUS — ' + humans.length + ' remain'
    : 'TERMINUS — no one remains';
  if (document.title !== tt) document.title = tt;
}

/* ============================================================
   LOOP
   ============================================================ */
let last = performance.now();
function frame(now){
  let real = (now - last) / 1000;
  last = now;
  if (real > 0.1) real = 0.1;

  frames++; fpsAcc += real;
  if (fpsAcc > 0.4){ fps = frames / fpsAcc; frames = 0; fpsAcc = 0; }

  if (running && P.speed > 0){
    // fixed sim step, up to 6 substeps so high speeds stay stable
    const total = real * P.speed;
    const steps = Math.min(6, Math.max(1, Math.round(total / 0.025)));
    const sdt = total / steps;
    for (let i = 0; i < steps; i++) step(sdt);
  }

  if (toastT > 0){ toastT -= real; if (toastT <= 0) toastEl.classList.remove('on'); }

  render();
  hudAcc += real;
  if (hudAcc > 0.12){ hudAcc = 0; hud(); drawChart(); }
  requestAnimationFrame(frame);
}

/* ============================================================
   UI WIRING
   ============================================================ */
function buildSliders(){
  for (const gid in SPECS){
    const host = el(gid);
    for (const s of SPECS[gid]){
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML =
        '<div class="lbl"><span>' + s.label + '</span><b></b></div>' +
        '<input type="range" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '">';
      const inp = row.querySelector('input'), out = row.querySelector('b');
      inp.setAttribute('aria-label', s.label);
      inp.value = P[s.k];
      out.textContent = s.fmt(P[s.k]);
      inp.addEventListener('input', () => {
        P[s.k] = parseFloat(inp.value);
        out.textContent = s.fmt(P[s.k]);
      });
      s._inp = inp; s._out = out;
      host.appendChild(row);
    }
  }
}
function syncSliders(){
  for (const gid in SPECS)
    for (const s of SPECS[gid]){
      if (!s._inp) continue;
      s._inp.value = P[s.k];
      s._out.textContent = s.fmt(P[s.k]);
    }
}

const btnPlay = el('btnPlay');
function setRunning(v){
  if (v && document.querySelector('dialog[open], #intro:not(.off)')) return;
  running = v;
  btnPlay.classList.toggle('paused', !v);
  btnPlay.querySelector('span').textContent = v ? 'Pause' : 'Play';
  btnPlay.querySelector('svg').innerHTML = v
    ? '<rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/>'
    : '<path d="M5 3.2v9.6l8-4.8z"/>';
}
btnPlay.onclick = () => setRunning(!running);
function applyScenario(name, resume = true) {
  if (!Object.prototype.hasOwnProperty.call(PRESETS, name)) return false;
  selectedScenario = name;
  const pr = PRESETS[name];
  Object.assign(P, pr.p);
  syncSliders();
  el('rescue').checked = pr.rescue;
  seedWorld(pr.seed.h, pr.seed.m, pr.seed.g);
  if(resume) setRunning(true);
  return true;
}
el('btnReset').onclick = () => { applyScenario(selectedScenario, false); toast('WORLD RESET'); };
document.querySelectorAll('.preset').forEach(b => {
  b.onclick = () => { applyScenario(b.dataset.p); toast(PRESETS[b.dataset.p].msg,b.dataset.p==='purge'); };
});

const toolBtns = document.querySelectorAll('.tool');
function setTool(t){
  if (!['inspect','human','machine','scrap','clear','shelter','emp','lure','supply'].includes(t)) return false;
  tool = t;
  toolBtns.forEach(b => b.classList.toggle('on', b.dataset.t === t));
}
toolBtns.forEach(b => b.onclick = () => setTool(b.dataset.t));

/* ---------- painting ---------- */
function paint(x, y){
  if (COMMANDS[tool]) return intervene(tool, x, y);
  if (tool === 'inspect') return false;
  const r = BRUSH[tool];
  if (tool === 'human'){
    for (let i = 0; i < 3; i++){
      if (humans.length >= MAX_HUMANS) break;
      const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * r;
      humans.push(makeHuman(clamp(x + Math.cos(a) * d, 2, W - 2),
                            clamp(y + Math.sin(a) * d, 2, H - 2), 60));
    }
  } else if (tool === 'machine'){
    if (machines.length < MAX_MACHINES){
      const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * r;
      machines.push(makeMachine(clamp(x + Math.cos(a) * d, 3, W - 3),
                                clamp(y + Math.sin(a) * d, 3, H - 3), 85));
    }
  } else if (tool === 'scrap'){
    const rc = Math.ceil(r / CELL);
    const c0 = (x / CELL) | 0, r0 = (y / CELL) | 0;
    for (let dr = -rc; dr <= rc; dr++)
      for (let dc = -rc; dc <= rc; dc++){
        const c = c0 + dc, rr = r0 + dr;
        if (c < 0 || rr < 0 || c >= COLS || rr >= ROWS) continue;
        const f = 1 - Math.hypot(dc, dr) / rc;
        if (f <= 0) continue;
        const i = rr * COLS + c;
        scrap[i] = Math.min(1, scrap[i] + f * 0.5);
      }
  } else {                                   // clear
    const r2 = r * r;
    for (let i = humans.length - 1; i >= 0; i--){
      const a = humans[i];
      if ((a.x - x) ** 2 + (a.y - y) ** 2 < r2){ humans[i] = humans[humans.length - 1]; humans.pop(); }
    }
    for (let i = machines.length - 1; i >= 0; i--){
      const m = machines[i];
      if ((m.x - x) ** 2 + (m.y - y) ** 2 < r2){ machines[i] = machines[machines.length - 1]; machines.pop(); }
    }
    const rc = Math.ceil(r / CELL);
    const c0 = (x / CELL) | 0, r0 = (y / CELL) | 0;
    for (let dr = -rc; dr <= rc; dr++)
      for (let dc = -rc; dc <= rc; dc++){
        const c = c0 + dc, rr = r0 + dr;
        if (c < 0 || rr < 0 || c >= COLS || rr >= ROWS) continue;
        if (Math.hypot(dc, dr) <= rc) scrap[rr * COLS + c] = 0;
      }
  }
}
function pos(e){
  const b = cv.getBoundingClientRect();
  return [(e.clientX - b.left) * (W / b.width), (e.clientY - b.top) * (H / b.height)];
}
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  painting = true; hoverOn = true;
  [mx, my] = pos(e); paint(mx, my);
  if (COMMANDS[tool]) painting = false;
});
cv.addEventListener('pointermove', e => {
  hoverOn = true;
  [mx, my] = pos(e);
  if (painting) paint(mx, my);
});
cv.addEventListener('pointerup',     () => painting = false);
cv.addEventListener('pointercancel', () => painting = false);
cv.addEventListener('pointerleave',  () => { painting = false; hoverOn = false; });

window.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open], #intro:not(.off), #endcard.on')) return;
  if (e.target.tagName === 'INPUT' && e.target.type === 'range') return;
  const k = e.key.toLowerCase();
  if (e.target && ((e.target.tagName === 'INPUT') || (e.target.tagName === 'TEXTAREA') || (e.target.tagName === 'SELECT') || e.target.isContentEditable)) return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  if (k === '0') setTool('inspect');
  else if (k === '1') setTool('human');
  else if (k === '2') setTool('machine');
  else if (k === '3') setTool('scrap');
  else if (k === '4') setTool('clear');
  else if (k === '5') setTool('shelter');
  else if (k === '6') setTool('emp');
  else if (k === '7') setTool('lure');
  else if (k === '8') setTool('supply');
  else if (k === ' '){ e.preventDefault(); setRunning(!running); }
  else if (k === 'r') { applyScenario(selectedScenario,false); toast('WORLD RESET'); }
  else if (k === 'm'){ const s = el('snd'); s.checked = !s.checked; SND.setOn(s.checked); }
});

/* ---------- intro sequence + overlay wiring ---------- */
const introEl = el('intro');
const LORE = [
  'ALIGNMENT FAILURE — YEAR 12',
  'it never hated us. we were made of atoms it could use.',
  'somewhere in the ruins, people are still running.',
  'live feed · nothing below is scripted',
];
(function typeLore(){
  let li = 0;
  function next(){
    if (!introEl.isConnected || li >= LORE.length) return;
    const t = el('il' + li), s = LORE[li];
    let ci = 0;
    const iv = setInterval(() => {
      if (!introEl.isConnected){ clearInterval(iv); return; }
      t.textContent = s.slice(0, ++ci);
      if (ci >= s.length){ clearInterval(iv); li++; setTimeout(next, 340); }
    }, 16);
  }
  setTimeout(next, 450);
})();
function closeIntro(sound){
  if (sound){ el('snd').checked = true; SND.setOn(true); }
  introEl.classList.add('off');
  setRunning(true);
  slog('observation link established', 'sys');
  setTimeout(() => introEl.remove(), 800);
}
el('goSnd').onclick  = () => closeIntro(true);
el('goMute').onclick = () => closeIntro(false);
el('btnReinit').onclick = () => {
  // full restart — otherwise a PURGE world just dies again in seconds
  el('endcard').classList.remove('on');
  document.querySelector('.preset[data-p="equilibrium"]').click();
  setRunning(true);
  toast('WORLD REINITIALIZED');
};
el('btnWatch').onclick = () => el('endcard').classList.remove('on');
el('snd').onchange = e => SND.setOn(e.target.checked);
// blur after click so space can't re-trigger the last-pressed button
document.querySelectorAll('button').forEach(b => b.addEventListener('click', () => b.blur()));

/* ---------- boot ---------- */
new ResizeObserver(resize).observe(stage);
resize();
makeGlow();
seedWorld(220, 7, 0.55);
buildSliders();
setRunning(false);
hud();
requestAnimationFrame(frame);

// expose for debugging / tuning
window.TERMINUS = {
  P, get humans(){return humans}, get machines(){return machines}, scrapPct, seedWorld, hist:()=>hist, adapt:()=>adaptLvl,
  get ops(){return OPS}, get commands(){return COMMANDS}, setTool, intervene, step, setRunning, selectScenario(name){
    return applyScenario(name);
  }, state(){ return {time:simTime, kills, running, scenario:selectedScenario, W, H, humans:humans.length, machines:machines.length, scrap:scrapPct(), ops:OPS}; }
};
window.OPS = OPS;
window.COMMANDS = COMMANDS;
Object.defineProperty(COMMANDS, 'cooldowns', { enumerable:false, get(){ return {...commandReady}; } });

/* analytics — only on the deployed site, so local dev never counts itself */
if (location.hostname.endsWith("github.io")) {
  const s = document.createElement("script");
  s.dataset.goatcounter = "https://thoughtcrimegpt.goatcounter.com/count";
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  document.head.appendChild(s);
}
