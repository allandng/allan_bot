const config = require('./config');
const { Client, IntentsBitField, MessageFlags, Partials } = require('discord.js');
const { createRoleSelectMenu, handleRoleSelect } = require('./role-select');
const { setupWelcomeMessage } = require('./welcome-message');
const { getStore } = require('./lib/db');
const { log_error, log_warning, log_info } = require('./logger');

// Every feature module exports { name, commands, onCommand, setup?,
// onComponent?, componentPrefix? | componentIds?, onAutocomplete? }.
const modules = [
    require('./game'),
    require('./features/leveling'),
    require('./features/economy'),
    require('./features/gambling'),
    require('./features/trivia'),
    require('./features/deals'),
];

if (!config.token) {
    log_error('TOKEN is missing. Add it to your .env file (see .env.example).');
    process.exit(1);
}

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildMessageReactions,
        IntentsBitField.Flags.GuildVoiceStates,
    ],
    partials: [Partials.GuildMember],
});

// --- Command registry ----------------------------------------------------------

const commandOwners = new Map(); // commandName -> module
for (const mod of modules) {
    for (const cmd of mod.commands || []) {
        if (commandOwners.has(cmd.name)) throw new Error(`Duplicate command /${cmd.name}`);
        commandOwners.set(cmd.name, mod);
    }
}

function componentOwner(customId) {
    return modules.find(
        (m) => (m.componentPrefix && customId.startsWith(m.componentPrefix)) || m.componentIds?.has(customId)
    );
}

async function registerCommands() {
    const body = modules.flatMap((m) => (m.commands || []).map((c) => c.toJSON()));
    // Register everything in ONE call; calling commands.set() per module would
    // overwrite the previous module's commands.
    if (config.guildId) {
        const guild = await client.guilds.fetch(config.guildId);
        await guild.commands.set(body);
        // Clear old global copies so commands don't show up twice.
        await client.application.commands.set([]);
        log_info(`Registered ${body.length} slash commands to guild ${guild.name}.`);
    } else {
        await client.application.commands.set(body);
        log_info(`Registered ${body.length} global slash commands (may take a while to appear).`);
    }
}

// --- Startup ---------------------------------------------------------------------

setupWelcomeMessage(client);
for (const mod of modules) mod.setup?.(client);

client.once('clientReady', async (c) => {
    log_info(`✅ ${c.user.tag} is online in ${c.guilds.cache.size} server(s).`);
    await registerCommands().catch((err) => log_error('Failed to register slash commands', err));
    await ensureRoleSelectMessage().catch((err) => log_error('Error ensuring role select message:', err));
});

async function ensureRoleSelectMessage() {
    const channel = await client.channels.fetch(config.channels.roleSelect).catch(() => null);
    if (!channel) {
        log_warning('Role select channel not found!');
        return;
    }
    const fetched = await channel.messages.fetch({ limit: 100 });
    const existing = fetched.find((msg) =>
        msg.components.some((row) => row.components?.some((comp) => comp.customId === 'role_select'))
    );
    if (existing) {
        log_info('Role select menu already present, not resending.');
        return;
    }
    await channel.send({
        content: '🎯 **Select your roles below!**\n\nYou can select multiple roles or deselect to remove them.',
        components: [createRoleSelectMenu()],
    });
    log_info('✅ Role select menu sent to channel!');
}

// --- Legacy Candy / Visitor role buttons (sent by send-message.js) --------------

const legacyRoles = {
    '1448510698110980096': 'Candy',
    '1448578412556845238': 'Visitor',
};

async function handleLegacyRoleButton(interaction) {
    const roleId = interaction.customId;
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
        return interaction.reply({ content: "❌ This role doesn't exist.", flags: MessageFlags.Ephemeral });
    }
    const otherRoleId = Object.keys(legacyRoles).find((id) => id !== roleId);
    if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        return interaction.reply({ content: `✅ **${legacyRoles[roleId]}** role removed!`, flags: MessageFlags.Ephemeral });
    }
    if (member.roles.cache.has(otherRoleId)) await member.roles.remove(otherRoleId);
    await member.roles.add(roleId);
    return interaction.reply({ content: `✅ You now have the **${legacyRoles[roleId]}** role!`, flags: MessageFlags.Ephemeral });
}

// --- Interaction router ----------------------------------------------------------

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isAutocomplete()) {
            const mod = commandOwners.get(interaction.commandName);
            return await mod?.onAutocomplete?.(interaction);
        }

        if (interaction.isChatInputCommand()) {
            if (!interaction.inGuild()) {
                return await interaction.reply({ content: 'Use my commands inside the server.', flags: MessageFlags.Ephemeral });
            }
            return await commandOwners.get(interaction.commandName)?.onCommand(interaction);
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'role_select') {
            return await handleRoleSelect(interaction);
        }
        if (interaction.isButton() && legacyRoles[interaction.customId]) {
            return await handleLegacyRoleButton(interaction);
        }
        if (interaction.isMessageComponent()) {
            return await componentOwner(interaction.customId)?.onComponent(interaction);
        }
    } catch (error) {
        log_error(`Interaction error (${interaction.commandName || interaction.customId || interaction.type})`, error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Something went wrong!', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
});

// --- Graceful shutdown -----------------------------------------------------------
// bot-hosting.net (Pterodactyl) stops the server with ^C / SIGINT. Flush data
// to disk first so nobody loses XP or coins.

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log_info(`${signal} received, saving data and shutting down...`);
    getStore().flush();
    await client.destroy().catch(() => {});
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => log_error('Unhandled promise rejection', err));

client.login(config.token);
