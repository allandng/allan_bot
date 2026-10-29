const { MessageFlags } = require('discord.js');
const config = require('../config');

const EPHEMERAL = MessageFlags.Ephemeral;

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function money(amount) {
    return `${config.economy.currencyEmoji} **${Math.floor(amount).toLocaleString('en-US')}**`;
}

function progressBar(current, total, size = 14) {
    const ratio = total > 0 ? Math.min(1, current / total) : 0;
    const filled = Math.round(ratio * size);
    return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

function duration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

// Reply or follow up, whichever is still allowed for this interaction.
async function respond(interaction, options) {
    if (interaction.replied || interaction.deferred) return interaction.followUp(options);
    return interaction.reply(options);
}

module.exports = { EPHEMERAL, randInt, pick, shuffle, money, progressBar, duration, respond };
