import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { matchMaker } from '@colyseus/core';
import { APPROACHES } from '../pizza-party/layout.ts';
import { ROUND_TICKS, START_TICKS } from '../pizza-party/simulation.ts';
import { server } from '../server/index.ts';

const playwright = process.env.MAYHEM_PLAYWRIGHT;
const { chromium } = playwright ? await import(pathToFileURL(playwright).href) : await import('playwright');
const origin = 'http://127.0.0.1:25818';
const output = resolve(process.argv[2] ?? '.');
mkdirSync(output, { recursive: true });
const report = { passed: false, errors: [], races: [], controls: [], screenshots: [] };
const browser = await chromium.launch({
  executablePath: process.env.MAYHEM_CHROME,
  headless: true,
  args: ['--mute-audio', '--disable-background-networking'],
});
const contexts = [];
const shot = async (page, name) => {
  await page.screenshot({ path: resolve(output, name), timeout: 15000, style: '#debug { display: none !important; }' });
  report.screenshots.push(name);
};

async function openPlayer(options = {}, rtt) {
  const context = await browser.newContext(options);
  contexts.push(context);
  await context.addInitScript(offline => {
    if (!location.pathname.startsWith('/pizza/')) return;
    if (offline) {
      let now = 0, id = 0, drawing = true;
      const callbacks = new Map();
      performance.now = () => now;
      window.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = handle => callbacks.delete(handle);
      for (const method of ['clear', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const original = WebGL2RenderingContext.prototype[method];
        WebGL2RenderingContext.prototype[method] = function (...args) {
          if (drawing) return original.apply(this, args);
        };
      }
      window.stepKitchen = (ticks, draw) => {
        drawing = draw;
        let elapsed = ticks * 1000 / 60;
        while (elapsed > 1e-7) {
          const duration = Math.min(elapsed, 45);
          now += duration;
          elapsed -= duration;
          const batch = [...callbacks.values()];
          callbacks.clear();
          for (const frame of batch) frame(now);
        }
        drawing = true;
      };
    }
    window.pizzaState = undefined;
    window.pizzaAwards = [];
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'state') return;
      window.pizzaState = event.data.snapshot;
      window.pizzaAwards.push(...window.pizzaState.events.filter(event => event.type === 'pickup'));
    });
  }, rtt === undefined);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text() + ' ' + message.location().url);
  });
  if (rtt) {
    await page.routeWebSocket(/ws:\/\/127\.0\.0\.1:25818\//, route => {
      const peer = route.connectToServer();
      const ordered = () => {
        let delivery = 0;
        return (message, send) => {
          delivery = Math.max(performance.now() + rtt.value / 2, delivery);
          setTimeout(() => { try { send(message); } catch { /* socket closed */ } }, Math.max(0, delivery - performance.now()));
        };
      };
      const upload = ordered(), download = ordered();
      route.onMessage(message => upload(message, msg => peer.send(msg)));
      peer.onMessage(message => download(message, msg => route.send(msg)));
    });
  }
  return page;
}

const game = (page, id) => page.locator('[data-open="games"]').click()
  .then(() => page.locator('[data-game="' + id + '"]').click());

async function pizzaFrame(page, phase = 'playing') {
  const child = page.locator('#pizza-screen').contentFrame();
  await child.locator('#pizza-app[data-phase="' + phase + '"]').waitFor({ timeout: 20000 });
  return page.frames().find(frame => frame.url().includes('/pizza/?'));
}

async function solo() {
  const page = await openPlayer({ viewport: { width: 1280, height: 720 } });
  await page.goto(origin + '/?seed=2&debug=1');
  await game(page, 'pizza-party');
  await page.getByRole('button', { name: 'Play as Viber 84', exact: true }).first().click();
  await shot(page, 'Mayhem Picker - Pizza Party.png');
  await page.locator('[data-hub-start]').click();
  const child = await pizzaFrame(page, 'ready');
  const step = (ticks, draw = false) => child.evaluate(([count, render]) => window.stepKitchen(count, render), [ticks, draw]);
  await step(72.001);
  await child.locator('#pizza-app[data-phase="playing"]').waitFor();
  assert.match(await child.locator('.score[data-you] img').getAttribute('src'), /viber-84/);
  const moves = [['ArrowRight', 117], ['ArrowUp', 8], ['ArrowDown', 11], ['ArrowLeft', 124], ['ArrowDown', 1],
    ['ArrowRight', 26], ['ArrowUp', 82], ['ArrowLeft', 31], ['ArrowDown', 12], ['ArrowUp', 11],
    ['ArrowRight', 25], ['ArrowDown', 81], ['ArrowLeft', 52]];
  for (const [key, ticks] of moves) {
    await page.keyboard.down(key);
    await step(ticks);
    await page.keyboard.up(key);
  }
  assert.equal(await child.locator('.score[data-you] b').textContent(), '1');
  await step(1, true);
  await shot(page, 'Pizza Party - Solo Match.png');
  const used = moves.reduce((sum, [, ticks]) => sum + ticks, 1);
  await step(ROUND_TICKS - used + 2);
  await child.getByRole('button', { name: 'Rematch', exact: true }).click();
  assert.equal(await child.locator('.score[data-you] b').textContent(), '0');
  await child.locator('#pause').click();
  await child.getByRole('button', { name: 'Games', exact: true }).click();
  await page.locator('#mayhem-hub').waitFor();
  assert.equal(await page.locator('[data-game-title]').textContent(), 'Pizza Party');
  await game(page, 'let-them-cook');
  await page.locator('[data-hub-start]').click();
  await page.locator('#shell').waitFor();
  await page.locator('#fuse').waitFor();
  assert.equal(await page.locator('#stage').getAttribute('aria-label'), 'Let Them Cook arena');
  await page.reload();
  await page.getByRole('button', { name: 'Online Rooms', exact: true }).click();
  await page.getByRole('button', { name: 'Create private room' }).click();
  await page.locator('.online-seats [data-kind="bot"]').nth(2).waitFor();
  assert.match(await page.locator('[data-room-region]').textContent(), /Let Them Cook/);
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await page.locator('#online-room-button').waitFor();
  await page.locator('#fuse').waitFor();
  report.solo = { pickedViber: 84, scoredPizza: true, rematchReset: true, returnedToPicker: true,
    bothGamesPlayable: true, letThemCookOnline: true };
  await page.context().close();
}

async function checkControls(page, child, peer, touch, room, seat) {
  const match = room.pizza.match;
  const spawns = room.pizza.snapshot(room.round, [], false).spawnSeats;
  const player = spawns.indexOf(seat);
  const position = { x: -0.65, z: 1.94 };
  const restingSpots = [{ x: -5, z: 2.14 }, { x: 4.9, z: 2.14 }, { x: -4.82, z: -1.92 }, { x: 4.82, z: -1.92 }];
  match.trayReadyAt.fill(START_TICKS + ROUND_TICKS);
  match.players.forEach((chef, index) => {
    room.pizza.clear(spawns[index]);
    chef.position = index === player ? { ...position } : restingSpots[index];
    chef.recoil = { x: 0, z: 0 };
  });
  const frameState = { player, position };
  await Promise.all([child, peer].map(frame => frame.waitForFunction(({ player, position }) =>
    Math.abs((window.pizzaState?.view.players[player].position.x ?? Infinity) - position.x) < 0.005, frameState)));
  await page.bringToFront();
  await child.evaluate(() => window.focus());
  const movement = () => Promise.all([child, peer].map(frame => frame.waitForFunction(({ player, position }) => {
    const chef = window.pizzaState?.view.players[player];
    return chef && chef.position.x > position.x + 0.045 &&
      Math.abs(chef.position.z - position.z) < 0.10;
  }, frameState)));
  if (!touch) {
    await page.keyboard.down('ArrowRight');
    try { await movement(); }
    finally { await page.keyboard.up('ArrowRight'); }
  } else {
    const session = await page.context().newCDPSession(page);
    const start = { x: 123, y: 276 };
    try {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 58, y: start.y }] });
      await movement();
    } finally {
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    }
  }
  report.controls.push({ device: touch ? 'landscape touch emulation' : 'keyboard', bothClientsSawMovement: true });
}

async function checkTouchLayout(page, child) {
  report.layouts = [];
  for (const [width, height] of [[480, 270], [568, 320], [844, 390], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    const fits = await child.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const score = rect('#scoreboard'), timer = rect('#timer'), actions = rect('.actions');
      return score.left >= 0 && score.right <= timer.left && timer.right <= actions.left && actions.right <= innerWidth;
    });
    assert(fits, 'the scoreboard, clock and ping fit at ' + width + ' × ' + height);
    report.layouts.push({ width, height });
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await child.getByRole('heading', { name: 'Turn to landscape' }).waitFor();
  await page.setViewportSize({ width: 568, height: 320 });
  await child.locator('#overlay').waitFor({ state: 'hidden' });
  report.portraitPrompt = true;
}

async function stageRefill(room, first, second, rtt) {
  const round = room.pizza;
  const match = round.match;
  const { spawnSeats } = round.snapshot(room.round, [], false);
  const { x, z } = APPROACHES[0].position;
  const positions = [{ x: x + 0.34, z: z + 0.04 }, { x: x - 0.35, z },
    { x: 4.8, z: 2.65 }, { x: -5.65, z: 1.92 }];
  match.trayReadyAt.fill(START_TICKS + ROUND_TICKS);
  const refill = match.tick + 24;
  match.trayReadyAt[0] = refill;
  match.players.forEach((player, index) => {
    const seat = spawnSeats[index];
    round.clear(seat);
    player.position = positions[seat];
    player.heading = Math.PI;
    player.carried = null;
    player.recoil = { x: 0, z: 0 };
    player.supplyContact = -1;
    player.supplySince = -1;
  });
  await Promise.all([first, second].map(child => child.waitForFunction(tick => window.pizzaState?.view.tick >= tick, refill + 3)));
  const pairs = await Promise.all([first, second].map(child => child.evaluate(tick => ({
    awards: window.pizzaAwards.filter(award => award.station === 0 && award.tick === tick),
    carriers: window.pizzaState.view.players.filter(player => player.carried === window.pizzaState.view.supplies[0]).map(player => player.id),
  }), refill)));
  assert.deepEqual(pairs[0], pairs[1]);
  assert.equal(pairs[0].awards.length, 1);
  assert.equal(pairs[0].carriers.length, 1);
  const winner = spawnSeats[pairs[0].awards[0].player];
  report.races.push({ rtt, refill, winner, clientsAgree: true, portions: pairs[0].awards.length });
  return winner;
}

async function privateRoom() {
  const hostLag = { value: 30 }, guestLag = { value: 120 };
  const host = await openPlayer({ viewport: { width: 1024, height: 576 }, permissions: ['clipboard-read', 'clipboard-write'] }, hostLag);
  const guest = await openPlayer({ viewport: { width: 568, height: 320 }, isMobile: true, hasTouch: true }, guestLag);
  await host.goto(origin + '/?debug=1');
  await game(host, 'pizza-party');
  await host.getByRole('button', { name: 'Online Rooms', exact: true }).click();
  await host.getByRole('button', { name: 'Create private room' }).click();
  await host.locator('[data-copy-invite]').click();
  await host.getByText('Invite copied.', { exact: true }).waitFor();
  const invite = await host.evaluate(() => navigator.clipboard.readText());
  assert(invite.startsWith(origin + '/?room='));
  await guest.goto(invite + '&debug=1');
  await guest.locator('.online-seats [data-kind="human"]').nth(1).waitFor();
  assert.match(await guest.locator('[data-room-region]').textContent(), /Pizza Party/);
  assert.equal(await host.locator('.online-seats [data-kind="bot"]').count(), 2);
  await guest.locator('.online-room').getByRole('button', { name: 'Play as Agent 123', exact: true }).click();
  await guest.getByRole('button', { name: 'Ready', exact: true }).click();
  await shot(host, 'Pizza Party - Private Room.png');
  await host.getByRole('button', { name: 'Start match', exact: true }).click();
  let [a, b] = await Promise.all([pizzaFrame(host), pizzaFrame(guest)]);
  const room = matchMaker.getLocalRoomById(new URL(invite).searchParams.get('room'));
  const initial = room.pizza.snapshot(1, [], false);
  const seats = initial.view.openingPair.seats.map(seat => initial.spawnSeats[seat]);
  assert.deepEqual(seats, [0, 1]);
  await Promise.all([a, b].map(child => child.waitForFunction(() => /\d+ ms/.test(document.getElementById('pizza-ping').textContent))));
  await checkTouchLayout(guest, b);
  await shot(guest, 'Pizza Party - Online Phone.png');
  const firstWinner = await stageRefill(room, a, b, [30, 120]);
  const pingLabels = [a, b].map(child => child.locator('#pizza-ping'));
  const readingsBefore = await Promise.all(pingLabels.map(label => label.textContent()));
  [hostLag.value, guestLag.value] = [guestLag.value, hostLag.value];
  // Browser scheduling adds delay on top of the configured transport delay. Wait for a fresh sample on each client.
  await Promise.all([a, b].map((child, index) => child.waitForFunction(previous => {
    const reading = document.getElementById('pizza-ping').textContent;
    return /\d+ ms/.test(reading) && reading !== previous;
  }, readingsBefore[index])));
  report.pingRefresh = { before: readingsBefore, after: await Promise.all(pingLabels.map(label => label.textContent())) };
  const secondWinner = await stageRefill(room, a, b, [120, 30]);
  assert.equal(firstWinner, secondWinner);
  // Check the stationary refill race before sending movement packets through the delay proxy.
  await checkControls(host, a, b, false, room, 0);
  await checkControls(guest, b, a, true, room, 1);
  await a.locator('#pizza-room').click();
  await host.getByRole('button', { name: 'Return to match' }).click();
  await guest.reload();
  b = await pizzaFrame(guest);
  assert.match(await b.locator('.score[data-you] img').getAttribute('src'), /agent-123/);
  report.reconnected = true;

  // Restore all trays for a normal finish and keep the real clock running.
  room.pizza.match.trayReadyAt.fill(room.pizza.match.tick);
  const results = async child => {
    await child.locator('#pizza-app[data-phase="over"]').waitFor({ timeout: 100000 });
    return child.evaluate(() => ({
      tick: window.pizzaState.view.tick,
      scores: window.pizzaState.view.players.map(player => player.score),
      winners: window.pizzaState.view.winners,
    }));
  };
  const [hostResults, guestResults] = await Promise.all([results(a), results(b)]);
  assert.deepEqual(hostResults, guestResults);
  assert.equal(hostResults.tick, START_TICKS + ROUND_TICKS);
  assert(hostResults.scores.some(score => score > 0));
  report.matchResults = hostResults;
  await shot(guest, 'Pizza Party - Online Results.png');
  let releaseLoad;
  const guestLoad = new Promise(resolve => { releaseLoad = resolve; });
  await guest.route(url => url.pathname === '/pizza/' && url.searchParams.get('online') === '2',
    async route => { await guestLoad; await route.continue(); });
  await b.getByRole('button', { name: 'Ready for rematch' }).click();
  await a.getByRole('button', { name: 'Rematch', exact: true }).click();
  try {
    a = await pizzaFrame(host, 'ready');
    await delay(1450);
    assert.equal(room.pizza.match.tick, 0, 'the new round waits for the delayed guest');
    assert.equal(room.pizzaLoading.seats.size, 1, 'the host acknowledged its first draw');
  } finally { releaseLoad(); }
  b = await pizzaFrame(guest, 'ready');
  const match = room.pizza.snapshot(room.round, [], false);
  assert.equal(match.round, 2);
  assert.deepEqual(match.view.players.map(player => player.score), [0, 0, 0, 0]);
  assert.deepEqual(match.view.openingPair.seats.map(seat => match.spawnSeats[seat]), [1, 0]);
  await Promise.all([a, b].map(child => child.locator('#pizza-app[data-phase="playing"]').waitFor()));
  report.rematch = { round: match.round, resetScores: true, swappedOpeningSpawns: true, waitedForGuest: true };
}

try {
  await server.listen(25818, '127.0.0.1');
  await solo();
  await privateRoom();
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close();
  await server.gracefullyShutdown(false);
  writeFileSync(resolve(output, 'browser-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
