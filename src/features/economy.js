// Virtual economy: balance, daily rewards with streaks, transfers, shop & inventory.
// Passive income (per message / per voice minute) is awarded in leveling.js.
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { getStore } = require('../lib/db');
const { EPHEMERAL, money, duration } = require('../lib/util');

const ec = config.economy;
const DAY = 24 * 60 * 60 * 1000;

const DEFAULT_SHOP = [
    {
        id: 'xp-boost',
        name: '⚡ XP Boost (1h)',
        price: 750,
        type: 'xp_boost',
        description: 'Double XP from chat and voice for one hour. Stacks time.',
    },
    { id: 'cookie', name: '🍪 Cookie', price: 50, type: 'collectible', description: 'A cookie. You can give it to someone.' },
    { id: 'trophy', name: '🏆 Tiny Trophy', price: 2500, type: 'collectible', description: 'Proof you were here.' },
    { id: 'golden-candy', name: '✨ Golden Candy', price: 10000, type: 'collectible', description: 'Pure flex. Does nothing.' },
];

function getShop(guildId) {
    const store = getStore();
    const g = store.guild(guildId);
    if (!g.shop) {
        g.shop = DEFAULT_SHOP.map((item) => ({ ...item }));
        store.save();
    }
    return g.shop;
}

function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
}

function findItem(guildId, query) {
    const shop = getShop(guildId);
    const q = (query || '').toLowerCase();
    return shop.find((i) => i.id === q) || shop.find((i) => i.name.toLowerCase().includes(q));
}

/**
 * Daily reward with streaks. Pure function so it can be unit tested.
 * Claim window: 24h after the last claim. Streak continues if claimed
 * within 48h of the last claim, otherwise it resets to 1.
 */
function computeDaily(user, now = Date.now()) {
    const since = now - user.lastDaily;
    if (user.lastDaily && since < DAY) return { ok: false, waitMs: DAY - since };
    const streak = user.lastDaily && since < 2 * DAY ? user.dailyStreak + 1 : 1;
    const bonusDays = Math.min(streak, ec.dailyStreakCap) - 1;
    return { ok: true, streak, amount: ec.dailyBase + bonusDays * ec.dailyStreakBonus };
}

const itemOption = (o, desc = 'Item') => o.setName('item').setDescription(desc).setRequired(true).setAutocomplete(true);

const commands = [
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription(`Check your ${ec.currencyName}`)
        .addUserOption((o) => o.setName('user').setDescription('Someone else')),
    new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward (streaks give bonus)'),
    new SlashCommandBuilder()
        .setName('pay')
        .setDescription(`Send ${ec.currencyName} to someone`)
        .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
        .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName('shop').setDescription('Browse the shop'),
    new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Buy something from the shop')
        .addStringOption((o) => itemOption(o))
        .addIntegerOption((o) => o.setName('quantity').setDescription('How many').setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('See what you own')
        .addUserOption((o) => o.setName('user').setDescription('Someone else')),
    new SlashCommandBuilder()
        .setName('use')
        .setDescription('Use an item from your inventory')
        .addStringOption((o) => itemOption(o)),
    new SlashCommandBuilder()
        .setName('gift')
        .setDescription('Give an item from your inventory to someone')
        .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
        .addStringOption((o) => itemOption(o)),
    new SlashCommandBuilder()
        .setName('shopadmin')
        .setDescription('Manage the shop')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) =>
            s
                .setName('add')
                .setDescription('Add or update an item')
                .addStringOption((o) => o.setName('name').setDescription('Display name (emoji welcome)').setRequired(true).setMaxLength(50))
                .addIntegerOption((o) => o.setName('price').setDescription('Price').setMinValue(1).setRequired(true))
                .addStringOption((o) => o.setName('description').setDescription('Description').setMaxLength(100))
                .addRoleOption((o) => o.setName('role').setDescription('If set, buying this item grants the role'))
        )
        .addSubcommand((s) =>
            s
                .setName('remove')
                .setDescription('Remove an item')
                .addStringOption((o) => itemOption(o))
        )
        .addSubcommand((s) => s.setName('reset').setDescription('Restore the default shop')),
    new SlashCommandBuilder()
        .setName('economy')
        .setDescription(`Adjust a member's ${ec.currencyName}`)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) =>
            s
                .setName('give')
                .setDescription('Give (or take, with a negative number)')
                .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
                .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true))
        ),
];

async function handleBalance(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const user = getStore().user(interaction.guildId, target.id);
    return interaction.reply({ content: `${target.id === interaction.user.id ? 'You have' : `${target} has`} ${money(user.coins)}`, allowedMentions: { parse: [] } });
}

async function handleDaily(interaction) {
    const store = getStore();
    const user = store.user(interaction.guildId, interaction.user.id);
    const result = computeDaily(user);
    if (!result.ok) {
        return interaction.reply({ content: `⏳ Come back in **${duration(result.waitMs)}** for your next daily.`, flags: EPHEMERAL });
    }
    user.lastDaily = Date.now();
    user.dailyStreak = result.streak;
    user.coins += result.amount;
    store.save();
    const streakLine = result.streak > 1 ? `\n🔥 **${result.streak}-day streak!**` : '\nClaim again tomorrow to start a streak.';
    return interaction.reply({ content: `🎁 You claimed ${money(result.amount)}!${streakLine}\nBalance: ${money(user.coins)}` });
}

async function handlePay(interaction) {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    if (target.bot || target.id === interaction.user.id) {
        return interaction.reply({ content: 'Pick a real person who isn\'t you.', flags: EPHEMERAL });
    }
    const store = getStore();
    const from = store.user(interaction.guildId, interaction.user.id);
    if (from.coins < amount) return interaction.reply({ content: `You only have ${money(from.coins)}.`, flags: EPHEMERAL });
    const to = store.user(interaction.guildId, target.id);
    from.coins -= amount;
    to.coins += amount;
    store.save();
    return interaction.reply({ content: `💸 ${interaction.user} sent ${money(amount)} to ${target}.` });
}

async function handleShop(interaction) {
    const shop = getShop(interaction.guildId);
    const embed = new EmbedBuilder()
        .setColor(0xffb6c1)
        .setTitle(`🛒 ${interaction.guild.name} Shop`)
        .setDescription(
            shop.length
                ? shop
                      .map((i) => {
                          const role = i.roleId ? ` · grants <@&${i.roleId}>` : '';
                          return `**${i.name}** — ${money(i.price)}${role}\n${i.description || ''}\n\`/buy item:${i.id}\``;
                      })
                      .join('\n\n')
                : 'The shop is empty.'
        )
        .setFooter({ text: `Balance: ${getStore().user(interaction.guildId, interaction.user.id).coins.toLocaleString()} ${ec.currencyName}` });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleBuy(interaction) {
    const item = findItem(interaction.guildId, interaction.options.getString('item'));
    if (!item) return interaction.reply({ content: 'No item by that name. Try `/shop`.', flags: EPHEMERAL });
    const qty = item.type === 'role' ? 1 : interaction.options.getInteger('quantity') || 1;
    const store = getStore();
    const user = store.user(interaction.guildId, interaction.user.id);
    const cost = item.price * qty;

    if (item.type === 'role') {
        const role = interaction.guild.roles.cache.get(item.roleId);
        if (!role) return interaction.reply({ content: 'That role no longer exists. Ask an admin to fix the shop.', flags: EPHEMERAL });
        if (interaction.member.roles.cache.has(role.id)) return interaction.reply({ content: `You already have ${role}.`, flags: EPHEMERAL });
        if (!role.editable) return interaction.reply({ content: 'I can\'t assign that role (my role is below it).', flags: EPHEMERAL });
        if (user.coins < cost) return interaction.reply({ content: `You need ${money(cost)} but have ${money(user.coins)}.`, flags: EPHEMERAL });
        user.coins -= cost;
        store.save();
        await interaction.member.roles.add(role, 'Bought in shop');
        return interaction.reply({ content: `✅ Bought ${role} for ${money(cost)}!`, allowedMentions: { parse: [] } });
    }

    if (user.coins < cost) return interaction.reply({ content: `You need ${money(cost)} but have ${money(user.coins)}.`, flags: EPHEMERAL });
    user.coins -= cost;
    user.inventory[item.id] = (user.inventory[item.id] || 0) + qty;
    store.save();
    const hint = item.type === 'xp_boost' ? ` Activate it with \`/use item:${item.id}\`.` : '';
    return interaction.reply({ content: `✅ Bought **${qty}× ${item.name}** for ${money(cost)}.${hint}` });
}

async function handleInventory(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const user = getStore().user(interaction.guildId, target.id);
    const shop = getShop(interaction.guildId);
    const lines = Object.entries(user.inventory)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => `${shop.find((i) => i.id === id)?.name || id} × **${n}**`);
    if (user.boostUntil > Date.now()) lines.push(`\n⚡ XP boost active for ${duration(user.boostUntil - Date.now())}`);
    const embed = new EmbedBuilder()
        .setColor(0xffb6c1)
        .setTitle(`🎒 ${target.displayName ?? target.username}'s inventory`)
        .setDescription(lines.join('\n') || '*Empty.* Visit `/shop`.')
        .setFooter({ text: `Balance: ${user.coins.toLocaleString()} ${ec.currencyName}` });
    return interaction.reply({ embeds: [embed] });
}

async function handleUse(interaction) {
    const item = findItem(interaction.guildId, interaction.options.getString('item'));
    const store = getStore();
    const user = store.user(interaction.guildId, interaction.user.id);
    if (!item || !user.inventory[item.id]) return interaction.reply({ content: 'You don\'t have that item.', flags: EPHEMERAL });

    if (item.type === 'xp_boost') {
        user.inventory[item.id]--;
        user.boostUntil = Math.max(Date.now(), user.boostUntil) + 60 * 60 * 1000;
        store.save();
        return interaction.reply({ content: `⚡ 2× XP active for **${duration(user.boostUntil - Date.now())}**. Go chat!` });
    }
    if (item.id === 'cookie') {
        user.inventory[item.id]--;
        store.save();
        return interaction.reply({ content: `🍪 ${interaction.user} ate a cookie. Delicious.` });
    }
    return interaction.reply({ content: `**${item.name}** is a collectible. Admire it, or \`/gift\` it to someone.`, flags: EPHEMERAL });
}

async function handleGift(interaction) {
    const target = interaction.options.getUser('user');
    if (target.bot || target.id === interaction.user.id) return interaction.reply({ content: 'Pick someone else.', flags: EPHEMERAL });
    const item = findItem(interaction.guildId, interaction.options.getString('item'));
    const store = getStore();
    const from = store.user(interaction.guildId, interaction.user.id);
    if (!item || !from.inventory[item.id]) return interaction.reply({ content: 'You don\'t have that item.', flags: EPHEMERAL });
    const to = store.user(interaction.guildId, target.id);
    from.inventory[item.id]--;
    to.inventory[item.id] = (to.inventory[item.id] || 0) + 1;
    store.save();
    return interaction.reply({ content: `🎁 ${interaction.user} gave ${target} a **${item.name}**!` });
}

async function handleShopAdmin(interaction) {
    const store = getStore();
    const shop = getShop(interaction.guildId);
    const sub = interaction.options.getSubcommand();
    if (sub === 'reset') {
        store.guild(interaction.guildId).shop = DEFAULT_SHOP.map((i) => ({ ...i }));
        store.save();
        return interaction.reply({ content: 'Shop restored to defaults.', flags: EPHEMERAL });
    }
    if (sub === 'remove') {
        const item = findItem(interaction.guildId, interaction.options.getString('item'));
        if (!item) return interaction.reply({ content: 'Item not found.', flags: EPHEMERAL });
        shop.splice(shop.indexOf(item), 1);
        store.save();
        return interaction.reply({ content: `Removed **${item.name}**.`, flags: EPHEMERAL });
    }
    const name = interaction.options.getString('name');
    const role = interaction.options.getRole('role');
    if (role && !role.editable) {
        return interaction.reply({ content: `I can't assign ${role}. Move my role above it first.`, flags: EPHEMERAL });
    }
    const item = {
        id: slugify(name) || `item-${shop.length + 1}`,
        name,
        price: interaction.options.getInteger('price'),
        description: interaction.options.getString('description') || '',
        type: role ? 'role' : 'collectible',
        ...(role ? { roleId: role.id } : {}),
    };
    const existing = shop.findIndex((i) => i.id === item.id);
    if (existing >= 0) shop[existing] = { ...shop[existing], ...item, type: role ? 'role' : shop[existing].type };
    else shop.push(item);
    store.save();
    return interaction.reply({ content: `✅ ${existing >= 0 ? 'Updated' : 'Added'} **${name}** (${money(item.price)}).`, flags: EPHEMERAL });
}

async function handleEconomyAdmin(interaction) {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const store = getStore();
    const user = store.user(interaction.guildId, target.id);
    user.coins = Math.max(0, user.coins + amount);
    store.save();
    return interaction.reply({ content: `${target} now has ${money(user.coins)}.`, flags: EPHEMERAL });
}

async function onAutocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    let items = getShop(interaction.guildId);
    if (['use', 'gift'].includes(interaction.commandName)) {
        const inv = getStore().user(interaction.guildId, interaction.user.id).inventory;
        items = items.filter((i) => inv[i.id] > 0);
    }
    return interaction.respond(
        items
            .filter((i) => i.name.toLowerCase().includes(focused) || i.id.includes(focused))
            .slice(0, 25)
            .map((i) => ({ name: `${i.name} — ${i.price} ${ec.currencyName}`.slice(0, 100), value: i.id }))
    );
}

async function onCommand(interaction) {
    const handlers = {
        balance: handleBalance,
        daily: handleDaily,
        pay: handlePay,
        shop: handleShop,
        buy: handleBuy,
        inventory: handleInventory,
        use: handleUse,
        gift: handleGift,
        shopadmin: handleShopAdmin,
        economy: handleEconomyAdmin,
    };
    return handlers[interaction.commandName]?.(interaction);
}

module.exports = { name: 'economy', commands, onCommand, onAutocomplete, computeDaily, slugify, DEFAULT_SHOP };
