const { log_error, log_info } = require('./logger');

// Welcome embed with GIFs
const welcomeGifs = [
    'https://media1.tenor.com/m/xsICn9T81LcAAAAC/roy-leops.gif',
    'https://pa1.aminoapps.com/6350/6635ab934586f5cc9cb2756058f6170b583aea89_hq.gif',
    'https://www.cbc.ca/kidsnews/images/Aura_Farming_Kid.gif',
    'https://media4.giphy.com/media/v1.Y2lkPTZjMDliOTUyMG1hOHo0cnFmNHdoMjMwaWg0NzJvZGg3Mks3NGN4dmtucXB5YTJybCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/g88xUM1rTwjfLhoRYP/200.gif',
    'https://media0.giphy.com/media/v1.Y2lkPTZjMDliOTUyejBtcW8xOHNhMmgwbjlxbnVybXl3YXJ5ajdoOHZ0YXU0N2hzbzU5NCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/GPFdOplLs2Mw2MfgTs/200.gif',
    'https://i.pinimg.com/originals/a1/9f/09/a19f09386c8bf4a5ba48d07a7b4171f2.gif',
    'https://media4.giphy.com/media/v1.Y2lkPTZjMDliOTUyYWU2Zzd5bnNqMWFxYWJvYmh2NXBvNWVvMHNyczZienBodXRvNXc1bCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/WOwiryOPA0G6jhKqB0/200w.gif',
];

/**
 * Setup the welcome message event handler
 * @param {Client} client - Discord client
 */
function setupWelcomeMessage(client) {
    client.on('guildMemberAdd', async (member) => {
        log_info(`🎉 Welcome ${member.user.tag}!`);
        
        const randomGif = welcomeGifs[Math.floor(Math.random() * welcomeGifs.length)];
        
        const channel = member.guild.channels.cache.get('1448509552541831230');
        if (channel) {
            const welcomeEmbed = {
                color: 0xFFB6C1,
                title: `🍬 Welcome to Candy SMP, ${member.displayName}! 🍬`,
                description: `You're our **#${member.guild.memberCount}** member!`,
                thumbnail: {
                    url: member.user.displayAvatarURL({ dynamic: true, size: 256 })
                },
                fields: [
                    {
                        name: '📜 Starting Advice',
                        value: '**1.** Be nice!\n**2.** Invite friends! (preferably 1 connection away)\n**3.** Use the server modpack\n**4.** Put your MC name in #mc-names to get whitelisted!\n**5.** Get a role in #Important\n**6.** If you are lagging (due to connections) → use a VPN',
                        inline: false
                    },
                    {
                        name: '🔗 Server IP',
                        value: 'go check #mc-names for current server if one exists!',
                        inline: false
                    }
                ],
                image: {
                    url: randomGif
                },
                footer: {
                    text: 'Have fun and enjoy your stay! 😄',
                    icon_url: member.guild.iconURL()
                },
                timestamp: new Date()
            };
            
            await channel.send({
                content: `🎉 **Welcome ${member}!**`,
                embeds: [welcomeEmbed]
            });
            log_info(`✅ Welcome embed sent to ${member.user.tag}`);
        }
    });
}

module.exports = {
    setupWelcomeMessage
};
