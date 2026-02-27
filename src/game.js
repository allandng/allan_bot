const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { log_error, log_warning, log_info } = require('./logger');

// Map voiceChannelId -> state object
const activeGames = new Map();

// --- IMPOSTER DICTIONARY ---
const imposterDictionary = {
    "Places": [
        "Japan", "Brazil", "Canada", "Egypt", "Texas", "New York City", 
        "Boston", "Vietnam", "Philippines", "Paris", "London", "Tokyo", 
        "Rome", "Sydney", "Azores", "Worcester"
    ],
    "Food": [
        "Avocado Toast", "Acai Bowl", "Birria Tacos", "Nashville Hot Chicken", "Instant Ramen", "Mac and Cheese", "Smashburger",
        "General Tso's Chicken", "Crab Rangoon", "Orange Chicken", "California Roll", "Beef and Broccoli",
        "Chicken Adobo", "Lumpia", "Sinigang", "Pancit", "Halo-Halo", "Sisig",
        "Soup Dumplings", "Dim Sum", "Mapo Tofu", "Hot Pot", "Peking Duck", "Chow Mein",
        "Pho", "Banh Mi", "Summer Rolls", "Bun Bo Hue", "Vietnamese Iced Coffee", "Banh Xeo",
        "Dunkin' Donuts", "Starbucks", "Tatte Bakery", "Tasty Burger", "Sweetgreen", "CAVA", "Heytea", "Gong Cha", "Kung Fu Tea", "Tiger Sugar",
        "Brown Sugar Boba", "Taro Milk Tea", "Matcha Latte", "Thai Iced Tea", "Wintermelon Tea", "Fruit Tea with Aloe", "Cheese Foam Tea",
        "Pineapple", "Strawberry", "Watermelon", "Mango"
    ],
    "Musical Instruments": ["Saxophone", "Violin", "Drum Set", "Harp"],
    "Pokémon": [
        "Bulbasaur", "Ivysaur", "Venusaur", "Charmander", "Charmeleon", "Charizard", "Squirtle", "Wartortle", "Blastoise", "Caterpie", 
        "Metapod", "Butterfree", "Weedle", "Kakuna", "Beedrill", "Pidgey", "Pidgeotto", "Pidgeot", "Rattata", "Raticate", 
        "Spearow", "Fearow", "Ekans", "Arbok", "Pikachu", "Raichu", "Sandshrew", "Sandslash", "Nidoran♀", "Nidorina", 
        "Nidoqueen", "Nidoran♂", "Nidorino", "Nidoking", "Clefairy", "Clefable", "Vulpix", "Ninetales", "Jigglypuff", "Wigglytuff", 
        "Zubat", "Golbat", "Oddish", "Gloom", "Vileplume", "Paras", "Parasect", "Venonat", "Venomoth", "Diglett", 
        "Dugtrio", "Meowth", "Persian", "Psyduck", "Golduck", "Mankey", "Primeape", "Growlithe", "Arcanine", "Poliwag", 
        "Poliwhirl", "Poliwrath", "Abra", "Kadabra", "Alakazam", "Machop", "Machoke", "Machamp", "Bellsprout", "Weepinbell", 
        "Victreebel", "Tentacool", "Tentacruel", "Geodude", "Graveler", "Golem", "Ponyta", "Rapidash", "Slowpoke", "Slowbro", 
        "Magnemite", "Magneton", "Farfetch'd", "Doduo", "Dodrio", "Seel", "Dewgong", "Grimer", "Muk", "Shellder", 
        "Cloyster", "Gastly", "Haunter", "Gengar", "Onix", "Drowzee", "Hypno", "Krabby", "Kingler", "Voltorb", 
        "Electrode", "Exeggcute", "Exeggutor", "Cubone", "Marowak", "Hitmonlee", "Hitmonchan", "Lickitung", "Koffing", "Weezing", 
        "Rhyhorn", "Rhydon", "Chansey", "Tangela", "Kangaskhan", "Horsea", "Seadra", "Goldeen", "Seaking", "Staryu", 
        "Starmie", "Mr. Mime", "Scyther", "Jynx", "Electabuzz", "Magmar", "Pinsir", "Tauros", "Magikarp", "Gyarados", 
        "Lapras", "Ditto", "Eevee", "Vaporeon", "Jolteon", "Flareon", "Porygon", "Omanyte", "Omastar", "Kabuto", 
        "Kabutops", "Aerodactyl", "Snorlax", "Articuno", "Zapdos", "Moltres", "Dratini", "Dragonair", "Dragonite", "Mewtwo", "Mew"
    ]
};

async function registerCommands(client) {
    const commands = [
        new SlashCommandBuilder().setName('game').setDescription('Start a game'),
        new SlashCommandBuilder().setName('gameover').setDescription('End current game'),
        new SlashCommandBuilder().setName('categories').setDescription('View Imposter categories')
    ].map(cmd => cmd.toJSON());

    try {
        await client.application.commands.set(commands);
        log_info('Game commands registered.');
    } catch (err) {
        log_error('Failed to register game commands', err);
    }
}

async function cleanupGame(voiceChannelId) {
    const state = activeGames.get(voiceChannelId);
    if (!state) return;

    if (state.collector) state.collector.stop();
    if (state.joinMessage) state.joinMessage.delete().catch(() => {});
    if (state.startMessage) state.startMessage.delete().catch(() => {});
    if (state.endMessage) state.endMessage.delete().catch(() => {});
    if (state.timeout) clearTimeout(state.timeout);

    activeGames.delete(voiceChannelId);
}

async function processGameEnd(state, channel) {
    if (state.gameType === 'imposter') {
        const durationMs = Date.now() - state.startTime;
        const minutes = Math.floor(durationMs / 60000);
        const seconds = Math.floor((durationMs % 60000) / 1000);
        const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        
        const knowersMentions = state.knowers.map(id => `<@${id}>`).join(', ');
        
        await channel.send(
            `The imposter game is over! It took **${timeStr}** to complete the game!\n` +
            `Category was **${state.category}**, with **${state.word}** as the word!\n\n` +
            `It was <@${state.guesser}> (Imposter) v.s. ${knowersMentions} (Knowers)`
        );
    }
    
    cleanupGame(state.voiceChannelId);
}

async function startGame(voiceChannelId, channel) {
    const state = activeGames.get(voiceChannelId);
    if (!state || state.stage !== 'setup') return;

    if (state.gameType === 'imposter' && state.players.size < 3) {
        await channel.send("❌ **Insufficient players!** Imposter requires at least 3 players. Game setup aborted.");
        cleanupGame(voiceChannelId);
        return;
    }

    state.stage = 'active';
    state.startTime = Date.now(); 

    if (state.collector) state.collector.stop();
    if (state.timeout) clearTimeout(state.timeout);

    if (state.startMessage) {
        try { await state.startMessage.delete(); } catch {};
    }

    // --- IMPOSTER ROLE ASSIGNMENT LOGIC ---
    if (state.gameType === 'imposter') {
        const categories = Object.keys(imposterDictionary);
        
        // Use user's selected category, or pick random if they chose 'random'
        if (state.categoryPreference && state.categoryPreference !== 'random') {
            state.category = state.categoryPreference;
        } else {
            state.category = categories[Math.floor(Math.random() * categories.length)];
        }
        
        const wordList = imposterDictionary[state.category];
        state.word = wordList[Math.floor(Math.random() * wordList.length)];

        const playersArray = Array.from(state.players);
        const guesserIndex = Math.floor(Math.random() * playersArray.length);
        
        state.guesser = playersArray[guesserIndex];
        state.knowers = playersArray.filter(id => id !== state.guesser);

        for (const playerId of playersArray) {
            try {
                const user = await channel.client.users.fetch(playerId);
                if (playerId === state.guesser) {
                    await user.send(`🤫 **You are the Imposter!**\nThe category is: **${state.category}**\n*(You must try to guess what the exact word is!)*`);
                } else {
                    await user.send(`🧠 **You are a Knower!**\nThe category is: **${state.category}**\nThe word is: **${state.word}**`);
                }
            } catch (err) {
                log_error(`Failed to DM player ${playerId} during Imposter game start:`, err);
            }
        }
    }
    // ---------------------------------------

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('end_game')
            .setLabel('End Game')
            .setStyle(ButtonStyle.Danger)
    );
    const description = state.players.size
        ? [...state.players].map(id => `<@${id}>`).join(', ')
        : 'nobody';

    const msg = await channel.send({
        content: `Game **${state.gameType}** started with players: ${description}`,
        components: [row]
    });
    state.endMessage = msg;
}

/**
 * Initialize a new setup when a game is selected (updated with category support)
 */
async function startSetup(interaction, voiceChannel, gameType, categoryPreference = null) {
    const channel = interaction.channel;

    const state = {
        stage: 'setup',
        voiceChannelId: voiceChannel.id,
        gameType,
        categoryPreference, // Store the chosen category
        players: new Set(),
        joinMessage: null,
        startMessage: null,
        endMessage: null,
        collector: null,
        timeout: null,
        startTime: null
    };
    activeGames.set(voiceChannel.id, state);

    const joinMsg = await channel.send(
        'All players must have bot direct messages on for the game to function! And players must be in the call.\n\nPlayers: none'
    );
    state.joinMessage = joinMsg;
    await joinMsg.react('👍');

    const filter = (reaction, user) => reaction.emoji.name === '👍' && !user.bot;
    const collector = joinMsg.createReactionCollector({ filter, time: 45000 });
    state.collector = collector;

    collector.on('collect', async (reaction, user) => {
        try {
            const member = await voiceChannel.guild.members.fetch(user.id);
            
            if (!member.voice.channel || member.voice.channel.id !== voiceChannel.id) {
                await reaction.users.remove(user.id).catch(() => {});
                return; 
            }

            if (state.players.has(user.id)) return; 

            await user.send('You have joined the game!');
            state.players.add(user.id);
            
            const names = [...state.players].map(id => `<@${id}>`).join(', ');
            await joinMsg.edit(
                `All players must have bot direct messages on for the game to function! And players must be in the call.\n\nPlayers: ${names}`
            );
        } catch (err) {
            await channel.send(`<@${user.id}> please enable DMs for the bot; game setup aborted.`);
            cleanupGame(voiceChannel.id);
        }
    });

    collector.on('end', () => {
        startGame(voiceChannel.id, channel).catch(log_error);
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('start_game')
            .setLabel('Click to start')
            .setStyle(ButtonStyle.Primary)
    );
    const startMsg = await channel.send({
        content: 'Click the button to start early, or wait 45 seconds.',
        components: [row]
    });
    state.startMessage = startMsg;

    state.timeout = setTimeout(() => {
        startGame(voiceChannel.id, channel).catch(log_error);
    }, 45000);

    let setupContent = `Game **${gameType}** selected. Waiting for players to join...`;
    if (categoryPreference && categoryPreference !== 'random') {
        setupContent = `Game **${gameType}** selected with category **${categoryPreference}**. Waiting for players...`;
    }

    await interaction.update({
        content: setupContent,
        components: []
    });
}

async function sendReply(target, options) {
    if (target.reply) {
        return target.reply(options);
    } else {
        return target.channel.send(options);
    }
}

async function handleGameCommand(ctx) {
    const member = ctx.member || ctx.author;
    const voiceChannel = member.voice ? member.voice.channel : null;
    if (!voiceChannel) {
        return sendReply(ctx, {
            content: 'You must be in a voice channel to start a game.',
            ephemeral: ctx.reply ? true : false
        });
    }
    if (activeGames.has(voiceChannel.id)) {
        return sendReply(ctx, {
            content: 'A game is already active in your voice channel.',
            ephemeral: ctx.reply ? true : false
        });
    }

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('game_select')
            .setPlaceholder('Choose a game')
            .addOptions([
                { label: 'Mafia', value: 'mafia' },
                { label: 'Imposter', value: 'imposter' },
                { label: 'Wavelength', value: 'wavelength' }
            ])
    );

    await sendReply(ctx, {
        content: 'Select a game to play:',
        components: [row],
        ephemeral: ctx.reply ? true : false
    });
}

// New handler to view categories
async function handleCategoriesCommand(ctx) {
    const categories = Object.keys(imposterDictionary).map(cat => `• **${cat}**`).join('\n');
    await sendReply(ctx, {
        content: `**Available Imposter Categories:**\n${categories}`,
        ephemeral: ctx.reply ? true : false
    });
}

async function handleGameOverCommand(ctx) {
    const member = ctx.member || ctx.author;
    const voiceChannel = member.voice ? member.voice.channel : null;
    if (!voiceChannel) {
        return sendReply(ctx, {
            content: 'You must be in a voice channel.',
            ephemeral: ctx.reply ? true : false
        });
    }
    const state = activeGames.get(voiceChannel.id);
    if (!state || state.stage !== 'active') {
        return sendReply(ctx, {
            content: 'No active game in this voice channel.',
            ephemeral: ctx.reply ? true : false
        });
    }
    
    await processGameEnd(state, ctx.channel);
    await sendReply(ctx, { content: 'Game ended.', ephemeral: false });
}

function setupGame(client) {
    client.on('ready', () => registerCommands(client));

    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.isChatInputCommand()) {
                if (interaction.commandName === 'game') {
                    await handleGameCommand(interaction);
                } else if (interaction.commandName === 'gameover') {
                    await handleGameOverCommand(interaction);
                } else if (interaction.commandName === 'categories') {
                    await handleCategoriesCommand(interaction);
                }
            } else if (interaction.isStringSelectMenu() && interaction.customId === 'game_select') {
                const voiceChannel = interaction.member.voice.channel;
                if (!voiceChannel) {
                    return interaction.reply({
                        content: 'You must be in a voice channel.',
                        ephemeral: true
                    });
                }

                const gameType = interaction.values[0];

                // If Imposter, switch the dropdown menu to categories
                if (gameType === 'imposter') {
                    const categoryOptions = [
                        { label: '🎲 Random', value: 'random', description: 'Pick a random category' }
                    ];
                    
                    Object.keys(imposterDictionary).forEach(cat => {
                        categoryOptions.push({ label: cat, value: cat });
                    });

                    const row = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('imposter_category_select')
                            .setPlaceholder('Choose a category')
                            .addOptions(categoryOptions)
                    );

                    await interaction.update({
                        content: 'Select a category for Imposter:',
                        components: [row]
                    });
                } else {
                    // Start normally for other games
                    await startSetup(interaction, voiceChannel, gameType);
                }

            } else if (interaction.isStringSelectMenu() && interaction.customId === 'imposter_category_select') {
                // Handling the second dropdown menu for Imposter categories
                const voiceChannel = interaction.member.voice.channel;
                if (!voiceChannel) {
                    return interaction.reply({ content: 'You must be in a voice channel.', ephemeral: true });
                }
                
                const categoryPreference = interaction.values[0];
                await startSetup(interaction, voiceChannel, 'imposter', categoryPreference);

            } else if (interaction.isButton()) {
                const voiceChannel = interaction.member.voice.channel;
                if (!voiceChannel) {
                    return interaction.reply({
                        content: 'You must be in a voice channel.',
                        ephemeral: true
                    });
                }
                const state = activeGames.get(voiceChannel.id);

                if (interaction.customId === 'start_game') {
                    if (state && state.stage === 'setup') {
                        await startGame(voiceChannel.id, interaction.channel);
                        if (activeGames.has(voiceChannel.id)) {
                            await interaction.update({ content: 'Game starting...', components: [] }).catch(()=>{});
                        }
                    } else {
                        await interaction.reply({ content: 'No game to start.', ephemeral: true });
                    }
                } else if (interaction.customId === 'end_game') {
                    if (state && state.stage === 'active') {
                        await processGameEnd(state, interaction.channel);
                        await interaction.update({ content: 'Game ended.', components: [] }).catch(()=>{});
                    } else {
                        await interaction.reply({ content: 'No active game to end.', ephemeral: true });
                    }
                }
            }
        } catch (err) {
            log_error('Error handling game interaction:', err);
        }
    });

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (message.channel.id !== '1476762244380622878') return;

        const content = message.content.trim();
        if (content.startsWith('$gameover')) {
            await handleGameOverCommand(message);
        } else if (content.startsWith('$game')) {
            await handleGameCommand(message);
        } else if (content.startsWith('$categories')) {
            await handleCategoriesCommand(message);
        }
    });
}

module.exports = {
    setupGame
};