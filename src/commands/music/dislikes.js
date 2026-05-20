const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { getDislikedSongs, removeDislikedSongById } = require("../../database");
const { errorEmbed, successEmbed } = require("../../utils/embeds");

const ITEMS_PER_PAGE = 10;

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName("dislikes")
      .setDescription("Muestra tus canciones con dislike."),
    async execute(interaction, client) {
      const songs = await getDislikedSongs(interaction.user.id);
      if (songs.length === 0) {
        return interaction.reply({ embeds: [errorEmbed("No tienes canciones con dislike.")], flags: MessageFlags.Ephemeral });
      }

      const totalPages = Math.ceil(songs.length / ITEMS_PER_PAGE);
      let currentPage = 1;

      const buildEmbed = (page) => {
        const start = (page - 1) * ITEMS_PER_PAGE;
        const slice = songs.slice(start, start + ITEMS_PER_PAGE);
        const desc = slice.map((s, i) => `\`${start + i + 1}.\` **${s.trackTitle}** — ${s.trackAuthor || "Desconocido"}`).join("\n");
        return new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle(`👎 Dislikes`)
          .setDescription(desc)
          .setFooter({ text: `Página ${page}/${totalPages} • ${songs.length} canciones` });
      };

      const sendPage = async (page) => {
        const embed = buildEmbed(page);
        const row = totalPages > 1 ? new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`dislikes_prev_${page}`).setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
          new ButtonBuilder().setCustomId(`dislikes_next_${page}`).setLabel("Siguiente ▶").setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
        ) : null;

        if (currentPage === page && interaction.replied) {
          await interaction.editReply({ embeds: [embed], components: row ? [row] : [] });
        } else {
          await interaction.reply({ embeds: [embed], components: row ? [row] : [], flags: MessageFlags.Ephemeral });
          const reply = await interaction.fetchReply();
          if (row) {
            const collector = reply.createMessageComponentCollector({ time: 60000 });
            collector.on("collect", async (btn) => {
              if (btn.user.id !== interaction.user.id) return btn.reply({ content: "Usa `/dislikes` tú mismo.", flags: 64 });
              currentPage += btn.customId.startsWith("dislikes_prev") ? -1 : 1;
              await btn.update({ embeds: [buildEmbed(currentPage)], components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`dislikes_prev_${currentPage}`).setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(currentPage <= 1),
                new ButtonBuilder().setCustomId(`dislikes_next_${currentPage}`).setLabel("Siguiente ▶").setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages)
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
      .setName("dislikes-remove")
      .setDescription("Elimina una canción de tu lista de dislikes.")
      .addIntegerOption((o) => o.setName("id").setDescription("ID de la canción (usa /dislikes)").setRequired(true)),
    async execute(interaction, client) {
      const id = interaction.options.getInteger("id");
      const removed = await removeDislikedSongById(interaction.user.id, id);
      if (removed) {
        try {
          await interaction.user.send({ embeds: [successEmbed(`✅ **${removed.trackTitle}** — ${removed.trackAuthor || "Desconocido"} eliminada de dislikes.`)] });
        } catch {}
        return interaction.reply({ embeds: [successEmbed(`✅ **${removed.trackTitle}** eliminada de dislikes.`)], flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ embeds: [errorEmbed("No se encontró esa canción en tu lista de dislikes.")], flags: MessageFlags.Ephemeral });
    },
  },
];
