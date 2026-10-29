// Leveling & XP: text + voice activity, tiered level roles, leaderboards.
const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
} = require('discord.js');
const config = require('../config');
const { getStore } = require('../lib/db');
const { EPHEMERAL, randInt, money, progressBar } = require('../lib/util');
const { log_error, log_info } = require('../logger');

const cfg = config.leveling;

// MEE6-style curve: XP needed to go from `level` to `level + 1`.
function xpToNext(level) {
    return 5 * level * level + 50 * level + 100;
}

function totalXpForLevel(level) {
    let total = 0;
    for (let l = 0; l < level; l++) total += xpToNext(l);
    return total;
}

function levelFromXp(xp) {
    let level = 0;
    let remaining = xp;
    while (remaining >= xpToNext(level)) {
        remaining -= xpToNext(level);
        level++;
    }
    return { level, into: remaining, needed: xpToNext(level) };
}

function boostMultiplier(user, now = Date.now()) {
    return user.boostUntil > now ? 2 : 1;
}

/**
 * Add XP to a member and handle level-ups (coins, roles, announcement).
 * Exported so other modules (trivia, admin commands) can grant XP.
 */
async function addXp(member, amount, { announceChannel = null } = {}) {
    const store = getStore();
    const user = store.user(member.guild.id, member.id);
    const before = user.level;
    user.xp = Math.max(0, user.xp + amount);
    user.level = levelFromXp(user.xp).level;
    store.save();

    if (user.level > before) {
        let reward = 0;
        for (let l = before + 1; l <= user.level; l++) reward += l * cfg.levelUpCoinsPerLevel;
        user.coins += reward;
        store.save();
        await syncLevelRoles(member, user.level).catch((err) => log_error('Level role sync failed', err));
        await announceLevelUp(member, user.level, reward, announceChannel);
    } else if (user.level < before) {
        await syncLevelRoles(member, user.level).catch((err) => log_error('Level role sync failed', err));
    }
    return user;
}

async function announceLevelUp(member, level, reward, fallbackChannel) {
    let channel = null;
    if (config.channels.levelUp) {
        channel = member.guild.channels.cache.get(config.channels.levelUp) || null;
    }
    channel ??= fallbackChannel;
    if (!channel || !channel.isTextBased()) return;

    const roleId = getGuildLevelRoles(member.guild.id).find(([lvl]) => lvl === level)?.[1];
    const lines = [`🎉 ${member} reached **level ${level}**!`];
    if (reward > 0) lines.push(`Level-up bonus: ${money(reward)}`);
    if (roleId) lines.push(`Unlocked <@&${roleId}> 🏅`);
    await channel
        .send({ content: lines.join('\n'), allowedMentions: { users: [member.id], roles: [] } })
        .catch(() => {});
}

// Sorted [[level, roleId], ...]
function getGuildLevelRoles(guildId) {
    const g = getStore().guild(guildId);
    return Object.entries(g.levelRoles)
        .map(([lvl, roleId]) => [Number(lvl), roleId])
        .sort((a, b) => a[0] - b[0]);
}

async function syncLevelRoles(member, level) {
    const tiers = getGuildLevelRoles(member.guild.id);
    if (!tiers.length) return;
    const { stackLevelRoles } = getStore().guild(member.guild.id);

    const earned = tiers.filter(([lvl]) => lvl <= level);
    const keep = stackLevelRoles ? earned.map(([, id]) => id) : earned.slice(-1).map(([, id]) => id);

    for (const [, roleId] of tiers) {
        const role = member.guild.roles.cache.get(roleId);
        if (!role || !role.editable) continue;
        const has = member.roles.cache.has(roleId);
        if (keep.includes(roleId) && !has) await member.roles.add(role, `Reached level ${level}`);
        if (!keep.includes(roleId) && has) await member.roles.remove(role, 'Level tier changed');
    }
}

// --- Activity tracking -------------------------------------------------------

async function onMessage(message) {
    if (message.author.bot || !message.inGuild()) return;
    if (cfg.noXpChannels.includes(message.channelId)) return;
    if (message.content.startsWith('$')) return; // bot commands don't count

    const store = getStore();
    const user = store.user(message.guildId, message.author.id);
    const now = Date.now();
    user.messages++;
    if (now - user.lastXpAt < cfg.textCooldownSec * 1000) {
        store.save();
        return;
    }
    user.lastXpAt = now;
    user.coins += randInt(config.economy.messageCoinsMin, config.economy.messageCoinsMax);

    const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;
    const amount = randInt(cfg.textXpMin, cfg.textXpMax) * boostMultiplier(user, now);
    await addXp(member, amount, { announceChannel: message.channel });
}

// Every minute, award voice XP to people actually hanging out together.
async function voiceTick(client) {
    const store = getStore();
    for (const guild of client.guilds.cache.values()) {
        const voiceChannels = guild.channels.cache.filter(
            (c) =>
                (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) &&
                c.id !== guild.afkChannelId
        );
        for (const channel of voiceChannels.values()) {
            const humans = channel.members.filter((m) => !m.user.bot);
            if (humans.size < cfg.voiceMinMembers) continue;
            for (const member of humans.values()) {
                const v = member.voice;
                if (v.selfDeaf || v.serverDeaf) continue;
                const user = store.user(guild.id, member.id);
                user.voiceMinutes++;
                user.coins += config.economy.voiceCoinsPerMinute;
                await addXp(member, cfg.voiceXpPerMinute * boostMultiplier(user), {
                    announceChannel: channel, // voice channels have their own text chat
                }).catch((err) => log_error('Voice XP failed', err));
            }
        }
    }
    store.save();
}

// --- Commands ----------------------------------------------------------------

const BOARDS = {
    xp: { label: 'XP', value: (u) => u.xp, fmt: (u) => `Lvl ${u.level} · ${u.xp.toLocaleString()} XP` },
    voice: { label: 'Voice time', value: (u) => u.voiceMinutes, fmt: (u) => `${(u.voiceMinutes / 60).toFixed(1)} h in voice` },
    messages: { label: 'Messages', value: (u) => u.messages, fmt: (u) => `${u.messages.toLocaleString()} messages` },
    coins: { label: config.economy.currencyName, value: (u) => u.coins, fmt: (u) => money(u.coins) },
    trivia: { label: 'Trivia', value: (u) => u.triviaPoints, fmt: (u) => `${u.triviaPoints.toLocaleString()} pts · ${u.triviaCorrect} correct` },
    scramble: { label: 'Scramble', value: (u) => u.scrambleWins, fmt: (u) => `${u.scrambleWins} wins` },
};

const commands = [
    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Show your level and XP progress')
        .addUserOption((o) => o.setName('user').setDescription('Someone else')),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Server leaderboards')
        .addStringOption((o) =>
            o
                .setName('board')
                .setDescription('Which leaderboard')
                .addChoices(...Object.entries(BOARDS).map(([value, b]) => ({ name: b.label, value })))
        )
        .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),
    new SlashCommandBuilder()
        .setName('levelrole')
        .setDescription('Manage roles unlocked by level')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand((s) =>
            s
                .setName('add')
                .setDescription('Unlock a role at a level')
                .addIntegerOption((o) => o.setName('level').setDescription('Level').setMinValue(1).setRequired(true))
                .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true))
        )
        .addSubcommand((s) =>
            s
                .setName('remove')
                .setDescription('Remove the role for a level')
                .addIntegerOption((o) => o.setName('level').setDescription('Level').setMinValue(1).setRequired(true))
        )
        .addSubcommand((s) => s.setName('list').setDescription('List level roles'))
        .addSubcommand((s) =>
            s
                .setName('mode')
                .setDescription('Keep all earned tier roles, or only the highest')
                .addBooleanOption((o) =>
                    o.setName('stack').setDescription('true = keep all, false = only highest').setRequired(true)
                )
        ),
    new SlashCommandBuilder()
        .setName('xpadmin')
        .setDescription('Adjust a member\'s XP')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) =>
            s
                .setName('give')
                .setDescription('Give (or take, with a negative number) XP')
                .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
                .addIntegerOption((o) => o.setName('amount').setDescription('XP').setRequired(true))
        )
        .addSubcommand((s) =>
            s
                .setName('reset')
                .setDescription('Reset a member to level 0')
                .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        ),
];

async function handleRank(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    if (target.bot) return interaction.reply({ content: 'Bots don\'t level up.', flags: EPHEMERAL });
    const store = getStore();
    const user = store.user(interaction.guildId, target.id);
    const { level, into, needed } = levelFromXp(user.xp);

    const ranked = store
        .guildUsers(interaction.guildId)
        .sort((a, b) => b[1].xp - a[1].xp)
        .findIndex(([id]) => id === target.id);

    const embed = new EmbedBuilder()
        .setColor(0xffb6c1)
        .setAuthor({ name: target.displayName ?? target.username, iconURL: target.displayAvatarURL() })
        .setTitle(`Level ${level}`)
        .setDescription(`${progressBar(into, needed)}\n**${into.toLocaleString()} / ${needed.toLocaleString()} XP** to level ${level + 1}`)
        .addFields(
            { name: 'Rank', value: `#${ranked + 1}`, inline: true },
            { name: 'Total XP', value: user.xp.toLocaleString(), inline: true },
            { name: 'Balance', value: money(user.coins), inline: true },
            { name: 'Messages', value: user.messages.toLocaleString(), inline: true },
            { name: 'Voice', value: `${(user.voiceMinutes / 60).toFixed(1)} h`, inline: true }
        );
    if (user.boostUntil > Date.now()) {
        embed.setFooter({ text: '⚡ 2× XP boost active' });
    }
    return interaction.reply({ embeds: [embed] });
}

async function handleLeaderboard(interaction) {
    const key = interaction.options.getString('board') || 'xp';
    const board = BOARDS[key];
    const page = interaction.options.getInteger('page') || 1;
    const perPage = 10;

    const rows = getStore()
        .guildUsers(interaction.guildId)
        .filter(([, u]) => board.value(u) > 0)
        .sort((a, b) => board.value(b[1]) - board.value(a[1]));
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    const slice = rows.slice((page - 1) * perPage, page * perPage);

    const medals = ['🥇', '🥈', '🥉'];
    const lines = slice.map(([id, u], i) => {
        const pos = (page - 1) * perPage + i;
        return `${medals[pos] || `\`#${pos + 1}\``} <@${id}> — ${board.fmt(u)}`;
    });

    const embed = new EmbedBuilder()
        .setColor(0xffb6c1)
        .setTitle(`🏆 ${board.label} leaderboard`)
        .setDescription(lines.join('\n') || '*Nobody on the board yet. Go be active!*')
        .setFooter({ text: `Page ${Math.min(page, pages)} of ${pages}` });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleLevelRole(interaction) {
    const store = getStore();
    const g = store.guild(interaction.guildId);
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
        const level = interaction.options.getInteger('level');
        const role = interaction.options.getRole('role');
        if (!role.editable) {
            return interaction.reply({
                content: `I can't assign ${role}. Move my bot role above it in Server Settings → Roles.`,
                flags: EPHEMERAL,
            });
        }
        g.levelRoles[level] = role.id;
        store.save();
        return interaction.reply({ content: `✅ ${role} now unlocks at **level ${level}**.`, flags: EPHEMERAL });
    }
    if (sub === 'remove') {
        const level = interaction.options.getInteger('level');
        delete g.levelRoles[level];
        store.save();
        return interaction.reply({ content: `🗑️ Removed the level ${level} role.`, flags: EPHEMERAL });
    }
    if (sub === 'mode') {
        g.stackLevelRoles = interaction.options.getBoolean('stack');
        store.save();
        return interaction.reply({
            content: g.stackLevelRoles
                ? '✅ Members keep every tier role they\'ve earned.'
                : '✅ Members keep only their highest tier role.',
            flags: EPHEMERAL,
        });
    }
    const tiers = getGuildLevelRoles(interaction.guildId);
    return interaction.reply({
        content: tiers.length
            ? `**Level roles** (${g.stackLevelRoles ? 'stacking' : 'highest only'})\n` +
              tiers.map(([lvl, id]) => `Level ${lvl} → <@&${id}>`).join('\n')
            : 'No level roles yet. Add one with `/levelrole add`.',
        flags: EPHEMERAL,
        allowedMentions: { parse: [] },
    });
}

async function handleXpAdmin(interaction) {
    const target = interaction.options.getUser('user');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That user isn\'t in this server.', flags: EPHEMERAL });

    if (interaction.options.getSubcommand() === 'reset') {
        const store = getStore();
        const user = store.user(interaction.guildId, target.id);
        user.xp = 0;
        user.level = 0;
        store.save();
        await syncLevelRoles(member, 0).catch(() => {});
        return interaction.reply({ content: `Reset ${target} to level 0.`, flags: EPHEMERAL });
    }
    const amount = interaction.options.getInteger('amount');
    const user = await addXp(member, amount, { announceChannel: interaction.channel });
    return interaction.reply({
        content: `${amount >= 0 ? 'Gave' : 'Took'} ${Math.abs(amount)} XP ${amount >= 0 ? 'to' : 'from'} ${target}. They're level ${user.level}.`,
        flags: EPHEMERAL,
    });
}

async function onCommand(interaction) {
    switch (interaction.commandName) {
        case 'rank':
            return handleRank(interaction);
        case 'leaderboard':
            return handleLeaderboard(interaction);
        case 'levelrole':
            return handleLevelRole(interaction);
        case 'xpadmin':
            return handleXpAdmin(interaction);
    }
}

function setup(client) {
    client.on('messageCreate', (message) => onMessage(message).catch((err) => log_error('XP message error', err)));
    client.once('clientReady', () => {
        const interval = setInterval(() => voiceTick(client).catch((err) => log_error('Voice tick error', err)), 60_000);
        interval.unref?.();
        log_info('Leveling: voice XP ticker running.');
    });
}

module.exports = {
    name: 'leveling',
    commands,
    onCommand,
    setup,
    addXp,
    xpToNext,
    totalXpForLevel,
    levelFromXp,
    boostMultiplier,
};
