const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { getLikedSongs, removeLikedSong, removeAllLikedSongs, copyLikedSongs } = require("../../database");
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
        return interaction.reply({ embeds: [errorEmbed("No tienes canciones con me gusta. Usa el botón ❤️ en el reproductor para añadir.")], flags: MessageFlags.Ephemeral });
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
          await interaction.reply({ embeds: [embed], components: row ? [row] : [], flags: MessageFlags.Ephemeral });
          const reply = await interaction.fetchReply();
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
      const removed = await removeLikedSong(interaction.user.id, id);
      if (removed) {
        return interaction.reply({ 
          embeds: [successEmbed(`❌ **${removed.trackTitle}** — ${removed.trackAuthor || "Desconocido"} eliminada de Tus Me Gusta.`)], 
          flags: MessageFlags.Ephemeral 
        });
      }
      return interaction.reply({ embeds: [errorEmbed("No se encontró esa canción en Tus Me Gusta.")], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("likes-copy")
      .setDescription("Copia la lista de Tus Me Gusta de otro usuario a tu lista.")
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("El usuario del que quieres copiar la lista")
          .setRequired(true)
      ),
    async execute(interaction, client) {
      const fromUser = interaction.options.getUser("user");
      const toUserId = interaction.user.id;

      if (fromUser.id === toUserId) {
        return interaction.reply({
          embeds: [errorEmbed("No puedes copiar tu propia lista de Me Gusta.")],
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const result = await copyLikedSongs(fromUser.id, toUserId);
        if (result.total === 0) {
          return interaction.editReply({
            embeds: [errorEmbed(`El usuario <@${fromUser.id}> no tiene canciones en Tus Me Gusta.`)]
          });
        }

        const embed = successEmbed(
          `Copiadas **${result.copied}** canciones de <@${fromUser.id}>.\n` +
          `*(Se omitieron ${result.skipped} canciones duplicadas)*`
        );
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error("[LikeCopy] Error:", err);
        return interaction.editReply({
          embeds: [errorEmbed("Ocurrió un error al copiar las canciones.")]
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("likes-remove-all")
      .setDescription("Elimina todas las canciones de Tus Me Gusta."),
    async execute(interaction, client) {
      const songs = await getLikedSongs(interaction.user.id);
      if (songs.length === 0) {
        return interaction.reply({ embeds: [errorEmbed("No tienes canciones en Tus Me Gusta.")], flags: MessageFlags.Ephemeral });
      }

      const confirmEmbed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle("⚠️ Confirmación requerida")
        .setDescription(`Esto eliminará **todas** las **${songs.length} canciones** de Tus Me Gusta.\n\nEsta acción es **irreversible**.`)
        .setFooter({ text: "Tienes 30 segundos para confirmar" });

      const confirmBtn = new ButtonBuilder()
        .setCustomId("likes_remove_all_confirm")
        .setLabel("Sí, eliminar todo")
        .setStyle(ButtonStyle.Danger);

      const cancelBtn = new ButtonBuilder()
        .setCustomId("likes_remove_all_cancel")
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(cancelBtn, confirmBtn);

      await interaction.reply({ embeds: [confirmEmbed], components: [row], flags: MessageFlags.Ephemeral });
      const reply = await interaction.fetchReply();

      const collector = reply.createMessageComponentCollector({ time: 30000 });

      collector.on("collect", async (btn) => {
        if (btn.user.id !== interaction.user.id) {
          return btn.reply({ content: "No puedes confirmar la acción de otro usuario.", flags: MessageFlags.Ephemeral });
        }

        if (btn.customId === "likes_remove_all_confirm") {
          const deleted = await removeAllLikedSongs(interaction.user.id);
          console.log(`[LikesRemoveAll] User ${interaction.user.id} deleted ${deleted} liked songs.`);
          const resultEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setDescription(`✅ Se eliminaron **${deleted} canciones** de Tus Me Gusta.`);
          await btn.update({ embeds: [resultEmbed], components: [] });
        } else {
          const cancelEmbed = new EmbedBuilder()
            .setColor(0xed4245)
            .setDescription("❌ Eliminación cancelada.");
          await btn.update({ embeds: [cancelEmbed], components: [] });
        }
        collector.stop();
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          const timeoutEmbed = new EmbedBuilder()
            .setColor(0xed4245)
            .setDescription("⏰ Tiempo agotado. Eliminación cancelada.");
          await interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
        }
      });
    },
  },
];
