// Gambling minigames with virtual currency only: coinflip, slots, blackjack.
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const config = require('../config');
const { getStore } = require('../lib/db');
const { EPHEMERAL, money, shuffle } = require('../lib/util');
const { log_error } = require('../logger');

const ec = config.economy;
const lastGamble = new Map(); // `${guild}:${user}` -> timestamp

// --- Slots -------------------------------------------------------------------
// Weighted reels. Payouts are tuned for roughly a 95% return to player,
// checked by test/gambling.test.js.
const SLOT_SYMBOLS = [
    { s: '🍒', w: 30, three: 5 },
    { s: '🍋', w: 25, three: 8 },
    { s: '🍇', w: 20, three: 12 },
    { s: '🔔', w: 13, three: 25 },
    { s: '💎', w: 8, three: 60 },
    { s: '7️⃣', w: 4, three: 250 },
];
const SLOT_TWO_PAIR = 1; // any two matching symbols = stake back (RTP ≈ 94.96%)
const SLOT_TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((a, b) => a + b.w, 0);

function spinReel(rng = Math.random) {
    let r = rng() * SLOT_TOTAL_WEIGHT;
    for (const sym of SLOT_SYMBOLS) {
        if ((r -= sym.w) < 0) return sym.s;
    }
    return SLOT_SYMBOLS[0].s;
}

function slotMultiplier(reels) {
    const [a, b, c] = reels;
    if (a === b && b === c) return SLOT_SYMBOLS.find((x) => x.s === a).three;
    if (a === b || b === c || a === c) return SLOT_TWO_PAIR;
    return 0;
}

// --- Blackjack ---------------------------------------------------------------
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function newDeck() {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
    return shuffle(deck);
}

function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (const { r } of cards) {
        if (r === 'A') {
            aces++;
            total += 11;
        } else if (['J', 'Q', 'K'].includes(r)) total += 10;
        else total += Number(r);
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return total;
}

const isBlackjack = (cards) => cards.length === 2 && handValue(cards) === 21;
const showHand = (cards) => cards.map((c) => `\`${c.r}${c.s}\``).join(' ');

const blackjackGames = new Map(); // `${guild}:${user}` -> game

// Settle a finished hand. Returns { payout, result } where payout includes
// the returned stake.
function settleBlackjack(player, dealer, bet) {
    const p = handValue(player);
    const d = handValue(dealer);
    if (p > 21) return { payout: 0, result: 'Bust! You lose.' };
    if (isBlackjack(player) && !isBlackjack(dealer)) return { payout: Math.floor(bet * 2.5), result: 'Blackjack! Pays 3:2.' };
    if (isBlackjack(dealer) && !isBlackjack(player)) return { payout: 0, result: 'Dealer has blackjack.' };
    if (d > 21) return { payout: bet * 2, result: 'Dealer busts. You win!' };
    if (p > d) return { payout: bet * 2, result: 'You win!' };
    if (p < d) return { payout: 0, result: 'Dealer wins.' };
    return { payout: bet, result: 'Push. Bet returned.' };
}

function dealerPlay(game) {
    while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop());
}

function blackjackEmbed(game, { reveal = false, outcome = null } = {}) {
    const dealerShown = reveal ? showHand(game.dealer) : `${showHand([game.dealer[0]])} \`??\``;
    const dealerValue = reveal ? handValue(game.dealer) : '?';
    const embed = new EmbedBuilder()
        .setColor(outcome ? (outcome.payout > game.bet ? 0x57f287 : outcome.payout === game.bet ? 0xfee75c : 0xed4245) : 0x5865f2)
        .setTitle(`🃏 Blackjack — bet ${game.bet.toLocaleString()} ${ec.currencyName}`)
        .addFields(
            { name: `Dealer (${dealerValue})`, value: dealerShown },
            { name: `You (${handValue(game.player)})`, value: showHand(game.player) }
        );
    if (outcome) {
        const net = outcome.payout - game.bet;
        embed.setDescription(`**${outcome.result}** ${net >= 0 ? '+' : ''}${net.toLocaleString()} ${ec.currencyEmoji}`);
    }
    return embed;
}

function blackjackButtons(key, game, disabled = false) {
    const user = getStore().user(game.guildId, game.userId);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj:hit:${key}`).setLabel('Hit').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`bj:stand:${key}`).setLabel('Stand').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`bj:double:${key}`)
            .setLabel('Double')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled || game.player.length !== 2 || user.coins < game.bet)
    );
}

function finishBlackjack(key, game) {
    clearTimeout(game.timeout);
    blackjackGames.delete(key);
    const outcome = settleBlackjack(game.player, game.dealer, game.bet);
    const store = getStore();
    store.user(game.guildId, game.userId).coins += outcome.payout;
    store.save();
    return outcome;
}

// --- Commands ----------------------------------------------------------------

const betOption = (o) =>
    o.setName('bet').setDescription(`Bet (max ${ec.gambleMaxBet})`).setMinValue(1).setMaxValue(ec.gambleMaxBet).setRequired(true);

const commands = [
    new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Double or nothing')
        .addIntegerOption(betOption)
        .addStringOption((o) =>
            o
                .setName('side')
                .setDescription('Heads or tails')
                .setRequired(true)
                .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })
        ),
    new SlashCommandBuilder().setName('slots').setDescription('Spin the slot machine').addIntegerOption(betOption),
    new SlashCommandBuilder().setName('blackjack').setDescription('Play a hand of blackjack against the dealer').addIntegerOption(betOption),
];

// Checks balance + cooldown and takes the bet. Returns the user record or null.
async function takeBet(interaction, bet) {
    const key = `${interaction.guildId}:${interaction.user.id}`;
    const wait = ec.gambleCooldownSec * 1000 - (Date.now() - (lastGamble.get(key) || 0));
    if (wait > 0) {
        await interaction.reply({ content: `🕐 Slow down — try again in ${Math.ceil(wait / 1000)}s.`, flags: EPHEMERAL });
        return null;
    }
    const store = getStore();
    const user = store.user(interaction.guildId, interaction.user.id);
    if (user.coins < bet) {
        await interaction.reply({ content: `You only have ${money(user.coins)}.`, flags: EPHEMERAL });
        return null;
    }
    lastGamble.set(key, Date.now());
    user.coins -= bet;
    store.save();
    return user;
}

async function handleCoinflip(interaction) {
    const bet = interaction.options.getInteger('bet');
    const side = interaction.options.getString('side');
    const user = await takeBet(interaction, bet);
    if (!user) return;
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = result === side;
    if (won) user.coins += bet * 2;
    getStore().save();
    return interaction.reply({
        content: `🪙 It's **${result}**! ${won ? `You win ${money(bet)}` : `You lose ${money(bet)}`}.\nBalance: ${money(user.coins)}`,
    });
}

async function handleSlots(interaction) {
    const bet = interaction.options.getInteger('bet');
    const user = await takeBet(interaction, bet);
    if (!user) return;
    const reels = [spinReel(), spinReel(), spinReel()];
    const mult = slotMultiplier(reels);
    const payout = Math.floor(bet * mult);
    user.coins += payout;
    getStore().save();
    const net = payout - bet;
    const line =
        mult >= 25 ? `🎰 **JACKPOT!** ×${mult}` : mult > 1 ? `Winner! ×${mult}` : mult === 1 ? 'A pair — bet back.' : 'No match.';
    return interaction.reply({
        content: `🎰 **[ ${reels.join(' | ')} ]**\n${line} ${net >= 0 ? '+' : ''}${net.toLocaleString()} ${ec.currencyEmoji}\nBalance: ${money(user.coins)}`,
    });
}

async function handleBlackjack(interaction) {
    const key = `${interaction.guildId}:${interaction.user.id}`;
    if (blackjackGames.has(key)) {
        return interaction.reply({ content: 'Finish your current hand first.', flags: EPHEMERAL });
    }
    const bet = interaction.options.getInteger('bet');
    const user = await takeBet(interaction, bet);
    if (!user) return;

    const deck = newDeck();
    const game = {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        bet,
        deck,
        player: [deck.pop(), deck.pop()],
        dealer: [deck.pop(), deck.pop()],
        timeout: null,
    };

    if (isBlackjack(game.player) || isBlackjack(game.dealer)) {
        const outcome = finishBlackjack(key, game);
        return interaction.reply({ embeds: [blackjackEmbed(game, { reveal: true, outcome })] });
    }

    blackjackGames.set(key, game);
    await interaction.reply({ embeds: [blackjackEmbed(game)], components: [blackjackButtons(key, game)] });

    // Auto-stand after 2 minutes so bets don't hang forever.
    game.timeout = setTimeout(async () => {
        if (!blackjackGames.has(key)) return;
        dealerPlay(game);
        const outcome = finishBlackjack(key, game);
        await interaction
            .editReply({ embeds: [blackjackEmbed(game, { reveal: true, outcome }).setFooter({ text: 'Timed out — auto-stood.' })], components: [] })
            .catch(() => {});
    }, 120_000);
}

async function onComponent(interaction) {
    const [, action, guildId, userId] = interaction.customId.split(':');
    const key = `${guildId}:${userId}`;
    if (interaction.user.id !== userId) {
        return interaction.reply({ content: 'This isn\'t your hand. Start one with `/blackjack`.', flags: EPHEMERAL });
    }
    const game = blackjackGames.get(key);
    if (!game) return interaction.update({ components: [] }).catch(() => {});

    try {
        if (action === 'double') {
            const user = getStore().user(guildId, userId);
            if (game.player.length !== 2 || user.coins < game.bet) {
                return interaction.reply({ content: 'You can\'t double now.', flags: EPHEMERAL });
            }
            user.coins -= game.bet;
            game.bet *= 2;
            game.player.push(game.deck.pop());
            dealerPlay(game);
            const outcome = finishBlackjack(key, game);
            return interaction.update({ embeds: [blackjackEmbed(game, { reveal: true, outcome })], components: [] });
        }
        if (action === 'hit') {
            game.player.push(game.deck.pop());
            if (handValue(game.player) < 21) {
                return interaction.update({ embeds: [blackjackEmbed(game)], components: [blackjackButtons(key, game)] });
            }
        }
        // stand, or hit that reached 21 / bust
        if (handValue(game.player) <= 21) dealerPlay(game);
        const outcome = finishBlackjack(key, game);
        return interaction.update({ embeds: [blackjackEmbed(game, { reveal: true, outcome })], components: [] });
    } catch (err) {
        log_error('Blackjack error', err);
    }
}

async function onCommand(interaction) {
    if (interaction.commandName === 'coinflip') return handleCoinflip(interaction);
    if (interaction.commandName === 'slots') return handleSlots(interaction);
    if (interaction.commandName === 'blackjack') return handleBlackjack(interaction);
}

module.exports = {
    name: 'gambling',
    commands,
    onCommand,
    onComponent,
    componentPrefix: 'bj:',
    // exported for tests
    SLOT_SYMBOLS,
    SLOT_TWO_PAIR,
    SLOT_TOTAL_WEIGHT,
    slotMultiplier,
    handValue,
    settleBlackjack,
};
