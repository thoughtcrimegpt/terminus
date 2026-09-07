#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

function loadPlaywright() {
  try { return require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
  catch (e) {
    const fallback = '/Users/mattgrogan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
    return require(fallback);
  }
}
const { chromium } = loadPlaywright();
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8767';
const executablePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function settle(page, ms = 80) { await page.waitForTimeout(ms); }
async function pause(page) { await page.evaluate(() => window.TERMINUS.setRunning(false)); }
async function fresh(page, h = 12, m = 2, g = .6) {
  await page.evaluate(({ h, m, g }) => { window.TERMINUS.selectScenario('equilibrium'); window.TERMINUS.seedWorld(h, m, g); window.TERMINUS.setRunning(false); }, { h, m, g });
  await settle(page);
}
async function point(page) { await page.locator('#world').scrollIntoViewIfNeeded(); return page.locator('#world').boundingBox(); }
async function clickWorld(page, x = .5, y = .5) {
  const b = await point(page); await page.mouse.click(b.x + b.width * x, b.y + b.height * y);
}
async function dragWorld(page, x1 = .25, y1 = .5, x2 = .75, y2 = .5) {
  const b = await point(page); const p = (x, y) => [b.x + b.width * x, b.y + b.height * y];
  const [ax, ay] = p(x1, y1), [bx, by] = p(x2, y2);
  await page.mouse.move(ax, ay); await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(ax + (bx - ax) * i / 5, ay + (by - ay) * i / 5);
  await page.mouse.up();
}

test('intro starts paused and can be dismissed', async page => {
  assert.equal(await page.locator('#intro').count(), 1);
  assert.equal(await page.evaluate(() => window.TERMINUS.state().running), false);
  await page.locator('#goMute').click();
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#intro').count(), 0);
  assert.equal(await page.evaluate(() => window.TERMINUS.state().running), true);
  await pause(page);
});

test('keyboard 0 through 8 selects every tool', async page => {
  for (let i = 0; i <= 8; i++) {
    await page.keyboard.press(String(i));
    assert.equal(await page.locator('.tool.on').getAttribute('data-t'), ['inspect','human','machine','scrap','clear','shelter','emp','lure','supply'][i]);
  }
  await page.keyboard.press('0');
});

test('ecosystem brushes place and clear entities/resources', async page => {
  await fresh(page, 0, 0, 0);
  await page.keyboard.press('1'); await dragWorld(page); let s = await page.evaluate(() => window.TERMINUS.state());
  assert.ok(s.humans >= 3, `human brush added ${s.humans}`);
  await page.keyboard.press('2'); await dragWorld(page, .45, .5, .55, .5); s = await page.evaluate(() => window.TERMINUS.state());
  assert.ok(s.machines >= 1, `machine brush added ${s.machines}`);
  await page.keyboard.press('3'); await clickWorld(page); const scrapAfter = await page.evaluate(() => window.TERMINUS.state().scrap); assert.ok(scrapAfter > 0);
  await page.evaluate(() => { for (const a of humans) { a.x = W / 2; a.y = H / 2; } for (const a of machines) { a.x = W / 2; a.y = H / 2; } });
  await page.keyboard.press('4'); await clickWorld(page); s = await page.evaluate(() => window.TERMINUS.state()); assert.equal(s.humans, 0); assert.equal(s.machines, 0);
});

test('commands charge power and reject cooldown or insufficient credits', async page => {
  await fresh(page, 10, 2, .6);
  const result = await page.evaluate(() => {
    const before = OPS.credits; const first = TERMINUS.intervene('shelter', 100, 100); const after = OPS.credits;
    const second = TERMINUS.intervene('shelter', 120, 100); OPS.credits = 1; const third = TERMINUS.intervene('emp', 100, 100);
    return { before, after, first, second, third, shelters: OPS.shelters.length, cooldown: COMMANDS.cooldowns.shelter };
  });
  assert.equal(result.first, true); assert.equal(result.second, false); assert.equal(result.third, false);
  assert.equal(result.shelters, 1); assert.equal(result.after, result.before - COMMANDS_COST('shelter')); assert.ok(result.cooldown > 0);
});
function COMMANDS_COST(k) { return ({ shelter: 40, emp: 30, lure: 20, supply: 25 })[k]; }

test('shelter protects survivors, takes damage, then expires', async page => {
  await fresh(page, 1, 1, .7);
  const result = await page.evaluate(() => {
    document.getElementById('rescue').checked = false;
    humans[0].x = machines[0].x = 200; humans[0].y = machines[0].y = 160; humans[0].e = 80;
    TERMINUS.intervene('shelter', 200, 160); step(.2);
    const protectedState = { shelter: humans[0].shelter, hp: OPS.shelters[0]?.hp };
    OPS.shelters[0].hp = 0; step(.05); return { protectedState, shelters: OPS.shelters.length };
  });
  assert.equal(result.protectedState.shelter, true); assert.ok(result.protectedState.hp < 100); assert.equal(result.shelters, 0);
});

test('EMP disables machines without movement or kills and recovers', async page => {
  await fresh(page, 1, 1, .5);
  const result = await page.evaluate(() => {
    document.getElementById('rescue').checked = false;
    humans[0].x = 220; humans[0].y = 160; humans[0].e = 80; machines[0].x = 220; machines[0].y = 160;
    const x = machines[0].x, y = machines[0].y; const ok = TERMINUS.intervene('emp', x, y); step(.5);
    const disabled = { d: machines[0]?.disabled, x: machines[0]?.x, humans: humans.length };
    step(8.1); return { ok, disabled, recovered: machines[0]?.disabled || 0, machines: machines.length };
  });
  assert.equal(result.ok, true); assert.ok(result.disabled.d > 0); assert.equal(result.disabled.x, 220); assert.ok(result.disabled.humans >= 1); assert.equal(result.recovered, 0); assert.ok(result.machines >= 1);
});

test('lure redirects a nearby machine and supply replenishes scrap', async page => {
  await fresh(page, 1, 1, 0);
  const result = await page.evaluate(() => {
    humans[0].x = 280; humans[0].y = 180; machines[0].x = 100; machines[0].y = 180; machines[0].a = Math.PI;
    const lure = TERMINUS.intervene('lure', 220, 180); step(.1); const toward = machines[0].lock === null && machines[0].a > -0.2 && machines[0].a < 0.2;
    const before = scrapPct(); TERMINUS.intervene('supply', 280, 180); step(.5); return { lure, toward, before, after: scrapPct() };
  });
  assert.equal(result.lure, true); assert.equal(result.toward, true); assert.ok(result.after > result.before);
});

test('objectives latch, storms start and end, and state stays finite', async page => {
  await fresh(page, 4, 1, .4);
  const result = await page.evaluate(() => {
    OPS.objectives[0].done = true; OPS.nextStorm = 0; step(.1); const active = OPS.storm;
    step(12.1); const ended = !OPS.storm; const st = TERMINUS.state();
    const finite = [st.time, st.scrap, ...humans.flatMap(a => [a.x,a.y,a.e]), ...machines.flatMap(a => [a.x,a.y,a.e])].every(Number.isFinite);
    return { latched: OPS.objectives[0].done, active, ended, finite };
  });
  assert.equal(result.latched, true); assert.equal(result.active, true); assert.equal(result.ended, true); assert.equal(result.finite, true);
});

test('scenario reset restores rescue policy and clears operations', async page => {
  const result = await page.evaluate(() => {
    document.querySelector('.preset[data-p="purge"]').click(); const purge = { rescue: document.getElementById('rescue').checked, scenario: TERMINUS.state().scenario, shelters: OPS.shelters.length };
    TERMINUS.intervene('shelter', 80, 80); document.querySelector('#btnReset').click();
    const reset = { rescue: document.getElementById('rescue').checked, shelters: OPS.shelters.length, humans: humans.length, machines: machines.length };
    document.querySelector('.preset[data-p="rewild"]').click(); return { purge, reset, rewild: { rescue: document.getElementById('rescue').checked, machines: machines.length } };
  });
  assert.equal(result.purge.rescue, false); assert.equal(result.purge.scenario, 'purge'); assert.equal(result.reset.shelters, 0); assert.equal(result.reset.machines, 20); assert.equal(result.rewild.rescue, true); assert.equal(result.rewild.machines, 0);
});

test('resize rescales geometry and keeps agents inside canvas', async page => {
  await fresh(page, 30, 4, .6); const before = await page.evaluate(() => TERMINUS.state());
  await page.setViewportSize({ width: 900, height: 700 }); await settle(page, 180); const after = await page.evaluate(() => ({ s: TERMINUS.state(), humans: humans.slice(0, 30), machines: machines.slice(0, 10) }));
  assert.notEqual(`${before.W}x${before.H}`, `${after.s.W}x${after.s.H}`);
  for (const a of [...after.humans, ...after.machines]) assert.ok(a.x >= 0 && a.x <= after.s.W && a.y >= 0 && a.y <= after.s.H);
});

test('pause, speed controls, sliders, inspect and dialogs work', async page => {
  await page.locator('#btnHelp').click(); assert.equal(await page.locator('#helpDialog[open]').count(), 1); await page.locator('#helpDialog [data-close]').last().click();
  await page.locator('#btnSettings').click(); assert.equal(await page.locator('#settingsDialog[open]').count(), 1);
  const slider = page.locator('#grpSim input'); await slider.fill('2'); const val = await slider.inputValue(); assert.equal(val, '2');
  await page.locator('#settingsDialog [data-close]').click(); await page.evaluate(() => window.TERMINUS.setRunning(true)); await page.locator('#btnPlay').click(); assert.equal(await page.locator('#btnPlay span').textContent(), 'Play');
  await page.keyboard.press(' '); assert.equal(await page.locator('#btnPlay span').textContent(), 'Pause');
  await fresh(page,1,0); await page.evaluate(() => { humans[0].x=W/2; humans[0].y=H/2; });
  await page.keyboard.press('0'); await clickWorld(page); assert.match(await page.locator('#inspectTitle').textContent(),/^HUMAN/);
});

test('population and effect bounds hold across 120 simulated seconds', async page => {
  const result = await page.evaluate(() => { TERMINUS.setRunning(false); TERMINUS.seedWorld(300, 30, 1); for (let i = 0; i < 2400; i++) step(.05); return { h: humans.length, m: machines.length, fx: fx.length, corpses: corpses.length, finite: [...humans,...machines].every(a => Object.values(a).filter(v => typeof v === 'number').every(Number.isFinite)) }; });
  assert.ok(result.h <= 4000); assert.ok(result.m <= 900); assert.ok(result.fx <= 420); assert.ok(result.corpses <= 240); assert.equal(result.finite, true);
});

test('mobile layout has no horizontal overflow and commands remain reachable', async page => {
  await page.setViewportSize({ width: 390, height: 844 }); await settle(page, 180);
  const result = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, commands: [...document.querySelectorAll('.command')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) }));
  assert.ok(result.width <= result.client + 1, `${result.width} > ${result.client}`); assert.equal(result.commands, true);
});

test('invalid command metadata preserves finite power', async page => {
  await fresh(page,0,0);
  const ok=await page.evaluate(()=>{const credits=OPS.credits; return ['cooldowns','toString','__proto__'].every(k=>!TERMINUS.intervene(k,100,100))&&OPS.credits===credits;});
  assert.equal(ok,true);
});

test('refuge and EMP objectives are earned, extinction resets survival', async page => {
  await fresh(page,10,3);
  const result=await page.evaluate(()=>{
    for(const h of humans){h.x=200;h.y=200;h.e=60;}
    for(const m of machines){m.x=200;m.y=200;m.e=100;}
    intervene('shelter',200,200);intervene('emp',200,200);step(.01);
    const earned=OPS.objectives[0].done&&OPS.objectives[1].done;
    humans.length=0;el('rescue').checked=false;OPS.survivalTime=119.99;step(.05);
    return {earned,dead:OPS.objectives[2].done,survival:OPS.survivalTime};
  });
  assert.equal(result.earned,true);assert.equal(result.dead,false);assert.equal(result.survival,0);
  await page.evaluate(()=>el('endcard').classList.remove('on'));
});

test('single command placement on drag and modal shortcuts stay paused', async page => {
  await fresh(page,0,0);
  await page.locator('#world').focus();await page.keyboard.press('5');await dragWorld(page);
  assert.equal(await page.evaluate(()=>OPS.shelters.length),1);
  await page.locator('#btnSettings').click();await page.locator('#settingsDialog').evaluate(d=>{d.tabIndex=-1;d.focus();});
  await page.keyboard.press('Space');await page.keyboard.press('r');await page.keyboard.press('?');
  assert.equal(await page.evaluate(()=>running),false);assert.equal(await page.locator('dialog[open]').count(),1);
  assert.equal(await page.evaluate(()=>OPS.shelters.length),1);
  await page.keyboard.press('Escape');
});

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); }); page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  await page.addInitScript(() => { let seed=90210; Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}; });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  const failures = [];
  const selectedTests = process.env.TEST_FILTER ? tests.filter(t => t.name.includes(process.env.TEST_FILTER)) : tests;
  for (const t of selectedTests) {
    try {
      if (!t.name.startsWith('intro') && await page.locator('#intro').count()) { await page.locator('#goMute').click(); await page.waitForTimeout(900); }
      await t.fn(page); console.log(`PASS ${t.name}`);
    }
    catch (e) { failures.push({ name: t.name, error: e }); console.error(`FAIL ${t.name}: ${e.message}`); }
  }
  if (errors.length) { failures.push({ name: 'console/page errors', error: new Error(errors.join('\n')) }); console.error(errors.join('\n')); }
  await browser.close();
  if (failures.length) process.exitCode = 1;
  console.log(`\n${selectedTests.length - failures.length}/${selectedTests.length} tests passed`);
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
