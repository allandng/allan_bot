// Minigames: timed trivia quizzes, word scramble, and native Discord polls.
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PollLayoutType,
} = require('discord.js');
const config = require('../config');
const { getStore } = require('../lib/db');
const { EPHEMERAL, shuffle, pick, money } = require('../lib/util');
const { log_error, log_warning } = require('../logger');
const { addXp } = require('./leveling');
const FALLBACK = require('../data/trivia-fallback');
const WORDS = require('../data/words');

const LETTERS = ['🇦', '🇧', '🇨', '🇩'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Open Trivia DB category IDs (https://opentdb.com/api_config.php)
const CATEGORIES = {
    any: { name: 'Any', id: null },
    general: { name: 'General Knowledge', id: 9 },
    games: { name: 'Video Games', id: 15 },
    science: { name: 'Science & Nature', id: 17 },
    computers: { name: 'Computers', id: 18 },
    math: { name: 'Math', id: 19 },
    geography: { name: 'Geography', id: 22 },
    history: { name: 'History', id: 23 },
    film: { name: 'Film', id: 11 },
    music: { name: 'Music', id: 12 },
    tv: { name: 'Television', id: 14 },
    sports: { name: 'Sports', id: 21 },
    animals: { name: 'Animals', id: 27 },
    anime: { name: 'Anime & Manga', id: 31 },
};

// --- Question sourcing -------------------------------------------------------

function normalizeOpenTdb(result) {
    const d = decodeURIComponent;
    return {
        category: d(result.category),
        difficulty: d(result.difficulty),
        q: d(result.question),
        a: d(result.correct_answer),
        wrong: result.incorrect_answers.map(d),
    };
}

async function fetchQuestions(amount, categoryKey, difficulty, fetchImpl = globalThis.fetch) {
    const params = new URLSearchParams({ amount: String(amount), type: 'multiple', encode: 'url3986' });
    const cat = CATEGORIES[categoryKey]?.id;
    if (cat) params.set('category', String(cat));
    if (difficulty && difficulty !== 'any') params.set('difficulty', difficulty);

    let questions = [];
    try {
        const res = await fetchImpl(`https://opentdb.com/api.php?${params}`, { signal: AbortSignal.timeout(6000) });
        const body = await res.json();
        if (body.response_code === 0) questions = body.results.map(normalizeOpenTdb);
        else log_warning(`Open Trivia DB response_code ${body.response_code}; using fallback questions.`);
    } catch (err) {
        log_warning(`Open Trivia DB unreachable (${err.message}); using fallback questions.`);
    }

    if (questions.length < amount) {
        const name = CATEGORIES[categoryKey]?.name;
        let pool = FALLBACK.filter((f) => !cat || f.category === name);
        if (pool.length < amount - questions.length) pool = FALLBACK;
        questions.push(...shuffle(pool).slice(0, amount - questions.length));
    }
    return questions.slice(0, amount);
}

// Points for a correct answer: 100 base + up to 50 for answering fast.
function scoreAnswer(elapsedMs, windowMs) {
    const remaining = Math.max(0, 1 - elapsedMs / windowMs);
    return 100 + Math.round(50 * remaining);
}

// --- Trivia sessions ---------------------------------------------------------

const sessions = new Map(); // channelId -> session

function questionEmbed(session, round) {
    const q = session.questions[round];
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: `Question ${round + 1} of ${session.questions.length} · ${q.category}` })
        .setTitle(q.q.slice(0, 256))
        .setDescription(session.current.answers.map((a, i) => `${LETTERS[i]} ${a}`).join('\n'))
        .setFooter({ text: `⏱️ ${config.trivia.secondsPerQuestion}s · first answer locks in · faster = more points` });
}

function answerButtons(session, round, disabled = false, correctIdx = -1) {
    return new ActionRowBuilder().addComponents(
        session.current.answers.map((_, i) =>
            new ButtonBuilder()
                .setCustomId(`tv:${session.id}:${round}:${i}`)
                .setEmoji(LETTERS[i])
                .setStyle(i === correctIdx ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(disabled)
        )
    );
}

async function runTrivia(channel, session) {
    const windowMs = config.trivia.secondsPerQuestion * 1000;
    for (let round = 0; round < session.questions.length; round++) {
        if (session.stopped) break;
        const q = session.questions[round];
        const answers = shuffle([q.a, ...q.wrong]);
        session.current = { round, answers, correctIdx: answers.indexOf(q.a), responses: new Map(), startedAt: Date.now() };

        const msg = await channel.send({ embeds: [questionEmbed(session, round)], components: [answerButtons(session, round)] });
        await sleep(windowMs);

        const { responses, correctIdx } = session.current;
        const winners = [];
        for (const [userId, r] of responses) {
            if (r.idx !== correctIdx) continue;
            const pts = scoreAnswer(r.at - session.current.startedAt, windowMs);
            winners.push([userId, pts]);
            const s = session.scores.get(userId) || { points: 0, correct: 0 };
            s.points += pts;
            s.correct++;
            session.scores.set(userId, s);
        }
        for (const userId of responses.keys()) if (!session.scores.has(userId)) session.scores.set(userId, { points: 0, correct: 0 });

        winners.sort((a, b) => b[1] - a[1]);
        const result = new EmbedBuilder()
            .setColor(winners.length ? 0x57f287 : 0xed4245)
            .setAuthor({ name: `Question ${round + 1} of ${session.questions.length} · ${q.category}` })
            .setTitle(q.q.slice(0, 256))
            .setDescription(
                `✅ **${LETTERS[correctIdx]} ${q.a}**\n\n` +
                    (winners.length
                        ? winners.map(([id, pts]) => `<@${id}> +${pts}`).join('\n')
                        : responses.size
                          ? 'Nobody got it!'
                          : 'No one answered.')
            );
        await msg.edit({ embeds: [result], components: [answerButtons(session, round, true, correctIdx)] }).catch(() => {});
        if (round < session.questions.length - 1) await sleep(3500);
    }
    await finishTrivia(channel, session);
}

async function finishTrivia(channel, session) {
    sessions.delete(channel.id);
    const store = getStore();
    const ranked = [...session.scores.entries()].sort((a, b) => b[1].points - a[1].points);
    for (const [userId, s] of ranked) {
        const u = store.user(channel.guildId, userId);
        u.triviaPoints += s.points;
        u.triviaCorrect += s.correct;
        u.coins += Math.floor(s.points / 10);
    }
    store.save();
    // Small XP reward for playing, outside the chat-XP cooldown.
    for (const [userId, s] of ranked) {
        if (!s.correct) continue;
        const member = await channel.guild.members.fetch(userId).catch(() => null);
        if (member) await addXp(member, s.correct * 10, { announceChannel: channel }).catch(() => {});
    }

    const medals = ['🥇', '🥈', '🥉'];
    const embed = new EmbedBuilder()
        .setColor(0xffb6c1)
        .setTitle('🏁 Trivia over!')
        .setDescription(
            ranked.length
                ? ranked
                      .map(([id, s], i) => `${medals[i] || `\`#${i + 1}\``} <@${id}> — **${s.points}** pts (${s.correct}/${session.questions.length}) · +${Math.floor(s.points / 10)} ${config.economy.currencyEmoji}`)
                      .join('\n')
                : 'Nobody played. 😢'
        )
        .setFooter({ text: 'Lifetime scores: /leaderboard board:Trivia' });
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleTrivia(interaction) {
    if (sessions.has(interaction.channelId)) {
        return interaction.reply({ content: 'A quiz is already running in this channel.', flags: EPHEMERAL });
    }
    const rounds = interaction.options.getInteger('questions') || 5;
    const category = interaction.options.getString('category') || 'any';
    const difficulty = interaction.options.getString('difficulty') || 'any';

    const session = { id: Date.now().toString(36), host: interaction.user.id, questions: [], scores: new Map(), current: null, stopped: false };
    sessions.set(interaction.channelId, session); // reserve the channel before the fetch
    await interaction.reply({ content: `🧠 **Trivia** starting — ${rounds} question${rounds > 1 ? 's' : ''}, ${CATEGORIES[category].name}, ${difficulty} difficulty. Get ready…` });

    try {
        session.questions = await fetchQuestions(rounds, category, difficulty);
        await sleep(2000);
        await runTrivia(interaction.channel, session);
    } catch (err) {
        sessions.delete(interaction.channelId);
        log_error('Trivia session failed', err);
        await interaction.channel.send('Trivia crashed, sorry. Try again in a moment.').catch(() => {});
    }
}

async function handleTriviaStop(interaction) {
    const session = sessions.get(interaction.channelId);
    if (!session) return interaction.reply({ content: 'No quiz running here.', flags: EPHEMERAL });
    const canManage = interaction.memberPermissions?.has('ManageMessages');
    if (session.host !== interaction.user.id && !canManage) {
        return interaction.reply({ content: 'Only the person who started it (or a mod) can stop it.', flags: EPHEMERAL });
    }
    session.stopped = true;
    return interaction.reply({ content: '🛑 Stopping after this question.' });
}

async function onTriviaButton(interaction) {
    const [, sessionId, roundStr, idxStr] = interaction.customId.split(':');
    const session = sessions.get(interaction.channelId);
    if (!session || session.id !== sessionId || session.current?.round !== Number(roundStr)) {
        return interaction.reply({ content: 'That question is closed.', flags: EPHEMERAL });
    }
    const { responses } = session.current;
    if (responses.has(interaction.user.id)) {
        return interaction.reply({ content: 'You already locked in an answer.', flags: EPHEMERAL });
    }
    const idx = Number(idxStr);
    responses.set(interaction.user.id, { idx, at: Date.now() });
    return interaction.reply({ content: `Locked in ${LETTERS[idx]}`, flags: EPHEMERAL });
}

// --- Word scramble -----------------------------------------------------------

const scrambles = new Set(); // channelIds with an active scramble
const SCRAMBLE_REWARD = { easy: 40, medium: 75, hard: 125 };

function scrambleWord(word) {
    if (new Set(word).size < 2) return word;
    let s = word;
    while (s === word) s = shuffle([...word]).join('');
    return s;
}

async function handleScramble(interaction) {
    if (scrambles.has(interaction.channelId)) {
        return interaction.reply({ content: 'There\'s already a scramble going here!', flags: EPHEMERAL });
    }
    const difficulty = interaction.options.getString('difficulty') || pick(['easy', 'medium', 'hard']);
    const word = pick(WORDS[difficulty]);
    const reward = SCRAMBLE_REWARD[difficulty];
    scrambles.add(interaction.channelId);

    await interaction.reply({
        content: `🔤 **Unscramble this (${difficulty}):** \`${scrambleWord(word).toUpperCase()}\`\nFirst to type it in chat wins ${money(reward)}! 30 seconds.`,
    });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => !m.author.bot && m.content.trim().toLowerCase() === word,
        time: 30_000,
        max: 1,
    });
    const hint = setTimeout(() => {
        interaction.channel.send(`💡 Hint: starts with **${word[0].toUpperCase()}**, ${word.length} letters.`).catch(() => {});
    }, 15_000);

    collector.on('end', async (collected) => {
        clearTimeout(hint);
        scrambles.delete(interaction.channelId);
        const winner = collected.first();
        if (!winner) {
            return interaction.channel.send(`⌛ Time's up! The word was **${word}**.`).catch(() => {});
        }
        const store = getStore();
        const u = store.user(interaction.guildId, winner.author.id);
        u.coins += reward;
        u.scrambleWins++;
        store.save();
        await winner.react('🏆').catch(() => {});
        await interaction.channel
            .send({ content: `🏆 ${winner.author} got it — **${word}**! +${money(reward)} (${u.scrambleWins} total wins)`, allowedMentions: { users: [winner.author.id] } })
            .catch(() => {});
    });
}

// --- Polls -------------------------------------------------------------------

async function handlePoll(interaction) {
    const question = interaction.options.getString('question');
    const options = interaction.options
        .getString('options')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
    if (options.length < 2 || options.length > 10) {
        return interaction.reply({ content: 'Give 2–10 options separated by `|`, like `Pizza | Tacos | Sushi`.', flags: EPHEMERAL });
    }
    if (options.some((o) => o.length > 55)) {
        return interaction.reply({ content: 'Each option must be 55 characters or less.', flags: EPHEMERAL });
    }
    try {
        await interaction.reply({
            poll: {
                question: { text: question },
                answers: options.map((text) => ({ text })),
                duration: interaction.options.getInteger('hours') || 24,
                allowMultiselect: interaction.options.getBoolean('multiple') || false,
                layoutType: PollLayoutType.Default,
            },
        });
    } catch (err) {
        log_error('Poll failed', err);
        await interaction
            .reply({ content: 'I couldn\'t post the poll. Make sure I have the **Send Polls** permission here.', flags: EPHEMERAL })
            .catch(() => {});
    }
}

// --- Wiring ------------------------------------------------------------------

const commands = [
    new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('Start a timed trivia quiz in this channel')
        .addIntegerOption((o) => o.setName('questions').setDescription('How many (1–10)').setMinValue(1).setMaxValue(10))
        .addStringOption((o) =>
            o
                .setName('category')
                .setDescription('Category')
                .addChoices(...Object.entries(CATEGORIES).map(([value, c]) => ({ name: c.name, value })))
        )
        .addStringOption((o) =>
            o
                .setName('difficulty')
                .setDescription('Difficulty')
                .addChoices(
                    { name: 'Any', value: 'any' },
                    { name: 'Easy', value: 'easy' },
                    { name: 'Medium', value: 'medium' },
                    { name: 'Hard', value: 'hard' }
                )
        ),
    new SlashCommandBuilder().setName('triviastop').setDescription('Stop the quiz in this channel'),
    new SlashCommandBuilder()
        .setName('scramble')
        .setDescription('Unscramble a word — first to type it wins')
        .addStringOption((o) =>
            o
                .setName('difficulty')
                .setDescription('Difficulty')
                .addChoices({ name: 'Easy', value: 'easy' }, { name: 'Medium', value: 'medium' }, { name: 'Hard', value: 'hard' })
        ),
    new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create a poll')
        .addStringOption((o) => o.setName('question').setDescription('The question').setRequired(true).setMaxLength(300))
        .addStringOption((o) => o.setName('options').setDescription('Options separated by | (2–10)').setRequired(true))
        .addIntegerOption((o) => o.setName('hours').setDescription('How long it runs (default 24)').setMinValue(1).setMaxValue(768))
        .addBooleanOption((o) => o.setName('multiple').setDescription('Allow picking more than one')),
];

async function onCommand(interaction) {
    switch (interaction.commandName) {
        case 'trivia':
            return handleTrivia(interaction);
        case 'triviastop':
            return handleTriviaStop(interaction);
        case 'scramble':
            return handleScramble(interaction);
        case 'poll':
            return handlePoll(interaction);
    }
}

module.exports = {
    name: 'trivia',
    commands,
    onCommand,
    onComponent: onTriviaButton,
    componentPrefix: 'tv:',
    // exported for tests
    fetchQuestions,
    scoreAnswer,
    scrambleWord,
    normalizeOpenTdb,
};
