import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "@playwright/test";

const url = new URL(process.env.FINDER_BASE_URL ?? "http://127.0.0.1:5174/?debug=1");
url.searchParams.set("debug", "1");
const focus = process.env.FINDER_SMOKE_FOCUS;
const artifacts = path.resolve(focus === "reader" ? "artifacts/reader-regression" : focus === "perfect" ? "artifacts/perfect-regression" : "artifacts/browser-smoke");
await mkdir(artifacts, { recursive: true });
const report = { ok: false, startedAt: new Date().toISOString(), url: url.href,
  policy: "Real pointer, touch and native dialog input only. No game, clock, save or reward injection.",
  checks: [], runs: [], screenshots: [], errors: [], notTested: [] };
const browserName = process.env.FINDER_BROWSER === "webkit" ? "webkit" : "chromium";
const browser = await (browserName === "webkit" ? webkit : chromium).launch({ headless: true });
report.browser = browserName;
let activePage;
let screenshotOrdinal = 0;
function pass(name, evidence = true) { report.checks.push({ name, evidence }); process.stdout.write(`PASS ${name}\n`); }
function watch(page, label) {
  page.on("pageerror", (error) => report.errors.push({ label, message: error.message }));
  page.on("console", (message) => { if (message.type() === "error") report.errors.push({ label, message: message.text() }); });
}
async function inspect(page) { return page.evaluate(() => window.__FINDER_GAME__?.scene.getScene("FinderScene")?.inspect()); }
async function waitState(page, fields, timeout = 8_000) {
  await page.waitForFunction((match) => {
    try { const s = window.__FINDER_GAME__?.scene.getScene("FinderScene")?.inspect(); return s && Object.entries(match).every(([key, value]) => s[key] === value); }
    catch { return false; }
  }, fields, { timeout });
  return inspect(page);
}
async function frames(page) { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))); }
async function logical(page, point) {
  const box = await page.locator("canvas").boundingBox(); assert.ok(box?.width && box.height);
  return { x: box.x + point.x * box.width / 960, y: box.y + point.y * box.height / 540 };
}
async function click(page, point, touch = false) {
  await frames(page); const p = await logical(page, point);
  if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
}
function middle(target) { assert.ok(target, "An inspected input target exists"); const r = target.rect; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
async function target(page, group, id, touch = false) { await click(page, middle((await inspect(page))[group].find((item) => item.id === id)), touch); }
async function named(page, name, touch = false) {
  await frames(page);
  const p = await page.evaluate((name) => {
    const scan = (items) => { for (const item of items ?? []) { if (!item.active || !item.visible) continue; if (item.name === name) return item; const child = scan(item.list); if (child) return child; } return null; };
    const button = scan(window.__FINDER_GAME__?.scene.getScene("FinderScene")?.children.list);
    const zone = button?.list?.find((child) => child.type === "Zone" && child.input?.enabled);
    if (!zone) return null; const point = button.getWorldTransformMatrix().transformPoint(zone.x, zone.y); return { x: point.x, y: point.y };
  }, name);
  assert.ok(p, `Visible Phaser button ${name}`); await click(page, p, touch);
}
async function native(page, id, touch = false) {
  const button = page.getByTestId(id); await button.waitFor({ state: "visible" });
  if (touch) await button.tap(); else await button.click();
}
async function drag(page, from, to, steps = 4) {
  const a = await logical(page, from), b = await logical(page, to);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps }); await page.mouse.up();
}
async function picture(page, label) {
  const name = `${String(++screenshotOrdinal).padStart(2, "0")}-${label}.png`;
  await page.screenshot({ path: path.join(artifacts, name), fullPage: true }); report.screenshots.push(name);
}
async function stored(context, key = "finder-discovery:v1") {
  const state = await context.storageState();
  const raw = state.origins.find((origin) => origin.origin === url.origin)?.localStorage.find((item) => item.name === key)?.value;
  return raw ? JSON.parse(raw) : null;
}
const saveOf = (state) => state.progress.save;
function stableRewards(save) {
  return { completedRuns: save.completedRuns, cards: save.unlockedCardIds, bestScores: save.bestScores,
    story: save.story, handledFileIds: save.handledFileIds, appliedRunIds: save.appliedRunIds };
}
async function outcome(page, id, success, timeout = 20_000) {
  await page.waitForFunction((id) => window.__FINDER_GAME__?.scene.getScene("FinderScene")?.inspect()?.outcomes.some((item) => item.missionId === id), id, { timeout });
  const state = await inspect(page); const matches = state.outcomes.filter((item) => item.missionId === id);
  assert.equal(matches.length, 1); assert.equal(matches[0].status, success ? "success" : "failure"); return matches[0];
}
async function enterMission(page, index, mode) {
  await page.waitForFunction((index) => {
    const s = window.__FINDER_GAME__?.scene.getScene("FinderScene")?.inspect();
    return s && s.missionIndex === index && ["tutorial", "briefing", "playing"].includes(s.phase);
  }, index, { timeout: 6_000 });
  let state = await inspect(page);
  assert.equal(state.deadlineMs, state.mission.baseDeadlineMs * (mode === "relaxed" ? 1.5 : 1));
  assert.equal(state.mode, mode); assert.equal(state.paused, false);
  if (state.phase === "tutorial") { assert.equal(state.elapsedMs, 0); await named(page, "tutorial-start"); }
  state = await waitState(page, { phase: "playing", missionIndex: index });
  assert.ok(state.elapsedMs < 1_500, "The mission receives a fresh playable clock"); return state;
}
async function pauseCatch(page) {
  await named(page, "pause"); const paused = await waitState(page, { paused: true });
  await new Promise((resolve) => setTimeout(resolve, 420));
  const still = await inspect(page);
  assert.equal(still.elapsedMs, paused.elapsedMs); assert.equal(still.catchIndex, paused.catchIndex); assert.deepEqual(still.catchNext, paused.catchNext);
  assert.equal(still.paused, true); await named(page, "resume"); await waitState(page, { paused: false });
  pass("Catch pauses its deadline and falling-file progress until manual resume");
}
async function solve(page, state, success, { touch = false, checkCatchPause = false, checkDrag = false } = {}) {
  const m = state.mission;
  if (m.kind === "find" || m.kind === "latest") {
    const correct = m.kind === "latest" ? [...m.files].sort((a, b) => b.modifiedAt - a.modifiedAt)[0].id : m.targetFileId;
    assert.equal(correct, m.targetFileId);
    const id = success ? correct : m.files.find((file) => file.id !== correct).id;
    if (checkDrag && success && !touch) {
      const wrong = m.files.find((file) => file.id !== correct).id;
      await target(page, "files", wrong); await waitState(page, { selectedId: wrong });
      await target(page, "files", wrong); await waitState(page, { selectedId: null });
      assert.equal((await inspect(page)).outcomes.length, state.outcomes.length);
      const from = middle(state.files.find((file) => file.id === correct));
      await drag(page, from, { x: 866, y: 24 });
      const canceled = await inspect(page); assert.equal(canceled.paused, false); assert.equal(canceled.drag, null);
      await drag(page, from, middle(state.destinations.find((destination) => destination.id === m.destinationId)));
      pass("Selection changes are free and drag release over Pause clears the gesture");
    } else { await target(page, "files", id, touch); await target(page, "destinations", m.destinationId, touch); }
  } else if (m.kind === "sort") {
    for (const id of success ? m.requiredFileIds : [m.requiredFileIds[0]]) {
      const file = m.files.find((item) => item.id === id);
      const destination = m.folders.find((folder) => success ? folder.kind === file.kind : folder.kind !== file.kind).id;
      if (success) assert.equal(destination, m.expectedFolderByFileId[id]);
      await target(page, "files", id, touch); await target(page, "destinations", destination, touch);
    }
  } else if (m.kind === "wipe") {
    await click(page, { x: 760, y: 424 }, touch); assert.equal((await inspect(page)).phase, "playing");
    if (success) for (const stain of m.stains) {
      if (touch) await click(page, stain, true);
      else await drag(page, { x: stain.x - stain.radius - 10, y: stain.y }, { x: stain.x + stain.radius + 10, y: stain.y }, 1);
    }
  } else if (m.kind === "bundle") {
    if (success) for (const id of m.targetFileIds) await target(page, "files", id, touch);
    await named(page, "bundle-confirm", touch);
  } else if (m.kind === "catch") {
    if (checkCatchPause) await pauseCatch(page);
    for (let index = 0; index < (success ? 3 : 1); index++) {
      const current = await inspect(page); assert.equal(current.phase, "playing"); assert.ok(current.catchNext);
      const lane = success ? current.catchNext.lane : (current.catchNext.lane + 1) % 3;
      await click(page, middle(current.lanes.find((item) => item.lane === lane)), touch);
      await page.waitForFunction(({ id, index }) => {
        const s = window.__FINDER_GAME__?.scene.getScene("FinderScene")?.inspect();
        return s && (s.missionId !== id || s.phase !== "playing" || s.catchIndex > index);
      }, { id: m.id, index }, { timeout: 4_000 });
    }
  } else if (m.kind === "boss") {
    for (let index = 0; index < (success ? 3 : 1); index++) {
      const current = await inspect(page); assert.equal(current.bossStep, index);
      const step = m.steps[index]; const id = success ? step.targetFileId : step.files.find((file) => file.id !== step.targetFileId).id;
      await target(page, "files", id, touch); await target(page, "destinations", step.destinationId, touch);
      if (success && index < 2) { const next = await waitState(page, { bossStep: index + 1 }); assert.equal(next.completedIds.length, index + 1); }
    }
  } else assert.fail(`Missing browser solver for ${m.kind}`);
  return outcome(page, m.id, success, state.deadlineMs + 2_000);
}
async function run(page, { mode = "normal", locale = "ko", success = true, practice = false, touch = false, checkCatchPause = false, captureKinds = false, label = "run" } = {}) {
  const first = await inspect(page), count = practice ? 3 : 10;
  const beforeCount = saveOf(first).completedRuns, observed = [], capturedKinds = new Set();
  for (let index = 0; index < count; index++) {
    const state = await enterMission(page, index, mode);
    assert.equal(state.locale, locale); assert.equal(state.missionCount, count); assert.equal(state.runKind, practice ? "practice" : "regular");
    if (captureKinds && !capturedKinds.has(state.mission.kind)) {
      await picture(page, `${label}-${state.mission.kind}-active`); capturedKinds.add(state.mission.kind);
    }
    if (!practice && index === 9) await picture(page, `${label}-boss`);
    const passed = typeof success === "function" ? success(state, index) : success;
    observed.push(await solve(page, state, passed, { touch, checkCatchPause: checkCatchPause && state.mission.id === "catch", checkDrag: checkCatchPause && index === 0 }));
  }
  const result = await waitState(page, { phase: "result" });
  assert.equal(result.outcomes.length, count); assert.equal(result.successes, observed.filter((item) => item.status === "success").length);
  assert.equal(result.score, observed.reduce((sum, item) => sum + item.score, 0)); assert.equal(result.goalAchieved, result.successes >= 7);
  assert.equal(saveOf(result).completedRuns, beforeCount + (practice ? 0 : 1));
  if (success === true && !practice) { assert.equal(result.score, 1240); assert.equal(result.maxCombo, 10); }
  if (success === false) { assert.equal(result.score, 0); assert.equal(result.maxCombo, 0); }
  if (captureKinds) assert.equal(capturedKinds.size, practice ? 3 : 7);
  report.runs.push({ label, locale, mode, practice, successes: result.successes, score: result.score, missions: observed, completedRuns: saveOf(result).completedRuns });
  pass(`${label}: real ${count}-mission result`, { successes: result.successes, score: result.score, completedRuns: saveOf(result).completedRuns });
  await picture(page, `${label}-result`); return result;
}
function fresh(state, before, mode, locale) {
  assert.ok(state.runId > before.runId); assert.equal(state.phase, "tutorial"); assert.equal(state.missionIndex, 0);
  assert.equal(state.elapsedMs, 0); assert.equal(state.score, 0); assert.equal(state.combo, 0); assert.equal(state.maxCombo, 0);
  assert.equal(state.selectedId, null); assert.deepEqual(state.selectedIds, []); assert.deepEqual(state.completedIds, []);
  assert.deepEqual(state.outcomes, []); assert.equal(state.bossStep, 0); assert.equal(state.catchIndex, 0);
  assert.equal(state.drag, null); assert.equal(state.paused, false); assert.equal(state.discoveryId, null);
  assert.equal(state.mode, mode); assert.equal(state.locale, locale);
}
async function fiveRestarts(page, mode, locale) {
  for (let index = 0; index < 5; index++) {
    const state = await enterMission(page, 0, mode); await target(page, "files", state.mission.targetFileId);
    await named(page, "pause"); await waitState(page, { paused: true }); await named(page, "pause-restart");
    fresh(await waitState(page, { phase: "tutorial" }), state, mode, locale);
  }
  pass("Five partial-input restarts reset every mission field without awarding a completion");
}

async function closeDesk(page) { await native(page, "desk-close"); await page.getByTestId("desk-dialog").waitFor({ state: "hidden" }); }
async function gallery(page, kind) {
  if (await page.getByTestId("desk-dialog").isVisible()) await native(page, `tab-${kind}`);
  else await named(page, kind === "cards" ? "open-cards" : kind === "stories" ? "open-stories" : kind === "guide" ? "open-guide" : "open-drawer");
  await page.getByTestId("desk-dialog").waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("desk-dialog").getAttribute("data-view"), kind);
}
async function verifyCards(page, context) {
  const before = saveOf(await inspect(page)); await gallery(page, "cards");
  assert.equal(await page.locator('[data-testid^="cards-open-C"]').count(), 9);
  await native(page, "cards-open-C01"); await native(page, "equip-C01");
  assert.equal(saveOf(await inspect(page)).equippedCardId, "C01");
  assert.equal((await stored(context)).equippedCardId, "C01");
  const equipped = saveOf(await inspect(page));
  await native(page, "card-replay-C01"); assert.deepEqual(saveOf(await inspect(page)), equipped);
  await picture(page, "equipped-card-C01"); await closeDesk(page);
  await gallery(page, "cards"); await native(page, "cards-open-C01");
  assert.equal(await page.getByTestId("equip-C01").isDisabled(), true);
  await native(page, "card-back"); await native(page, "cards-open-C07");
  assert.equal(await page.getByTestId("equip-C07").count(), before.unlockedCardIds.includes("C07") ? 1 : 0);
  await closeDesk(page); assert.deepEqual(stableRewards(saveOf(await inspect(page))), stableRewards(before));
  pass("Nine-card gallery equips only unlocked cards and preserves the choice across reopening");
}
async function article(page, locale) {
  const reader = page.getByTestId("discovery-reader"); await reader.waitFor({ state: "visible" });
  assert.equal(await reader.getAttribute("lang"), locale);
  const id = await reader.getAttribute("data-discovery-id"); assert.match(id, /^D(?:0[1-9]|1[0-2])$/);
  const title = (await reader.getByTestId("discovery-title").innerText()).trim();
  const paragraphs = (await reader.getByTestId("discovery-body").locator(":scope > p").allTextContents()).map((text) => text.trim());
  assert.ok(title.length && paragraphs.length && paragraphs.every(Boolean));
  const finder = (await reader.getByTestId("discovery-finder-line").innerText()).trim(); assert.ok(finder);
  assert.equal(/[가-힣]/.test([title, ...paragraphs, finder].join(" ")), locale === "ko");
  assert.equal(await reader.locator("input,textarea").count(), 0);
  return id;
}
async function verifyDiscoveries(page, context, locale, collectAll) {
  const baseline = stableRewards(saveOf(await inspect(page))); await gallery(page, "discoveries");
  for (const topic of ["organize", "create", "rest", "all"]) {
    await native(page, `topic-${topic}`);
    assert.equal(saveOf(await inspect(page)).settings.preferredTopic, topic === "all" ? null : topic);
    const featured = page.locator('[data-testid^="recommended-read-"]');
    const id = (await featured.getAttribute("data-testid")).replace("recommended-read-", "");
    const topics = { organize: ["D01", "D04", "D05", "D06"], create: ["D02", "D07", "D08", "D09"], rest: ["D03", "D10", "D11", "D12"] };
    if (topic !== "all") assert.ok(topics[topic].includes(id));
  }
  if (collectAll) {
    // Recommendations are freely received; opening each article is a separate real action.
    for (let count = 0; count < 12; count++) {
      const featured = page.locator('[data-testid^="recommended-read-"]');
      await featured.click(); const id = await article(page, locale);
      const current = saveOf(await inspect(page));
      assert.ok(current.discovery.openedBundleIds.includes(id)); assert.ok(current.discovery.readBundleIds.includes(id));
      if (count === 0) await picture(page, `discovery-${locale}`);
      await native(page, "close-discovery"); await page.getByTestId("desk-dialog").waitFor({ state: "visible" });
      if (count < 11) await native(page, "other-discovery");
    }
    assert.equal(saveOf(await inspect(page)).discovery.openedBundleIds.length, 12);
    assert.equal(saveOf(await inspect(page)).discovery.receivedBundleIds.length, 12);
  } else {
    for (let count = 1; count <= 12; count++) {
      const id = `D${String(count).padStart(2, "0")}`; await native(page, `drawer-read-${id}`);
      assert.equal(await article(page, locale), id);
      if (count === 2) await picture(page, `discovery-${locale}`);
      await native(page, "close-discovery"); await page.getByTestId("desk-dialog").waitFor({ state: "visible" });
    }
  }
  assert.deepEqual(stableRewards(saveOf(await inspect(page))), baseline);
  assert.equal(saveOf(await inspect(page)).discovery.actionDoneIds.length, 0);
  assert.equal(saveOf(await inspect(page)).discovery.actionOpenedIds.length, 0);
  const beforeReload = await stored(context); await closeDesk(page);
  assert.deepEqual(stableRewards(await stored(context)), stableRewards(beforeReload));
  pass(`${locale.toUpperCase()} routes all twelve original articles; topics and other recommendations are free of score requirements`);
}
async function verifyActions(page, context) {
  const before = saveOf(await inspect(page)); await gallery(page, "discoveries");
  await native(page, "drawer-read-D02"); await article(page, "en");
  assert.equal(await page.getByTestId("discovery-suggestion").isVisible(), false);
  assert.deepEqual(saveOf(await inspect(page)).discovery.actionOpenedIds, before.discovery.actionOpenedIds);
  assert.deepEqual(saveOf(await inspect(page)).discovery.actionDoneIds, before.discovery.actionDoneIds);
  await native(page, "reader-action");
  assert.equal(await page.getByTestId("discovery-suggestion").isVisible(), true);
  assert.ok(saveOf(await inspect(page)).discovery.actionOpenedIds.includes("D02"));
  assert.equal(saveOf(await inspect(page)).discovery.actionDoneIds.includes("D02"), false);
  await native(page, "reader-action-done");
  assert.ok(saveOf(await inspect(page)).discovery.actionDoneIds.includes("D02"));
  assert.equal(await page.getByTestId("reader-action-done").isDisabled(), true);
  await picture(page, "optional-action-recorded"); await native(page, "close-discovery");
  await native(page, "drawer-read-D03"); await native(page, "reader-action");
  assert.equal(await page.getByTestId("reader-action-done").isVisible(), false);
  assert.equal(saveOf(await inspect(page)).discovery.actionDoneIds.includes("D03"), false);
  await native(page, "reader-other"); const changedId = await article(page, "en");
  assert.notEqual(changedId, "D03"); await native(page, "close-discovery");
  await page.getByTestId("desk-dialog").waitFor({ state: "visible" }); await closeDesk(page);
  assert.deepEqual(stableRewards(saveOf(await inspect(page))), stableRewards(before));
  assert.deepEqual((await stored(context)).discovery.actionDoneIds, ["D02"]);
  pass("Reading, opening a suggestion and optional completion are separate; rest suggestions have no completion record");
}
async function verifyStory(page, context, id, choice, { defer = false, reloadDuringH01 = false } = {}) {
  await gallery(page, "stories"); await native(page, `story-open-${id}`);
  const pending = saveOf(await inspect(page));
  if (defer) {
    await native(page, "story-later"); assert.deepEqual(saveOf(await inspect(page)), pending);
    await closeDesk(page); await gallery(page, "stories"); await native(page, `story-open-${id}`);
    assert.deepEqual(saveOf(await inspect(page)), pending); pass(`${id} remains pending after deferral and reopening`);
  }
  await native(page, id === "H01" ? "story-confirm-H01" : choice === "rest" ? "story-rest" : "story-continue");
  await page.getByTestId("story-scene").waitFor({ state: "visible" });
  const committed = saveOf(await inspect(page));
  assert.ok(committed.unlockedCardIds.includes(id === "H01" ? "C06" : "C07"));
  assert.equal(committed.story[id === "H01" ? "holidaySeen" : "friendSeen"], true);
  assert.equal(committed.completedRuns, pending.completedRuns);
  assert.deepEqual(await stored(context), committed, "The story reward is stored before animation or skip");
  if (id === "H01") { assert.equal(committed.story.holidaySeenAtCompletedRuns, pending.completedRuns); assert.equal(committed.story.friendPending, false); }
  else assert.equal(committed.story.friendChoice, choice);
  await picture(page, `${id}-${choice ?? "approve"}-confirmed`);
  if (reloadDuringH01) {
    await page.reload(); await waitState(page, { phase: "lobby", modal: null }, 20_000);
    assert.deepEqual(saveOf(await inspect(page)), committed);
    pass("H01 reward survives a real reload during its animation without needing to finish the clip");
  } else {
    await native(page, "story-skip");
    if (id === "H02") await waitState(page, { phase: choice === "rest" ? "lobby" : "tutorial", modal: null });
    else await closeDesk(page);
    assert.deepEqual(saveOf(await inspect(page)), committed);
  }
  pass(`${id} ${choice ?? "approval"} commits its card before presentation`, committed.story);
  return committed;
}
async function replayStory(page, context, id, choice) {
  const before = saveOf(await inspect(page)); await gallery(page, "stories"); await native(page, `story-open-${id}`);
  await native(page, id === "H02" && choice ? `story-replay-${choice}` : `story-replay-${id}`);
  await page.getByTestId("story-scene").waitFor({ state: "visible" });
  if (id === "H02" && choice === "continue") {
    await page.waitForFunction(() => [...document.querySelectorAll('.desk-friend-illustration')].length > 0 && [...document.querySelectorAll('.desk-friend-illustration')].every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 8_000 });
  }
  await native(page, "story-skip"); await closeDesk(page);
  assert.deepEqual(saveOf(await inspect(page)), before); assert.deepEqual(await stored(context), before);
  pass(`${id} ${choice ?? ""} replay skips without extra cards, completions, or automatic play`);
}
async function setMode(page, mode) { await named(page, `mode-${mode}`); }
async function lobby(page) { if ((await inspect(page)).phase === "result") await named(page, "return-lobby"); await waitState(page, { phase: "lobby", modal: null }); }
async function boot(context, locale, gate = false) {
  const page = await context.newPage(); activePage = page; watch(page, locale);
  const targetUrl = new URL(url); if (gate) targetUrl.searchParams.delete("lang"); else targetUrl.searchParams.set("lang", locale);
  await page.goto(targetUrl.href); await waitState(page, { phase: "lobby" }, 20_000);
  if (gate) {
    await waitState(page, { modal: "language" }); await click(page, { x: 260, y: 403 });
    assert.equal((await inspect(page)).phase, "lobby"); assert.equal((await inspect(page)).modal, "language");
    await named(page, "language-ko"); await waitState(page, { modal: null, locale: "ko" });
    assert.equal((await stored(context, "finder-discovery:p0-settings:v1")).locale, "ko");
    pass("The first visit gates play until an explicit language choice");
  }
  const art = await page.evaluate(() => {
    const texture = window.__FINDER_GAME__.scene.getScene("FinderScene").textures.get("finder-art");
    return { key: texture.key, frames: texture.getFrameNames(), width: texture.source[0]?.width, height: texture.source[0]?.height };
  });
  assert.equal(art.key, "finder-art"); assert.ok(art.width > 0 && art.height > 0); assert.ok(art.frames.length >= 8);
  pass("Local Finder artwork and pose frames load", art); await picture(page, `lobby-${locale}`); return page;
}

async function focusedReaderRegression() {
  report.focus = "reader";
  const context = await browser.newContext({
    viewport: { width: Number(process.env.FINDER_VIEWPORT_WIDTH ?? 1280), height: Number(process.env.FINDER_VIEWPORT_HEIGHT ?? 800) },
    hasTouch: process.env.FINDER_TOUCH === "1", isMobile: process.env.FINDER_TOUCH === "1", locale: "ko-KR",
  });
  const page = await boot(context, "ko");
  await named(page, "start-run");
  const result = await run(page, { label: "reader-focus", captureKinds: true, touch: process.env.FINDER_TOUCH === "1" });
  const completedResult = (state) => {
    // Audio voices finish independently while the reader is open; compare the completed game session.
    const { progress: _progress, modal: _modal, discoveryId: _discovery, audio: _audio, ...session } = state;
    return session;
  };
  const baseline = completedResult(result), rewards = stableRewards(saveOf(result));

  await gallery(page, "discoveries");
  await page.locator('[data-testid^="recommended-read-"]').click();
  const drawerIds = [await article(page, "ko")];
  for (let index = 0; index < 2; index++) {
    await native(page, "reader-other"); drawerIds.push(await article(page, "ko"));
  }
  assert.equal(new Set(drawerIds).size, 3);
  await native(page, "close-discovery");
  await page.getByTestId("desk-dialog").waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("desk-dialog").getAttribute("data-view"), "discoveries");
  assert.equal((await inspect(page)).modal, "desk");
  assert.deepEqual(completedResult(await inspect(page)), baseline);
  assert.deepEqual(stableRewards(saveOf(await inspect(page))), rewards);
  await picture(page, "reader-focus-returned-to-drawer");
  pass("Result → drawer → reader → other twice → close preserves the drawer origin", drawerIds);

  await closeDesk(page); await waitState(page, { phase: "result", modal: null });
  await named(page, "open-discovery"); const directId = await article(page, "ko");
  await native(page, "reader-other"); const changedId = await article(page, "ko");
  assert.notEqual(changedId, directId);
  await native(page, "close-discovery");
  await page.getByTestId("discovery-reader").waitFor({ state: "hidden" });
  await waitState(page, { phase: "result", modal: null, discoveryId: null });
  assert.equal(await page.getByTestId("desk-dialog").isVisible(), false);
  assert.deepEqual(completedResult(await inspect(page)), baseline);
  assert.deepEqual(stableRewards(saveOf(await inspect(page))), rewards);
  await picture(page, "reader-focus-returned-to-result");
  pass("Result → direct reader → other → close returns directly to the unchanged result", [directId, changedId]);
  assert.equal(report.runs.length, 1);
  assert.deepEqual(report.errors, []);
  pass("Focused reader regression completes one genuine normal run with no runtime errors");
  report.ok = true;
  await context.close();
}

async function focusedPerfectRegression() {
  report.focus = "perfect";
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
  const page = await boot(context, "ko");
  const initial = saveOf(await inspect(page));
  await gallery(page, "guide");
  assert.equal(await page.locator('[data-testid^="guide-control-"]').count(), 7);
  assert.equal(await page.getByTestId("guide-card-conditions").locator("tbody tr").count(), 9);
  assert.deepEqual(saveOf(await inspect(page)), initial);
  await picture(page, "first-visit-guide"); await closeDesk(page);
  await named(page, "start-run");
  const result = await run(page, { label: "new-perfect-card", captureKinds: true });
  assert.deepEqual(saveOf(result).unlockedCardIds, ["C00", "C01", "C04", "C05", "C08"]);
  const earned = stableRewards(saveOf(result));
  await gallery(page, "cards");
  assert.equal(await page.locator('[data-testid^="cards-open-C"]').count(), 9);
  await native(page, "cards-open-C08");
  const art = page.locator('.desk-card-detail .desk-perfect-pose');
  assert.equal(await art.count(), 1);
  assert.match(await art.getAttribute("style"), /perfect-finder-v1\.png/);
  await native(page, "equip-C08");
  assert.equal((await stored(context)).equippedCardId, "C08");
  await native(page, "card-replay-C08");
  assert.deepEqual(stableRewards(saveOf(await inspect(page))), earned);
  await picture(page, "starlight-finder-card"); await closeDesk(page);
  await lobby(page); await picture(page, "starlight-finder-lobby");
  await page.reload(); await waitState(page, { phase: "lobby", modal: null }, 20_000);
  assert.equal(saveOf(await inspect(page)).equippedCardId, "C08");
  assert.deepEqual(stableRewards(saveOf(await inspect(page))), earned);
  await gallery(page, "cards"); await native(page, "cards-open-C08");
  assert.equal(await page.getByTestId("equip-C08").isDisabled(), true);
  await closeDesk(page);
  pass("First-visit guide covers all seven controls and nine card conditions without changing progress");
  pass("A real perfect regular run unlocks C08, whose separate artwork, equip and replay persist across reload");
  assert.deepEqual(report.errors, []); report.ok = true;
  await context.close();
}

try {
  if (focus === "reader") {
    await focusedReaderRegression();
  } else if (focus === "perfect") {
    await focusedPerfectRegression();
  } else {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
  const page = await boot(context, "ko", true);
  await named(page, "start-run"); await fiveRestarts(page, "normal", "ko");
  const first = await run(page, { checkCatchPause: true, label: "ko-normal-perfect" });
  assert.deepEqual(saveOf(first).unlockedCardIds, ["C00", "C01", "C04", "C05", "C08"]);
  assert.equal(saveOf(first).bestScores.normal, 1240);
  await verifyCards(page, context); await verifyDiscoveries(page, context, "ko", true);
  await lobby(page); const beforePractice = saveOf(await inspect(page));
  await named(page, "start-practice"); await run(page, { practice: true, label: "ko-practice" });
  assert.deepEqual(saveOf(await inspect(page)), beforePractice); pass("Practice does not count, unlock, record handled files, or change best scores");
  await lobby(page); await setMode(page, "relaxed"); await named(page, "start-run");
  const second = await run(page, { mode: "relaxed", success: false, label: "ko-relaxed-zero" });
  assert.equal(saveOf(second).completedRuns, 2); assert.ok(saveOf(second).unlockedCardIds.includes("C02"));
  assert.equal(saveOf(second).bestScores.relaxed, 0); assert.equal(saveOf(second).bestScores.normal, 1240);
  pass("A zero-success relaxed completion still grants the next basic completion card");
  await lobby(page); await setMode(page, "normal");
  const englishUrl = new URL(url); englishUrl.searchParams.set("lang", "en");
  await page.goto(englishUrl.href); await waitState(page, { phase: "lobby", locale: "en", modal: null }, 20_000);
  assert.equal((await stored(context, "finder-discovery:p0-settings:v1")).locale, "ko");
  await verifyDiscoveries(page, context, "en", false);
  await verifyActions(page, context);
  await named(page, "start-run"); const third = await run(page, { locale: "en", label: "en-third-completion" });
  assert.equal(saveOf(third).completedRuns, 3); assert.equal(saveOf(third).story.holidayPending, true);
  await lobby(page); await verifyStory(page, context, "H01", undefined, { defer: true, reloadDuringH01: true });
  await replayStory(page, context, "H01");
  await named(page, "start-run"); const fourth = await run(page, { locale: "en", success: (_state, index) => index !== 9, label: "en-goal-before-final-failure" });
  assert.equal(fourth.successes, 9); assert.equal(fourth.goalAchieved, true); assert.equal(saveOf(fourth).story.friendPending, true);
  assert.ok(saveOf(fourth).handledFileIds.length > 0); pass("A final boss failure preserves an already achieved 7/10 goal");
  await verifyStory(page, context, "H02", "rest", { defer: true });
  await replayStory(page, context, "H02", "continue");
  assert.equal(saveOf(await inspect(page)).unlockedCardIds.length, 9);
  assert.equal((await stored(context, "finder-discovery:p0-settings:v1")).locale, "ko");
  pass("All nine cards and both stories are reachable while English URL play preserves saved Korean");
  await context.close();

  // A second disposable context exercises the other real H02 choice. No saved
  // state is seeded: every unlock comes from the four playable runs below.
  const touchContext = await browser.newContext({ viewport: { width: 960, height: 600 }, hasTouch: true, isMobile: true, locale: "en-US" });
  const touchPage = await boot(touchContext, "en");
  for (let ordinal = 1; ordinal <= 3; ordinal++) {
    await named(touchPage, "start-run", true);
    const result = await run(touchPage, { locale: "en", touch: true, success: ordinal !== 1, label: `touch-completion-${ordinal}` });
    if (ordinal === 1) { assert.deepEqual(saveOf(result).unlockedCardIds, ["C00", "C01"]); pass("A fresh 0/10 touch run earns C01 without mastery"); }
    await lobby(touchPage);
  }
  await verifyStory(touchPage, touchContext, "H01");
  await named(touchPage, "start-run", true); await run(touchPage, { locale: "en", touch: true, label: "touch-fourth-completion" });
  const beforeContinue = await inspect(touchPage); await verifyStory(touchPage, touchContext, "H02", "continue");
  fresh(await waitState(touchPage, { phase: "tutorial" }), beforeContinue, "normal", "en");
  assert.equal(saveOf(await inspect(touchPage)).completedRuns, 4);
  pass("H02 continue grants the same C07 then starts a fresh uncounted run");
  await touchContext.close();
  report.notTested.push("Physical trackpad/phone hardware, Safari/Firefox, real background-tab transitions and portrait mission layout require manual/device QA.");
  report.notTested.push("Exact deadline races, corrupt/future saves, duplicate transaction IDs and midnight recommendation boundaries are checked by pure-module tests.");
  assert.deepEqual(report.errors, [], "No browser runtime/console errors"); pass("No runtime or console errors across desktop and emulated touch"); report.ok = true;
  }
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; process.stderr.write(`${report.error}\n`);
  if (activePage && !activePage.isClosed()) {
    try { report.failureState = await inspect(activePage); await picture(activePage, "failure"); } catch { /* Preserve original assertion. */ }
  }
} finally {
  report.finishedAt = new Date().toISOString(); await writeFile(path.join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); process.stdout.write(`Report: ${path.join(artifacts, "report.json")}\n`);
}
