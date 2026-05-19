const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getUserStats, getTopListeners } = require("../../database");
const { errorEmbed } = require("../../utils/embeds");

function formatDuration(ms) {
  if (!ms) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName("stats")
      .setDescription("Muestra tus estadísticas de escucha")
      .addUserOption((o) => o.setName("user").setDescription("Usuario a verificar (opcional)")),
    async execute(interaction, client) {
      const user = interaction.options.getUser("user") || interaction.user;
      const stats = await getUserStats(user.id);

      if (!stats) {
        return interaction.reply({ embeds: [errorEmbed("Aun no hay estadísticas para este usuario.")] });
      }

      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle(`📊 Stats for ${user.username}`)
        .addFields(
          { name: "Tracks Played", value: stats.tracks_played.toString(), inline: true },
          { name: "Listen Time", value: formatDuration(stats.total_listen_time), inline: true },
          { name: "Favorite Artist", value: stats.favorite_artist || "Unknown", inline: true }
        )
        .setFooter({ text: `Last played: ${stats.last_played || "N/A"}` });

      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("top-listeners")
      .setDescription("Mostrar los mejores oyentes en este servidor"),
    async execute(interaction, client) {
      const top = await getTopListeners(10);

      if (top.length === 0) {
        return interaction.reply({ embeds: [errorEmbed("Aun no hay estadísticas.")] });
      }

      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle("🏆 Top Listeners")
        .setDescription(
          top.map((u, i) => `${i + 1}. <@${u.user_id}> — ${u.tracks_played} tracks, ${formatDuration(u.total_listen_time)}`).join("\n")
        );

      await interaction.reply({ embeds: [embed] });
    },
  },
];