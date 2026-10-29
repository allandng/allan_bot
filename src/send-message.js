// One-off script: posts the Candy / Visitor role buttons. Run with `npm run send-roles`.
const config = require('./config');
const { Client, IntentsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { log_error, log_warning, log_info } = require('./logger');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
    ],
});

const roles = [
    {
        id: '1448510698110980096',
        label: 'Candy'
    },
    {
        id: '1448578412556845238',
        label: 'Visitor'
    },
];

client.once('clientReady', async (c) => {
    try {
        const channel = await client.channels.fetch(config.channels.roleSelect);
        if (!channel) {
            log_warning('Channel not found!');
            return;
        }

        const row = new ActionRowBuilder();

        roles.forEach((role) => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(role.id)
                    .setLabel(role.label)
                    .setStyle(ButtonStyle.Primary)
            );
        });

        await channel.send({
            content: '**Please choose one role below!**\nClick a button to select your role.',
            components: [row],
        });
        
        log_info('✅ Message sent successfully!');
        // process.exit(); // Remove this if you want the bot to stay online
        
    } catch (error) {
        log_error('Error:', error);
    }
});

client.login(config.token);