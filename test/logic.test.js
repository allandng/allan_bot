require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const { xpToNext, totalXpForLevel, levelFromXp, boostMultiplier } = require('../src/features/leveling');
const { SLOT_SYMBOLS, SLOT_TOTAL_WEIGHT, slotMultiplier, handValue, settleBlackjack } = require('../src/features/gambling');
const { computeDaily, slugify } = require('../src/features/economy');
const { scoreAnswer, scrambleWord, normalizeOpenTdb } = require('../src/features/trivia');
const { diffDeals } = require('../src/features/deals');

const card = (r) => ({ r, s: '♠' });

test('level curve matches MEE6 formula', () => {
    assert.strictEqual(xpToNext(0), 100);
    assert.strictEqual(xpToNext(1), 155);
    assert.strictEqual(totalXpForLevel(2), 255);
    assert.deepStrictEqual(levelFromXp(0), { level: 0, into: 0, needed: 100 });
    assert.strictEqual(levelFromXp(99).level, 0);
    assert.strictEqual(levelFromXp(100).level, 1);
    assert.deepStrictEqual(levelFromXp(300), { level: 2, into: 45, needed: 220 });
    for (let l = 0; l < 50; l++) assert.strictEqual(levelFromXp(totalXpForLevel(l)).level, l);
});

test('xp boost doubles only while active', () => {
    assert.strictEqual(boostMultiplier({ boostUntil: 2000 }, 1000), 2);
    assert.strictEqual(boostMultiplier({ boostUntil: 500 }, 1000), 1);
});

test('slots return-to-player is between 90% and 99%', () => {
    let rtp = 0;
    for (const a of SLOT_SYMBOLS) for (const b of SLOT_SYMBOLS) for (const c of SLOT_SYMBOLS) {
        rtp += ((a.w * b.w * c.w) / SLOT_TOTAL_WEIGHT ** 3) * slotMultiplier([a.s, b.s, c.s]);
    }
    assert.ok(rtp > 0.9 && rtp < 0.99, `RTP was ${rtp}`);
});

test('blackjack hand values handle soft aces', () => {
    assert.strictEqual(handValue([card('A'), card('K')]), 21);
    assert.strictEqual(handValue([card('A'), card('A'), card('9')]), 21);
    assert.strictEqual(handValue([card('A'), card('5'), card('K')]), 16);
    assert.strictEqual(handValue([card('K'), card('Q'), card('2')]), 22);
});

test('blackjack settlement', () => {
    const bet = 100;
    assert.strictEqual(settleBlackjack([card('A'), card('K')], [card('9'), card('9')], bet).payout, 250);
    assert.strictEqual(settleBlackjack([card('K'), card('Q'), card('5')], [card('9'), card('9')], bet).payout, 0);
    assert.strictEqual(settleBlackjack([card('K'), card('9')], [card('K'), card('6'), card('9')], bet).payout, 200);
    assert.strictEqual(settleBlackjack([card('K'), card('8')], [card('K'), card('8')], bet).payout, 100);
    assert.strictEqual(settleBlackjack([card('K'), card('7')], [card('K'), card('9')], bet).payout, 0);
});

test('daily streaks', () => {
    const DAY = 864e5;
    const now = 10 * DAY;
    assert.deepStrictEqual(computeDaily({ lastDaily: 0, dailyStreak: 0 }, now), { ok: true, streak: 1, amount: 200 });
    assert.strictEqual(computeDaily({ lastDaily: now - DAY / 2, dailyStreak: 1 }, now).ok, false);
    assert.deepStrictEqual(computeDaily({ lastDaily: now - 1.5 * DAY, dailyStreak: 3 }, now), { ok: true, streak: 4, amount: 275 });
    assert.strictEqual(computeDaily({ lastDaily: now - 3 * DAY, dailyStreak: 5 }, now).streak, 1);
    // bonus caps at 7 days
    assert.strictEqual(computeDaily({ lastDaily: now - 1.2 * DAY, dailyStreak: 30 }, now).amount, 200 + 6 * 25);
});

test('slugify item names', () => {
    assert.strictEqual(slugify('⭐ VIP Role!'), 'vip-role');
});

test('trivia scoring rewards speed', () => {
    assert.strictEqual(scoreAnswer(0, 20000), 150);
    assert.strictEqual(scoreAnswer(20000, 20000), 100);
    assert.ok(scoreAnswer(5000, 20000) > scoreAnswer(15000, 20000));
});

test('scramble never returns the original word', () => {
    for (let i = 0; i < 200; i++) assert.notStrictEqual(scrambleWord('candy'), 'candy');
    assert.strictEqual(scrambleWord('aaa'), 'aaa');
});

test('open trivia db url3986 decoding', () => {
    const q = normalizeOpenTdb({
        category: 'Entertainment%3A%20Video%20Games',
        difficulty: 'easy',
        question: 'What%27s%20%22this%22%3F',
        correct_answer: 'A%20%26%20B',
        incorrect_answers: ['C', 'D', 'E'],
    });
    assert.strictEqual(q.category, 'Entertainment: Video Games');
    assert.strictEqual(q.q, 'What\'s "this"?');
    assert.strictEqual(q.a, 'A & B');
});

test('deal diffing announces new and deeper sales only', () => {
    const wl = { 1: { name: 'A', lastDiscount: 0 }, 2: { name: 'B', lastDiscount: 35 }, 3: { name: 'C', lastDiscount: 20 }, 4: { name: 'D', lastDiscount: 10 } };
    const p = (initial, final, discount_percent) => ({ currency: 'USD', initial, final, discount_percent, initial_formatted: '', final_formatted: '' });
    const fresh = diffDeals(wl, { 1: p(999, 649, 35), 2: p(999, 649, 35), 3: p(999, 499, 50), 4: p(999, 999, 0), 5: p(1, 1, 90) });
    assert.deepStrictEqual(fresh.map((d) => d.name).sort(), ['A', 'C']);
    assert.strictEqual(wl[4].lastDiscount, 0); // sale ended, resets so the next sale alerts
    assert.strictEqual(diffDeals(wl, { 1: null }).length, 0); // missing price is ignored
});
