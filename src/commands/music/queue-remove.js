const { SlashCommandBuilder } = require("discord.js");
const { requirePlayer, requireSameChannel } = require("../../utils/checks");
const { successEmbed, errorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue-remove")
    .setDescription("Eliminar una canción de la cola por su posición.")
    .addIntegerOption((o) =>
      o.setName("position")
        .setDescription("Posición de la canción en la cola (1 = siguiente)")
        .setMinValue(1)
        .setRequired(true)
    ),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!(await requireSameChannel(interaction, player))) return;

    const position = interaction.options.getInteger("position");
    const queue = player.queue.tracks;

    if (position > queue.length) {
      return interaction.reply({
        embeds: [errorEmbed(`La posición ${position} no existe. La cola tiene ${queue.length} canciones.`)],
      });
    }

    const removed = queue[position - 1];
    queue.splice(position - 1, 1);

    await interaction.reply({
      embeds: [successEmbed(`Eliminada: **${removed.info.title}** (posición #${position})`)],
    });
  },
};