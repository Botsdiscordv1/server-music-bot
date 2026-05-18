const { SlashCommandBuilder } = require("discord.js");
const { requireVoiceChannel } = require("../../utils/checks");
const { statusEmbed, errorEmbed, successEmbed } = require("../../utils/embeds");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("resume")
        .setDescription("Reanuda la música."),

    async execute(interaction, client) {
        await interaction.deferReply();

        const voiceChannel = await requireVoiceChannel(interaction);
        if (!voiceChannel) return;

        const player = client.lavalink.getPlayer(interaction.guildId);
        if (!player || !player.connected) {
            return interaction.editReply({ embeds: [errorEmbed("No estoy conectado a un canal de voz.")] });
        }

        if (player.paused) {
            await player.resume();
            const track = player.queue.current;
            console.log(`[Resume] Resumed. Track: ${track?.info?.title || "unknown"}`);
            return interaction.editReply({
                embeds: [statusEmbed("music", "Reanudado", `Reproduciendo: **${track?.info?.title || "unknown"}**`)]
            });
        } else {
            const track = player.queue.current;
            console.log(`[Resume] Already playing. Track: ${track?.info?.title || "unknown"}`);
            return interaction.editReply({ embeds: [statusEmbed("music", "Ya está reproduciendo", `Reproduciendo: **${track?.info?.title || "unknown"}**`)] });
        }
    },
};
