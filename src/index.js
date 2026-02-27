require('dotenv').config();
const { Client, IntentsBitField } = require('discord.js');
const { createRoleSelectMenu, handleRoleSelect } = require('./role-select');
const { setupWelcomeMessage } = require('./welcome-message');
const { setupGame } = require('./game');
const { log_error, log_warning, log_info } = require('./logger');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildMessageReactions // Added this to read reactions
    ]
});

// Setup module handlers OUTSIDE the ready event so their listeners attach properly
setupWelcomeMessage(client);
setupGame(client);

// Initialize all modules on bot startup
client.on('ready', async (c) => {
    log_info(`✅ ${c.user.tag} is online.`);
    
    // Ensure role select menu exists in channel (only send if missing)
    try {
        const channel = await client.channels.fetch('1448580230741495818');
        if (!channel) {
            log_warning('Role select channel not found!');
            return;
        }

        // look for existing message with select menu
        const fetched = await channel.messages.fetch({ limit: 100 });
        const existing = fetched.find(msg =>
            msg.components.some(row =>
                row.components.some(comp => comp.customId === 'role_select')
            )
        );

        if (existing) {
            log_info('Role select menu already present, not resending.');
        } else {
            const roleMenu = createRoleSelectMenu();
            await channel.send({
                content: '🎯 **Select your roles below!**\n\nYou can select multiple roles or deselect to remove them.',
                components: [roleMenu],
            });
            log_info('✅ Role select menu sent to channel!');
        }
    } catch (error) {
        log_error('Error ensuring role select message:', error);
    }
});

// Role buttons system
const roles = {
    '1448510698110980096': 'Candy',
    '1448578412556845238': 'Visitor'
};

// Handle interactions (select menus and buttons)
client.on('interactionCreate', async (interaction) => {
    // Handle role select menu
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'role_select') {
            await handleRoleSelect(interaction);
        }
        return;
    }

    if (!interaction.isButton()) return;
    
    try {
        const roleId = interaction.customId;
        if (!roles[roleId]) return;
        
        const member = interaction.member;
        const role = interaction.guild.roles.cache.get(roleId);
        
        if (!role) {
            await interaction.reply({ 
                content: "❌ This role doesn't exist.", 
                ephemeral: true 
            });
            return;
        }
        
        const otherRoleId = Object.keys(roles).find(id => id !== roleId);
        
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId);
            await interaction.reply({ 
                content: `✅ **${roles[roleId]}** role removed!`, 
                ephemeral: true 
            });
            return;
        }
        
        if (member.roles.cache.has(otherRoleId)) {
            await member.roles.remove(otherRoleId);
        }
        
        await member.roles.add(roleId);
        await interaction.reply({ 
            content: `✅ You now have the **${roles[roleId]}** role!`, 
            ephemeral: true 
        });
        
    } catch (error) {
        log_error('Role button error:', error);
        if (!interaction.replied) {
            await interaction.reply({ 
                content: '❌ Something went wrong!', 
                ephemeral: true 
            });
        }
    }
});

client.login(process.env.TOKEN);