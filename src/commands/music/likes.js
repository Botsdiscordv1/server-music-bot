const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getLikedSongs, removeLikedSong } = require("../../database");
const { errorEmbed, successEmbed } = require("../../utils/embeds");

const ITEMS_PER_PAGE = 10;

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName("likes")
      .setDescription("Muestra tus canciones con me gusta."),
    async execute(interaction, client) {
      const songs = await getLikedSongs(interaction.user.id);
      if (songs.length === 0) {
        return interaction.reply({ embeds: [errorEmbed("No tienes canciones con me gusta. Usa el botón ❤️ en el reproductor para añadir.")] });
      }

      const totalPages = Math.ceil(songs.length / ITEMS_PER_PAGE);
      let currentPage = 1;

      const buildEmbed = (page) => {
        const start = (page - 1) * ITEMS_PER_PAGE;
        const slice = songs.slice(start, start + ITEMS_PER_PAGE);
        const desc = slice.map((s, i) => `\`${start + i + 1}.\` **${s.track_title}** — ${s.track_author || "Desconocido"}`).join("\n");
        return new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle(`❤️ Tus Me Gusta`)
          .setDescription(desc)
          .setFooter({ text: `Página ${page}/${totalPages} • ${songs.length} canciones` });
      };

      const sendPage = async (page) => {
        const embed = buildEmbed(page);
        const row = totalPages > 1 ? new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`likes_prev_${page}`).setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
          new ButtonBuilder().setCustomId(`likes_next_${page}`).setLabel("Siguiente ▶").setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
        ) : null;

        if (currentPage === page && interaction.replied) {
          await interaction.editReply({ embeds: [embed], components: row ? [row] : [] });
        } else {
          const reply = await interaction.reply({ embeds: [embed], components: row ? [row] : [], fetchReply: true });
          if (row) {
            const collector = reply.createMessageComponentCollector({ time: 60000 });
            collector.on("collect", async (btn) => {
              if (btn.user.id !== interaction.user.id) return btn.reply({ content: "Usa `/likes` tú mismo.", flags: 64 });
              currentPage += btn.customId.startsWith("likes_prev") ? -1 : 1;
              await btn.update({ embeds: [buildEmbed(currentPage)], components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`likes_prev_${currentPage}`).setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(currentPage <= 1),
                new ButtonBuilder().setCustomId(`likes_next_${currentPage}`).setLabel("Siguiente ▶").setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages)
              )] });
            });
            collector.on("end", () => reply.edit({ components: [] }).catch(() => {}));
          }
        }
      };

      await sendPage(currentPage);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("likes-remove")
      .setDescription("Elimina una canción de Tus Me Gusta.")
      .addIntegerOption((o) => o.setName("id").setDescription("ID de la canción (usa /likes)").setRequired(true)),
    async execute(interaction, client) {
      const id = interaction.options.getInteger("id");
      if (await removeLikedSong(interaction.user.id, id)) {
        return interaction.reply({ embeds: [successEmbed(`Canción #${id} eliminada de Tus Me Gusta.`)] });
      }
      return interaction.reply({ embeds: [errorEmbed("No se encontró esa canción en Tus Me Gusta.")] });
    },
  },
];
