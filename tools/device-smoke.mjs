import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';

const base = process.env.FINDER_BASE_URL ?? 'http://127.0.0.1:5174/';
const out = 'artifacts/device-audio';
await mkdir(out, { recursive: true });
const report = { ok: false, startedAt: new Date().toISOString(), base, checks: [], errors: [], limitations: ['WebKit and Chromium phone emulation are not physical iPhone/Android or installed Safari tests.', 'Speaker quality, hardware silent mode, real app switching and phone rotation need physical-device confirmation.'] };
const snap = page => page.evaluate(() => window.__FINDER_GAME__?.scene.getScene('FinderScene')?.inspect());
async function wait(page, predicate, timeout = 10000) {
  await page.waitForFunction(predicate, null, { timeout });
}
async function named(page, name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const point = await page.evaluate(name => {
    const scan = items => { for (const item of items ?? []) { if (!item.active || !item.visible) continue; if (item.name === name) return item; const nested = scan(item.list); if (nested) return nested; } return null; };
    const item = scan(window.__FINDER_GAME__.scene.getScene('FinderScene').children.list);
    const zone = item?.list?.find(child => child.type === 'Zone' && child.input?.enabled);
    if (!zone) return null;
    const p = item.getWorldTransformMatrix().transformPoint(zone.x, zone.y);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.x + p.x * r.width / 960, y: r.y + p.y * r.height / 540 };
  }, name);
  assert.ok(point, `Button ${name}`);
  await page.touchscreen.tap(point.x, point.y);
}
const pass = (profile, name, evidence = true) => { report.checks.push({ profile, name, evidence }); console.log(`PASS ${profile}: ${name}`); };
for (const [profile, engine, landscape, portrait] of [
  ['iphone-webkit', webkit, { width: 844, height: 390 }, { width: 390, height: 844 }],
  ['android-chromium', chromium, { width: 915, height: 412 }, { width: 412, height: 915 }],
]) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: landscape, hasTouch: true, isMobile: true, locale: 'ko-KR', deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push({ profile, message: e.message }));
    page.on('console', e => { if (e.type() === 'error') report.errors.push({ profile, message: e.text() }); });
    const url = new URL(base); url.searchParams.set('lang', 'ko'); url.searchParams.set('debug', '1');
    await page.goto(url.href);
    await wait(page, () => !!window.__FINDER_GAME__?.scene.getScene('FinderScene')?.inspect());
    assert.equal((await snap(page)).audio.contextState, 'uninitialized');
    pass(profile, 'No music/context before first user input');
    await named(page, 'open-guide');
    await page.getByTestId('desk-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('desk-dialog').getAttribute('data-view'), 'guide');
    await wait(page, () => window.__FINDER_GAME__.scene.getScene('FinderScene').inspect().audio.musicPlaying);
    await page.setViewportSize(portrait);
    await page.getByTestId('desk-dialog').evaluate(el => {
      if (el.scrollWidth > el.clientWidth + 2) throw new Error('Guide overflows its portrait dialog');
    });
    assert.match(await page.getByTestId('desk-dialog').innerText(), /10\/10/);
    await page.screenshot({ path: `${out}/${profile}-portrait-guide.png` });
    pass(profile, 'Guide opens before playing, remains readable in portrait, and describes perfect unlock');
    await page.getByTestId('tab-cards').tap();
    assert.equal(await page.locator('[data-testid^="cards-open-C"]').count(), 9);
    await page.getByTestId('cards-open-C08').tap();
    assert.equal(await page.getByTestId('equip-C08').count(), 0);
    await page.getByTestId('desk-close').tap();
    await page.setViewportSize(landscape);
    await named(page, 'settings');
    await named(page, 'toggle-sound');
    assert.equal((await snap(page)).audio.muted, true);
    assert.equal((await snap(page)).audio.activeVoices, 0);
    assert.equal((await snap(page)).audio.schedulerActive, false);
    await named(page, 'close-settings');
    await page.reload();
    await wait(page, () => !!window.__FINDER_GAME__?.scene.getScene('FinderScene')?.inspect());
    assert.equal((await snap(page)).audio.muted, true);
    assert.equal((await snap(page)).audio.contextState, 'uninitialized');
    await named(page, 'settings');
    await named(page, 'toggle-sound');
    await wait(page, () => window.__FINDER_GAME__.scene.getScene('FinderScene').inspect().audio.musicPlaying);
    await named(page, 'close-settings');
    pass(profile, 'Mute cuts all voices immediately, persists reload, and explicit unmute resumes music');
    await named(page, 'start-run');
    await named(page, 'tutorial-start');
    await wait(page, () => window.__FINDER_GAME__.scene.getScene('FinderScene').inspect().phase === 'playing');
    await named(page, 'pause');
    const paused = await snap(page);
    assert.equal(paused.paused, true); assert.equal(paused.audio.musicPlaying, false); assert.equal(paused.audio.activeVoices, 0);
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal((await snap(page)).elapsedMs, paused.elapsedMs);
    await named(page, 'resume');
    await wait(page, () => window.__FINDER_GAME__.scene.getScene('FinderScene').inspect().audio.musicPlaying);
    await named(page, 'pause');
    await named(page, 'pause-restart');
    assert.equal((await snap(page)).phase, 'tutorial');
    assert.equal((await snap(page)).successes, 0);
    assert.equal((await snap(page)).progress.save.completedRuns, 0);
    assert.ok((await snap(page)).audio.activeVoices <= 24);
    await named(page, 'tutorial-start');
    await wait(page, () => window.__FINDER_GAME__.scene.getScene('FinderScene').inspect().phase === 'playing');
    await named(page, 'pause');
    await named(page, 'pause-lobby');
    await named(page, 'settings');
    await named(page, 'toggle-sound');
    await named(page, 'close-settings');
    pass(profile, 'Touch pause freezes game/music; resume and restart do not stack music or grant completions');
    await page.screenshot({ path: `${out}/${profile}-landscape-lobby.png` });
    await context.close();
  } catch (error) {
    report.errors.push({ profile, message: error.stack });
    throw error;
  } finally {
    await browser.close();
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  }
}
assert.deepEqual(report.errors, []);
report.ok = true; report.finishedAt = new Date().toISOString();
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(`${out}/report.json`);
