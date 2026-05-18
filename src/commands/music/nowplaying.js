const { SlashCommandBuilder } = require("discord.js");
const { requirePlayer } = require("../../utils/checks");
const { nowPlayingEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Muestra la canción que se está reproduciendo."),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;

    const track = player.queue.current;
    const position = player._trackStartTime ? Date.now() - player._trackStartTime : player.position;
    await interaction.reply({ embeds: [nowPlayingEmbed(track, player, position)] });
  },
};
