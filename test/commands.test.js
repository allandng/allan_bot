// Drives the real command handlers with fake interactions to catch runtime errors.
const { dir, fakeInteraction, text } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { getStore, Store } = require('../src/lib/db');
const economy = require('../src/features/economy');
const gambling = require('../src/features/gambling');
const leveling = require('../src/features/leveling');
const deals = require('../src/features/deals');
const trivia = require('../src/features/trivia');

const other = { id: 'u2', bot: false, username: 'u2', toString: () => '<@u2>' };

test('daily, balance, pay', async () => {
    let i = fakeInteraction({ commandName: 'daily' });
    await economy.onCommand(i);
    assert.match(text(i.replies[0]), /claimed/);
    assert.strictEqual(getStore().user('g1', 'u1').coins, 300);

    i = fakeInteraction({ commandName: 'daily' });
    await economy.onCommand(i);
    assert.match(text(i.replies[0]), /Come back/);

    i = fakeInteraction({ commandName: 'pay', options: { user: other, amount: 50 } });
    await economy.onCommand(i);
    assert.strictEqual(getStore().user('g1', 'u1').coins, 250);
    assert.strictEqual(getStore().user('g1', 'u2').coins, 150);

    i = fakeInteraction({ commandName: 'pay', options: { user: other, amount: 99999 } });
    await economy.onCommand(i);
    assert.match(text(i.replies[0]), /only have/);
});

test('shop, buy, use xp boost, gift, autocomplete', async () => {
    getStore().user('g1', 'u1').coins = 2000;
    let i = fakeInteraction({ commandName: 'shop' });
    await economy.onCommand(i);
    assert.match(text(i.replies[0]), /XP Boost/);

    i = fakeInteraction({ commandName: 'buy', options: { item: 'xp-boost' } });
    await economy.onCommand(i);
    assert.strictEqual(getStore().user('g1', 'u1').inventory['xp-boost'], 1);

    i = fakeInteraction({ commandName: 'use', options: { item: 'xp-boost' } });
    await economy.onCommand(i);
    assert.ok(getStore().user('g1', 'u1').boostUntil > Date.now());

    i = fakeInteraction({ commandName: 'buy', options: { item: 'cookie', quantity: 3 } });
    await economy.onCommand(i);
    i = fakeInteraction({ commandName: 'gift', options: { user: other, item: 'cookie' } });
    await economy.onCommand(i);
    assert.strictEqual(getStore().user('g1', 'u2').inventory.cookie, 1);

    i = fakeInteraction({ commandName: 'use', options: { focused: 'coo' } });
    await economy.onAutocomplete(i);
    assert.deepStrictEqual(i.replies[0].autocomplete.map((o) => o.value), ['cookie']);

    i = fakeInteraction({ commandName: 'inventory' });
    await economy.onCommand(i);
    assert.match(text(i.replies[0]), /Cookie/);
});

test('shopadmin adds a role item and buying grants the role', async () => {
    const role = { id: 'r-vip', editable: true, toString: () => '<@&r-vip>' };
    let i = fakeInteraction({ commandName: 'shopadmin', sub: 'add', options: { name: 'VIP', price: 100, role } });
    await economy.onCommand(i);
    i = fakeInteraction({ commandName: 'buy', options: { item: 'vip' } });
    i.guild.roles.cache.set('r-vip', role);
    const before = getStore().user('g1', 'u1').coins;
    await economy.onCommand(i);
    assert.ok(i.member.roles.cache.has('r-vip'));
    assert.strictEqual(getStore().user('g1', 'u1').coins, before - 100);
});

test('coinflip and slots keep balance consistent', async () => {
    const u = getStore().user('g1', 'u3');
    u.coins = 1000;
    const i = fakeInteraction({ commandName: 'coinflip', userId: 'u3', options: { bet: 100, side: 'heads' } });
    await gambling.onCommand(i);
    assert.ok([900, 1100].includes(u.coins), `coins ${u.coins}`);

    const j = fakeInteraction({ commandName: 'slots', userId: 'u3', options: { bet: 100 } });
    await gambling.onCommand(j);
    assert.match(text(j.replies[0]), /Slow down/); // cooldown
});

test('blackjack full hand via buttons', async () => {
    const u = getStore().user('g1', 'u4');
    u.coins = 1000;
    const i = fakeInteraction({ commandName: 'blackjack', userId: 'u4', options: { bet: 100 } });
    await gambling.onCommand(i);
    const first = i.replies[0];
    if (first.components?.length) {
        // Someone else can't press the buttons
        const stranger = fakeInteraction({ userId: 'u9' });
        stranger.customId = 'bj:stand:g1:u4';
        await gambling.onComponent(stranger);
        assert.match(text(stranger.replies[0]), /isn't your hand/);

        const btn = fakeInteraction({ userId: 'u4' });
        btn.customId = 'bj:stand:g1:u4';
        await gambling.onComponent(btn);
        assert.ok(btn.replies[0].update.embeds[0].toJSON().description);
    }
    // Final balance must be one of: lose, push, win, blackjack
    assert.ok([900, 1000, 1100, 1150].includes(u.coins), `coins ${u.coins}`);
});

test('leaderboard and rank render', async () => {
    getStore().user('g1', 'u1').xp = 500;
    let i = fakeInteraction({ commandName: 'leaderboard', options: { board: 'coins' } });
    await leveling.onCommand(i);
    assert.match(text(i.replies[0]), /leaderboard/);
    i = fakeInteraction({ commandName: 'rank' });
    await leveling.onCommand(i);
    assert.match(text(i.replies[0]), /Level 3/); // 100 + 155 + 220 = 475 <= 500
});

test('addXp levels up, pays coins, and assigns tier roles', async () => {
    const store = getStore();
    store.guild('g1').levelRoles = { 1: 'r1', 2: 'r2' };
    const roles = new Map();
    const sent = [];
    const mkRole = (id) => ({ id, editable: true });
    const member = {
        id: 'u5',
        guild: { id: 'g1', roles: { cache: new Map([['r1', mkRole('r1')], ['r2', mkRole('r2')]]) }, channels: { cache: new Map() } },
        roles: { cache: roles, add: async (r) => roles.set(r.id, true), remove: async (r) => roles.delete(r.id) },
        toString: () => '<@u5>',
    };
    const channel = { isTextBased: () => true, send: async (m) => sent.push(m) };
    const before = store.user('g1', 'u5').coins;
    await leveling.addXp(member, 300, { announceChannel: channel });
    assert.strictEqual(store.user('g1', 'u5').level, 2);
    assert.strictEqual(store.user('g1', 'u5').coins, before + 25 + 50);
    assert.deepStrictEqual([...roles.keys()], ['r2']); // highest-only mode
    assert.match(sent[0].content, /level 2/);
});

test('deals: now/list/add/remove with mocked Steam', async () => {
    const wl = deals.diffDeals; // ensure module loaded
    assert.ok(wl);
    const mockFetch = async (url) => ({
        ok: true,
        json: async () => {
            if (url.includes('storesearch')) return { items: [{ id: 123, name: 'Mock Game' }] };
            const ids = new URL(url).searchParams.get('appids').split(',');
            return Object.fromEntries(
                ids.map((id) => [id, { success: true, data: { price_overview: { currency: 'USD', initial: 999, final: id === '3241660' ? 649 : 999, discount_percent: id === '3241660' ? 35 : 0, initial_formatted: '$9.99', final_formatted: id === '3241660' ? '$6.49' : '$9.99' } } }])
            );
        },
    });
    const ids = ['1966720', '3241660'];
    const prices = await deals.fetchPrices(ids, mockFetch);
    assert.strictEqual(prices['3241660'].discount_percent, 35);
    assert.deepStrictEqual(await deals.resolveGame('mock game', mockFetch), { appid: 123, name: 'Mock Game' });

    // Seeded watchlist, then simulate a completed check
    let i = fakeInteraction({ commandName: 'deals', sub: 'list' });
    await deals.onCommand(i);
    assert.match(text(i.replies[0]), /Lethal Company/);

    const state = getStore().data.global.deals;
    deals.diffDeals(state.watchlist, prices);
    state.lastCheck = Date.now();
    i = fakeInteraction({ commandName: 'deals', sub: 'now' });
    await deals.onCommand(i);
    assert.match(text(i.replies[0]), /R\.E\.P\.O\..*35% off/);

    i = fakeInteraction({ commandName: 'deals', sub: 'remove', options: { game: '945360' } });
    await deals.onCommand(i);
    assert.ok(!state.watchlist['945360']);

    i = fakeInteraction({ commandName: 'deals', sub: 'check', perms: false });
    await deals.onCommand(i);
    assert.match(text(i.replies[0]), /Manage Server/);

    const embed = deals.dealEmbed({ appid: 3241660, name: 'R.E.P.O.', initial: 999, final: 649, discount_percent: 35, currency: 'USD' }).toJSON();
    assert.match(embed.description, /\$9\.99.*\$6\.49/);
});

test('trivia falls back to local questions when the API is down', async () => {
    const qs = await trivia.fetchQuestions(5, 'games', 'any', async () => {
        throw new Error('offline');
    });
    assert.strictEqual(qs.length, 5);
    for (const q of qs) {
        assert.ok(q.q && q.a);
        assert.strictEqual(q.wrong.length, 3);
    }
    const ok = await trivia.fetchQuestions(1, 'any', 'easy', async () => ({
        json: async () => ({ response_code: 0, results: [{ category: 'X', difficulty: 'easy', question: 'Q%3F', correct_answer: 'A', incorrect_answers: ['B', 'C', 'D'] }] }),
    }));
    assert.strictEqual(ok[0].q, 'Q?');
});

test('store persists atomically and survives a corrupt main file', () => {
    const store = getStore();
    store.user('g1', 'persist').coins = 4242;
    store.flush();
    store.flush(); // second flush creates the .bak
    const reloaded = new Store(dir);
    assert.strictEqual(reloaded.user('g1', 'persist').coins, 4242);
    fs.writeFileSync(path.join(dir, 'store.json'), '{ broken');
    const fromBackup = new Store(dir);
    assert.strictEqual(fromBackup.user('g1', 'persist').coins, 4242);
});
