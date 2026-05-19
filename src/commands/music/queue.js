const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { requirePlayer } = require("../../utils/checks");
const { queueEmbed, errorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Muestra la cola actual.")
    .addIntegerOption((o) =>
      o.setName("page").setDescription("Número de página").setMinValue(1)
    ),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;

    const page = interaction.options.getInteger("page") || 1;
    const queue = player.queue.tracks;
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(queue.length / perPage));

    if (page > totalPages) {
      return interaction.reply({ embeds: [errorEmbed(`Página ${page} no existe. Página máxima: ${totalPages}`)], flags: 64 });
    }

    const embed = queueEmbed(player, page);

    // Pagination buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue_prev_${page}`)
        .setLabel("◀ Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`queue_next_${page}`)
        .setLabel("Siguiente ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages)
    );

    await interaction.reply({
      embeds: [embed],
      components: totalPages > 1 ? [row] : [],
    });
    const reply = await interaction.fetchReply();

    if (totalPages <= 1) return;

    const collector = reply.createMessageComponentCollector({ time: 60_000 });
    collector.on("collect", async (btn) => {
      if (btn.user.id !== interaction.user.id) {
        return btn.reply({ content: "Usa `/queue` tú mismo para navegar por las páginas.", flags: 64 });
      }

      let newPage = page;
      if (btn.customId.startsWith("queue_prev")) newPage--;
      if (btn.customId.startsWith("queue_next")) newPage++;

      const newEmbed = queueEmbed(player, newPage);
      const newRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`queue_prev_${newPage}`)
          .setLabel("◀ Anterior")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(newPage <= 1),
        new ButtonBuilder()
          .setCustomId(`queue_next_${newPage}`)
          .setLabel("Siguiente ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(newPage >= totalPages)
      );

      await btn.update({ embeds: [newEmbed], components: [newRow] });
    });

    collector.on("end", () => {
      reply.edit({ components: [] }).catch(() => { });
    });
  },
};
