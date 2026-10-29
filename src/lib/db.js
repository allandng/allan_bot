// Tiny persistent JSON store.
//
// Why not SQLite: native modules (better-sqlite3, sqlite3) need a compile or a
// prebuilt binary download on install, which is a common failure point on
// shared Pterodactyl hosts like bot-hosting.net. A friends' server fits easily
// in one JSON file, and writes are atomic (write temp file, then rename), so a
// crash mid-save can't corrupt the data.
const fs = require('fs');
const path = require('path');
const { log_error, log_info, log_warning } = require('../logger');

const SAVE_DEBOUNCE_MS = 2000;

function defaultUser(startingBalance) {
    return {
        xp: 0,
        level: 0,
        messages: 0,
        voiceMinutes: 0,
        lastXpAt: 0,
        coins: startingBalance,
        lastDaily: 0,
        dailyStreak: 0,
        inventory: {},
        boostUntil: 0,
        triviaPoints: 0,
        triviaCorrect: 0,
        scrambleWins: 0,
    };
}

function defaultGuild() {
    return {
        levelRoles: {}, // { [level]: roleId }
        stackLevelRoles: false,
        shop: null, // null = not seeded yet
        dealsChannelId: null,
        dealsRoleId: null,
    };
}

class Store {
    constructor(dir, { startingBalance = 100 } = {}) {
        this.dir = dir;
        this.file = path.join(dir, 'store.json');
        this.backup = path.join(dir, 'store.json.bak');
        this.startingBalance = startingBalance;
        this.timer = null;
        this.data = this.load();
    }

    load() {
        fs.mkdirSync(this.dir, { recursive: true });
        for (const candidate of [this.file, this.backup]) {
            if (!fs.existsSync(candidate)) continue;
            try {
                const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
                if (candidate === this.backup) log_warning('Main store unreadable, loaded backup.');
                return { users: {}, guilds: {}, global: {}, ...parsed };
            } catch (err) {
                log_error(`Could not parse ${candidate}`, err);
            }
        }
        log_info(`Creating new data store at ${this.file}`);
        return { users: {}, guilds: {}, global: {} };
    }

    user(guildId, userId) {
        const guildUsers = (this.data.users[guildId] ??= {});
        if (!guildUsers[userId]) guildUsers[userId] = defaultUser(this.startingBalance);
        // Backfill fields added in later versions, in place, so references
        // held by callers stay valid.
        const u = guildUsers[userId];
        for (const [k, v] of Object.entries(defaultUser(this.startingBalance))) {
            if (!(k in u)) u[k] = v;
        }
        return u;
    }

    guildUsers(guildId) {
        return Object.entries(this.data.users[guildId] || {});
    }

    guild(guildId) {
        if (!this.data.guilds[guildId]) this.data.guilds[guildId] = defaultGuild();
        const g = this.data.guilds[guildId];
        for (const [k, v] of Object.entries(defaultGuild())) {
            if (!(k in g)) g[k] = v;
        }
        return g;
    }

    global(key, fallback) {
        if (!(key in this.data.global)) this.data.global[key] = fallback;
        return this.data.global[key];
    }

    save() {
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
        }, SAVE_DEBOUNCE_MS);
        if (this.timer.unref) this.timer.unref();
    }

    flush() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        try {
            const tmp = `${this.file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(this.data));
            if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup);
            fs.renameSync(tmp, this.file);
        } catch (err) {
            log_error('Failed to save data store', err);
        }
    }
}

let instance = null;

function getStore() {
    if (!instance) {
        const config = require('../config');
        instance = new Store(config.dataDir, { startingBalance: config.economy.startingBalance });
    }
    return instance;
}

module.exports = { Store, getStore, defaultUser };
