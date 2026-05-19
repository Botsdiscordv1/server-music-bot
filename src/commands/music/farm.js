const { SlashCommandBuilder } = require("discord.js");
const { requireVoiceChannel } = require("../../utils/checks");
const { successEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("farm")
    .setDescription("Activa/desactiva el modo farmeo (evita que el bot se vaya por inactividad)."),

  async execute(interaction, client) {
    const voiceChannel = await requireVoiceChannel(interaction);
    if (!voiceChannel) return;

    let player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) {
      player = await client.lavalink.createPlayer({
        guildId: interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        volume: 100,
      });
    }
    if (!player.connected) await player.connect();

    if (player._farmMode) {
      player._farmMode = false;
      await interaction.reply({ embeds: [successEmbed("Modo Farmeo desactivado")] });
    } else {
      player._farmMode = true;
      await interaction.reply({ embeds: [successEmbed("Modo Farmeo activado")] });
    }
  },
};
