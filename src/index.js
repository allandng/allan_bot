require('dotenv').config();
const { Client, IntentsBitField } = require('discord.js');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
    ]
});

//log bot online
client.on('ready', (c) => {
    console.log(`✅ ${c.user.tag} is online.`);
});

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

client.on('guildMemberAdd', async (member) => {
    console.log(`🎉 Welcome ${member.user.tag}!`);
    
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
                    name: '📦 Modpack Downloads',
                    value: '[Modrinth App](https://modrinth.com/app)\n[Barebones MP with Voice Chat](https://modrinth.com/modpack/barebonesmp-voicechat)',
                    inline: false
                },
                {
                    name: '🔗 Server IP',
                    value: '```51.79.37.43:25570```',
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
        console.log(`✅ Welcome embed sent to ${member.user.tag}`);
    }
});

// Role buttons system
const roles = {
    '1448510698110980096': 'Candy',
    '1448578412556845238': 'Visitor'
};

client.on('interactionCreate', async (interaction) => {
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
        console.error('Role button error:', error);
        if (!interaction.replied) {
            await interaction.reply({ 
                content: '❌ Something went wrong!', 
                ephemeral: true 
            });
        }
    }
});

client.login(process.env.TOKEN);