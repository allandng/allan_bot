// Friendslop deal alerts: watches Steam prices for a list of co-op party games
// and posts when one goes on sale. Uses Steam's public store API (no key).
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../config');
const { getStore } = require('../lib/db');
const { EPHEMERAL } = require('../lib/util');
const { log_error, log_info, log_warning } = require('../logger');
const SEED = require('../data/friendslop');

const STEAM = 'https://store.steampowered.com';
const BATCH = 50;

function getWatchlist() {
    const store = getStore();
    const deals = store.global('deals', null);
    if (!deals) {
        const seeded = { watchlist: {}, lastCheck: 0 };
        for (const g of SEED) seeded.watchlist[g.appid] = { name: g.name, lastDiscount: 0, lastFinal: null, lastInitial: null };
        store.data.global.deals = seeded;
        store.save();
        return seeded;
    }
    return deals;
}

/**
 * Fetch price_overview for many app IDs. Steam only allows multiple appids in
 * one call when filters=price_overview. Returns { [appid]: price | null }.
 */
async function fetchPrices(appids, fetchImpl = globalThis.fetch) {
    const out = {};
    for (let i = 0; i < appids.length; i += BATCH) {
        const chunk = appids.slice(i, i + BATCH);
        const url = `${STEAM}/api/appdetails?appids=${chunk.join(',')}&cc=${config.deals.countryCode}&filters=price_overview`;
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`Steam HTTP ${res.status}`);
        const body = await res.json();
        for (const id of chunk) {
            const entry = body?.[id];
            // Free games and unreleased games have no price_overview (data is []).
            out[id] = entry?.success && entry.data && !Array.isArray(entry.data) ? entry.data.price_overview || null : null;
        }
    }
    return out;
}

/**
 * Decide which games just went on sale (or got a deeper discount) and update
 * the stored state. Pure apart from mutating `watchlist`, so it's unit tested.
 */
function diffDeals(watchlist, prices, minDiscount = 1) {
    const newDeals = [];
    for (const [appid, price] of Object.entries(prices)) {
        const game = watchlist[appid];
        if (!game || !price) continue;
        const discount = price.discount_percent || 0;
        const isNew = discount >= minDiscount && discount > (game.lastDiscount || 0);
        game.lastDiscount = discount;
        game.lastFinal = price.final;
        game.lastInitial = price.initial;
        game.currency = price.currency;
        game.finalFormatted = price.final_formatted;
        game.initialFormatted = price.initial_formatted;
        if (isNew) newDeals.push({ appid: Number(appid), name: game.name, ...price });
    }
    return newDeals;
}

const formatCents = (cents, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

function dealEmbed(deal) {
    const was = deal.initial_formatted || formatCents(deal.initial, deal.currency);
    const now = deal.final_formatted || formatCents(deal.final, deal.currency);
    return new EmbedBuilder()
        .setColor(0x66c0f4)
        .setTitle(`🔥 ${deal.name} is ${deal.discount_percent}% off`)
        .setURL(`${STEAM}/app/${deal.appid}/`)
        .setDescription(`~~${was}~~ → **${now}** on Steam`)
        .setImage(`https://cdn.cloudflare.steamstatic.com/steam/apps/${deal.appid}/header.jpg`)
        .setFooter({ text: 'Friendslop deal alert · get the group together' });
}

async function announce(client, deals) {
    if (!deals.length) return;
    const store = getStore();
    for (const guild of client.guilds.cache.values()) {
        const g = store.guild(guild.id);
        const channelId = g.dealsChannelId || config.channels.deals;
        if (!channelId) continue;
        const channel = guild.channels.cache.get(channelId);
        if (!channel?.isTextBased()) continue;
        // Discord allows up to 10 embeds per message.
        for (let i = 0; i < deals.length; i += 10) {
            await channel
                .send({
                    content: i === 0 && g.dealsRoleId ? `<@&${g.dealsRoleId}> new friendslop deal${deals.length > 1 ? 's' : ''}!` : undefined,
                    embeds: deals.slice(i, i + 10).map(dealEmbed),
                    allowedMentions: { roles: g.dealsRoleId ? [g.dealsRoleId] : [] },
                })
                .catch((err) => log_error(`Could not post deals in ${guild.name}`, err));
        }
    }
}

async function checkDeals(client) {
    const deals = getWatchlist();
    const ids = Object.keys(deals.watchlist);
    if (!ids.length) return [];
    const prices = await fetchPrices(ids);
    const fresh = diffDeals(deals.watchlist, prices, config.deals.minDiscount);
    deals.lastCheck = Date.now();
    getStore().save();
    log_info(`Deals: checked ${ids.length} games, ${fresh.length} new sale(s).`);
    await announce(client, fresh);
    return fresh;
}

// Resolve "1966720", a store URL, or a name to { appid, name }.
async function resolveGame(query, fetchImpl = globalThis.fetch) {
    const idMatch = query.match(/store\.steampowered\.com\/app\/(\d+)/) || query.match(/^\s*(\d+)\s*$/);
    if (idMatch) {
        const res = await fetchImpl(`${STEAM}/api/appdetails?appids=${idMatch[1]}&cc=${config.deals.countryCode}`, { signal: AbortSignal.timeout(10000) });
        const body = await res.json();
        const entry = body?.[idMatch[1]];
        return entry?.success ? { appid: Number(idMatch[1]), name: entry.data.name } : null;
    }
    const res = await fetchImpl(`${STEAM}/api/storesearch/?term=${encodeURIComponent(query)}&cc=${config.deals.countryCode}&l=en`, { signal: AbortSignal.timeout(10000) });
    const body = await res.json();
    const item = body?.items?.[0];
    return item ? { appid: item.id, name: item.name } : null;
}

// --- Commands ----------------------------------------------------------------

const commands = [
    new SlashCommandBuilder()
        .setName('deals')
        .setDescription('Friendslop game deals on Steam')
        .addSubcommand((s) => s.setName('now').setDescription('Show watched games that are on sale right now'))
        .addSubcommand((s) => s.setName('list').setDescription('Show the watchlist'))
        .addSubcommand((s) =>
            s
                .setName('add')
                .setDescription('Watch a game (admin)')
                .addStringOption((o) => o.setName('game').setDescription('Name, Steam app ID, or store URL').setRequired(true))
        )
        .addSubcommand((s) =>
            s
                .setName('remove')
                .setDescription('Stop watching a game (admin)')
                .addStringOption((o) => o.setName('game').setDescription('Game').setRequired(true).setAutocomplete(true))
        )
        .addSubcommand((s) =>
            s
                .setName('setup')
                .setDescription('Where to post deal alerts (admin)')
                .addChannelOption((o) =>
                    o
                        .setName('channel')
                        .setDescription('Alert channel')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
                .addRoleOption((o) => o.setName('ping').setDescription('Role to ping on new deals (optional)'))
        )
        .addSubcommand((s) => s.setName('check').setDescription('Check prices right now (admin)')),
];

const ADMIN_SUBS = new Set(['add', 'remove', 'setup', 'check']);

async function onCommand(interaction) {
    const sub = interaction.options.getSubcommand();
    if (ADMIN_SUBS.has(sub) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need **Manage Server** for that.', flags: EPHEMERAL });
    }
    const deals = getWatchlist();

    if (sub === 'now') {
        const onSale = Object.entries(deals.watchlist)
            .filter(([, g]) => g.lastDiscount > 0)
            .sort((a, b) => b[1].lastDiscount - a[1].lastDiscount);
        if (!deals.lastCheck) return interaction.reply({ content: 'Prices haven\'t been checked yet. Try again in a minute.', flags: EPHEMERAL });
        const lines = onSale.map(
            ([id, g]) => `**[${g.name}](${STEAM}/app/${id}/)** — ${g.lastDiscount}% off · ~~${g.initialFormatted}~~ **${g.finalFormatted}**`
        );
        const embed = new EmbedBuilder()
            .setColor(0x66c0f4)
            .setTitle('🎮 Friendslop on sale')
            .setDescription(lines.join('\n') || 'Nothing on sale right now. I\'ll post here when something drops.')
            .setFooter({ text: 'Last checked' })
            .setTimestamp(deals.lastCheck);
        return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'list') {
        const lines = Object.entries(deals.watchlist)
            .sort((a, b) => a[1].name.localeCompare(b[1].name))
            .map(([id, g]) => `[${g.name}](${STEAM}/app/${id}/)${g.lastDiscount > 0 ? ` · **${g.lastDiscount}% off**` : ''}`);
        return interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x66c0f4).setTitle(`👀 Watching ${lines.length} games`).setDescription(lines.join('\n').slice(0, 4000) || 'Empty.')],
            flags: EPHEMERAL,
        });
    }

    if (sub === 'add') {
        await interaction.deferReply({ flags: EPHEMERAL });
        const game = await resolveGame(interaction.options.getString('game')).catch(() => null);
        if (!game) return interaction.editReply('Couldn\'t find that game on Steam. Try the store URL.');
        deals.watchlist[game.appid] ??= { name: game.name, lastDiscount: 0, lastFinal: null, lastInitial: null };
        getStore().save();
        return interaction.editReply(`✅ Watching **[${game.name}](${STEAM}/app/${game.appid}/)**. It'll be checked on the next price run.`);
    }

    if (sub === 'remove') {
        const id = interaction.options.getString('game');
        const game = deals.watchlist[id];
        if (!game) return interaction.reply({ content: 'That game isn\'t on the watchlist.', flags: EPHEMERAL });
        delete deals.watchlist[id];
        getStore().save();
        return interaction.reply({ content: `Removed **${game.name}**.`, flags: EPHEMERAL });
    }

    if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('ping');
        const g = getStore().guild(interaction.guildId);
        g.dealsChannelId = channel.id;
        g.dealsRoleId = role?.id || null;
        getStore().save();
        return interaction.reply({
            content: `✅ Deal alerts will post in ${channel}${role ? ` and ping ${role}` : ''}. Checking every ${config.deals.checkHours}h.`,
            flags: EPHEMERAL,
            allowedMentions: { parse: [] },
        });
    }

    if (sub === 'check') {
        await interaction.deferReply({ flags: EPHEMERAL });
        try {
            const fresh = await checkDeals(interaction.client);
            return interaction.editReply(fresh.length ? `Found ${fresh.length} new deal(s) and posted them.` : 'Checked. No new sales since last time (see `/deals now`).');
        } catch (err) {
            log_error('Manual deal check failed', err);
            return interaction.editReply('Steam didn\'t respond. Try again later.');
        }
    }
}

async function onAutocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase();
    const { watchlist } = getWatchlist();
    return interaction.respond(
        Object.entries(watchlist)
            .filter(([, g]) => g.name.toLowerCase().includes(q))
            .slice(0, 25)
            .map(([id, g]) => ({ name: g.name.slice(0, 100), value: id }))
    );
}

function setup(client) {
    client.once('clientReady', () => {
        const run = () => checkDeals(client).catch((err) => log_warning(`Deal check failed: ${err.message}`));
        setTimeout(run, 60_000).unref?.();
        setInterval(run, Math.max(1, config.deals.checkHours) * 60 * 60 * 1000).unref?.();
    });
}

module.exports = { name: 'deals', commands, onCommand, onAutocomplete, setup, fetchPrices, diffDeals, resolveGame, dealEmbed };
