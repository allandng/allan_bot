// Shared test setup: isolate the data store in a temp dir before any module loads.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allan-bot-test-'));
process.env.DATA_DIR = dir;
process.env.TOKEN = 'test-token';

// Minimal fake of a slash-command interaction. Captures every reply.
function fakeInteraction({ commandName, sub = null, options = {}, userId = 'u1', guildId = 'g1', member = {}, perms = true } = {}) {
    const replies = [];
    const user = { id: userId, bot: false, username: `user-${userId}`, displayName: `User ${userId}`, displayAvatarURL: () => 'https://x/a.png', toString: () => `<@${userId}>` };
    const roles = new Map();
    const interaction = {
        commandName,
        guildId,
        channelId: 'c1',
        user,
        replied: false,
        deferred: false,
        inGuild: () => true,
        memberPermissions: { has: () => perms },
        member: {
            id: userId,
            user,
            roles: { cache: roles, add: async (r) => roles.set(r.id || r, true), remove: async (r) => roles.delete(r.id || r) },
            ...member,
        },
        guild: {
            id: guildId,
            name: 'Test Guild',
            roles: { cache: new Map() },
            channels: { cache: new Map() },
            members: { fetch: async (id) => ({ id, guild: interaction.guild, roles: { cache: new Map(), add: async () => {}, remove: async () => {} }, toString: () => `<@${id}>` }) },
        },
        channel: { id: 'c1', send: async (m) => replies.push({ channel: m }), isTextBased: () => true },
        options: {
            getSubcommand: () => sub,
            getString: (k) => options[k] ?? null,
            getInteger: (k) => options[k] ?? null,
            getBoolean: (k) => options[k] ?? null,
            getUser: (k) => options[k] ?? null,
            getRole: (k) => options[k] ?? null,
            getChannel: (k) => options[k] ?? null,
            getFocused: () => options.focused ?? '',
        },
        reply: async (m) => {
            interaction.replied = true;
            replies.push(m);
        },
        update: async (m) => replies.push({ update: m }),
        deferReply: async () => {
            interaction.deferred = true;
        },
        editReply: async (m) => replies.push({ edit: m }),
        followUp: async (m) => replies.push(m),
        respond: async (m) => replies.push({ autocomplete: m }),
        replies,
    };
    return interaction;
}

const text = (reply) => {
    if (!reply) return '';
    if (typeof reply === 'string') return reply;
    const m = reply.update || reply.edit || reply.channel || reply;
    if (typeof m === 'string') return m;
    return [m.content, ...(m.embeds || []).map((e) => JSON.stringify(e.toJSON ? e.toJSON() : e))].filter(Boolean).join(' ');
};

module.exports = { dir, fakeInteraction, text };
