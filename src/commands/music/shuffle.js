const { SlashCommandBuilder } = require("discord.js");
const { requirePlayer, requireSameChannel } = require("../../utils/checks");
const { successEmbed, errorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("Mezclar la cola actual."),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!(await requireSameChannel(interaction, player))) return;

    if (player.queue.tracks.length < 2) {
      return interaction.reply({ embeds: [errorEmbed("Se necesitan al menos 2 canciones en la cola para mezclar.")], flags: 64 });
    }

    player.queue.shuffle();
    await interaction.reply({ embeds: [successEmbed(`🔀 Se mezclaron **${player.queue.tracks.length}** canciones`)] });
  },
};
