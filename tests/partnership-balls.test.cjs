const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const appScript = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].at(-1)?.[1];
assert.ok(appScript, 'index.html contains the inline scorer script');
const start = appScript.indexOf('  function currentOver()');
const end = appScript.indexOf('  function secondInnings()', start);
assert.ok(start >= 0 && end > start, 'scoring functions can be isolated');

const context = {
  toast() {}, save() {}, render() {}, finishMatch() {}, secondInnings() {},
  player(id) { return context.s.batters[context.s.innings - 1][id] || `Player ${id}`; },
  batterStat(id) {
    const batters = context.s.batters[context.s.innings - 1];
    return batters[`stat${id}`] || { runs: 0, balls: 0, fours: 0, sixes: 0 };
  },
  ensureBatter(id) {
    const batters = context.s.batters[context.s.innings - 1];
    batters[`stat${id}`] ??= { runs: 0, balls: 0, fours: 0, sixes: 0 };
    batters[`stat${id}`].fours ??= 0;
    batters[`stat${id}`].sixes ??= 0;
  },
  s: null,
};
vm.createContext(context);
vm.runInContext(appScript.slice(start, end), context);

function freshState() {
  return {
    innings: 1, active: true, finished: false, limit: 0, maxWickets: 10,
    scores: [0, 0], wickets: [0, 0], legal: [0, 0], balls: [[], []],
    batters: [{}, {}], bowlers: [{}, {}], bowlStats: [{}, {}],
    current: {
      striker: 1, nonStriker: 2, next: 3, bowler: 1, nextBowler: 2,
      partnershipRuns: 0, partnershipBalls: 0,
    },
    fow: [[], []], history: [[], []], undo: [],
  };
}

const deliveries = [
  { name: 'normal legal delivery', input: { bat: 1 }, expected: { batterBalls: 1, partnershipBalls: 1, legal: 1 } },
  { name: 'wide', input: { extra: 1, kind: 'wide', legal: false, rotate: 1 }, expected: { batterBalls: 0, partnershipBalls: 0, legal: 0 } },
  { name: 'no-ball with bat runs', input: { bat: 1, extra: 1, kind: 'noball', legal: false, rotate: 1 }, expected: { batterBalls: 1, partnershipBalls: 1, legal: 0, batterRuns: 1, bowlerRuns: 2 } },
  { name: 'no-ball with byes', input: { extra: 4, kind: 'noball', legal: false, rotate: 3, extraType: 'bye', bowlerRuns: 1 }, expected: { batterBalls: 1, partnershipBalls: 1, legal: 0, batterRuns: 0, bowlerRuns: 1, teamRuns: 4 } },
  { name: 'no-ball with leg-byes', input: { extra: 3, kind: 'noball', legal: false, rotate: 2, extraType: 'legbye', bowlerRuns: 1 }, expected: { batterBalls: 1, partnershipBalls: 1, legal: 0, batterRuns: 0, bowlerRuns: 1, teamRuns: 3 } },
  { name: 'bye', input: { extra: 1, kind: 'bye', legal: true, rotate: 1 }, expected: { batterBalls: 1, partnershipBalls: 1, legal: 1 } },
  { name: 'leg-bye', input: { extra: 1, kind: 'legbye', legal: true, rotate: 1 }, expected: { batterBalls: 1, partnershipBalls: 1, legal: 1 } },
];

for (const delivery of deliveries) {
  test(`${delivery.name}: batter balls, partnership balls, legal balls, and undo`, () => {
    context.s = freshState();
    context.record(delivery.input);
    const batter = context.s.batters[0].stat1;
    assert.equal(batter.balls, delivery.expected.batterBalls, 'batter balls faced');
    assert.equal(context.s.current.partnershipBalls, delivery.expected.partnershipBalls, 'partnership balls');
    assert.equal(context.s.legal[0], delivery.expected.legal, 'legal balls');

    const previousState = context.s.undo.pop();
    assert.ok(previousState, 'delivery has an undo snapshot');
    context.s = JSON.parse(previousState);
    assert.equal(context.s.current.partnershipBalls, 0, 'undo restores partnership balls');
    assert.equal(context.s.legal[0], 0, 'undo restores legal balls');
    assert.equal(context.s.balls[0].length, 0, 'undo removes the delivery');
    assert.equal(context.s.scores[0], 0, 'undo restores the score');
    assert.equal(context.s.batters[0].stat1, undefined, 'undo restores batter statistics');
  });
}

test('no-ball dialog offers off-bat, bye, and leg-bye scoring', () => {
  assert.match(html, /id=\"noBallRunType\"[\s\S]*?value=\"bat\"[\s\S]*?value=\"bye\"[\s\S]*?value=\"legbye\"/);
  assert.match(html, /noBallScoring\(n,extraType\)/);
});

test('no-ball run type assigns extras and bowler runs correctly', () => {
  const helperStart = appScript.indexOf('  function noBallScoring(');
  const helperEnd = appScript.indexOf('  function record(', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'no-ball scoring helper exists');
  const scoringContext = {};
  vm.createContext(scoringContext);
  vm.runInContext(appScript.slice(helperStart, helperEnd), scoringContext);
  assert.deepEqual(JSON.parse(JSON.stringify(scoringContext.noBallScoring(3, 'bat'))), { bat: 3, extra: 1, bowlerRuns: null, label: 'Nb+3' });
  assert.deepEqual(JSON.parse(JSON.stringify(scoringContext.noBallScoring(3, 'bye'))), { bat: 0, extra: 4, bowlerRuns: 1, label: 'Nb+3B' });
  assert.deepEqual(JSON.parse(JSON.stringify(scoringContext.noBallScoring(2, 'legbye'))), { bat: 0, extra: 3, bowlerRuns: 1, label: 'Nb+2Lb' });
});

test('legacy saved match recounts partnership balls since the last wicket', () => {
  const helperStart = appScript.indexOf('  function partnershipBallsFromCurrentStand(');
  const helperEnd = appScript.indexOf('  function load()', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'legacy migration helper exists');
  const migrationContext = {};
  vm.createContext(migrationContext);
  vm.runInContext(appScript.slice(helperStart, helperEnd), migrationContext);
  const state = { innings: 1, balls: [[
    { kind: 'noball', legal: false },
    { kind: 'wide', legal: false },
    { kind: 'run', legal: true, wicket: true },
    { kind: 'wide', legal: false },
    { kind: 'noball', legal: false },
    { kind: 'legbye', legal: true },
  ]] };
  assert.equal(migrationContext.partnershipBallsFromCurrentStand(state), 2);
  assert.equal(migrationContext.partnershipBallsFromCurrentStand({ innings: 1, balls: [[{ kind: 'noball', legal: false }]] }), 1);
});
