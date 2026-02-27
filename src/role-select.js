const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { log_error, log_warning, log_info } = require('./logger');

const ROLES = {
    'league': '1475707080798109696',
    'mc': '1475707128001069187'
};

const ROLE_LABELS = {
    'league': '🎮 League',
    'mc': '⛏️ Minecraft'
};

// Create the role select menu
function createRoleSelectMenu() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('role_select')
            .setPlaceholder('Select roles you want')
            .setMinValues(0)
            .setMaxValues(Object.keys(ROLES).length)
            .addOptions(
                [
                    {
                        label: ROLE_LABELS.league,
                        value: 'league',
                        description: 'Get the League role'
                    },
                    {
                        label: ROLE_LABELS.mc,
                        value: 'mc',
                        description: 'Get the Minecraft role'
                    }
                ]
            )
    );
}

// Handle role selection
async function handleRoleSelect(interaction) {
    try {
        const selectedValues = interaction.values; // Array of selected role keys
        const member = interaction.member;
        const guild = interaction.guild;

        // Get all roles that should be applied
        const rolesToAdd = selectedValues.map(roleKey => ROLES[roleKey]);
        const allRoleIds = Object.values(ROLES);

        // Remove roles that are not selected
        for (const roleId of allRoleIds) {
            if (member.roles.cache.has(roleId) && !rolesToAdd.includes(roleId)) {
                try {
                    await member.roles.remove(roleId);
                } catch (error) {
                    log_error(`Failed to remove role ${roleId}:`, error);
                }
            }
        }

        // Add newly selected roles
        for (const roleId of rolesToAdd) {
            if (!member.roles.cache.has(roleId)) {
                try {
                    await member.roles.add(roleId);
                } catch (error) {
                    log_error(`Failed to add role ${roleId}:`, error);
                }
            }
        }

        // Create a nice confirmation message
        let confirmationMessage = '✅ **Roles Updated!**\n\n';
        
        if (selectedValues.length === 0) {
            confirmationMessage = '✅ **All roles removed!**\n\nYou now have no selected roles.';
        } else {
            confirmationMessage += '**Your roles:**\n';
            selectedValues.forEach(roleKey => {
                confirmationMessage += `• ${ROLE_LABELS[roleKey]}\n`;
            });
        }

        await interaction.reply({
            content: confirmationMessage,
            ephemeral: true
        });

    } catch (error) {
        log_error('Role select error:', error);
        if (!interaction.replied) {
            await interaction.reply({
                content: '❌ Something went wrong while updating roles!',
                ephemeral: true
            });
        }
    }
}

module.exports = {
    createRoleSelectMenu,
    handleRoleSelect,
    ROLES,
    ROLE_LABELS
};
