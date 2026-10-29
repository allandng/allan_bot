// Central configuration. Every value can be overridden from .env so the same
// code runs locally and on bot-hosting.net without edits.
require('dotenv').config({ quiet: true });

const list = (value) =>
    (value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

module.exports = {
    token: process.env.TOKEN,
    // Set GUILD_ID to register slash commands to one server instantly.
    // Leave blank to register globally (can take up to an hour to appear).
    guildId: process.env.GUILD_ID || '',
    dataDir: process.env.DATA_DIR || require('path').join(__dirname, '..', 'data'),

    channels: {
        welcome: process.env.WELCOME_CHANNEL_ID || '1448509552541831230',
        roleSelect: process.env.ROLE_SELECT_CHANNEL_ID || '1448580230741495818',
        gameText: process.env.GAME_TEXT_CHANNEL_ID || '1476762244380622878',
        // Blank = announce level-ups in the channel where the user leveled.
        levelUp: process.env.LEVEL_UP_CHANNEL_ID || '',
        // Fallback for deal alerts if /deals setup hasn't been run.
        deals: process.env.DEALS_CHANNEL_ID || '',
    },

    leveling: {
        textXpMin: num(process.env.TEXT_XP_MIN, 15),
        textXpMax: num(process.env.TEXT_XP_MAX, 25),
        textCooldownSec: num(process.env.TEXT_XP_COOLDOWN_SEC, 60),
        voiceXpPerMinute: num(process.env.VOICE_XP_PER_MIN, 10),
        // Humans needed in a voice channel before anyone earns voice XP
        // (stops people farming XP alone in a channel).
        voiceMinMembers: num(process.env.VOICE_MIN_MEMBERS, 2),
        noXpChannels: list(process.env.NO_XP_CHANNEL_IDS),
        levelUpCoinsPerLevel: num(process.env.LEVEL_UP_COINS_PER_LEVEL, 25),
    },

    economy: {
        currencyName: process.env.CURRENCY_NAME || 'Candy',
        currencyEmoji: process.env.CURRENCY_EMOJI || '🍬',
        startingBalance: num(process.env.STARTING_BALANCE, 100),
        messageCoinsMin: num(process.env.MESSAGE_COINS_MIN, 1),
        messageCoinsMax: num(process.env.MESSAGE_COINS_MAX, 3),
        voiceCoinsPerMinute: num(process.env.VOICE_COINS_PER_MIN, 1),
        dailyBase: num(process.env.DAILY_BASE, 200),
        dailyStreakBonus: num(process.env.DAILY_STREAK_BONUS, 25),
        dailyStreakCap: num(process.env.DAILY_STREAK_CAP, 7),
        gambleMaxBet: num(process.env.GAMBLE_MAX_BET, 5000),
        gambleCooldownSec: num(process.env.GAMBLE_COOLDOWN_SEC, 5),
    },

    trivia: {
        secondsPerQuestion: num(process.env.TRIVIA_SECONDS, 20),
    },

    deals: {
        checkHours: num(process.env.DEALS_CHECK_HOURS, 6),
        countryCode: process.env.DEALS_COUNTRY || 'us',
        // Only alert at or above this discount.
        minDiscount: num(process.env.DEALS_MIN_DISCOUNT, 1),
    },
};
