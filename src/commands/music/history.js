const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getHistory, clearHistory } = require("../../database");
const { errorEmbed } = require("../../utils/embeds");

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName("history")
      .setDescription("Muestra el historial de reproducción de este servidor.")
      .addIntegerOption((o) => o.setName("limit").setDescription("Número de canciones (máximo 50)").setMinValue(5).setMaxValue(50)),
    async execute(interaction, client) {
      const limit = interaction.options.getInteger("limit") || 20;
      const history = getHistory(interaction.guildId, limit);

      if (history.length === 0) {
        return interaction.reply({ embeds: [errorEmbed("No hay historial de reproducción en este servidor.")] });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📜 Historial de Reproducción")
        .setDescription(
          history.map((h, i) => `${i + 1}. **${h.track_title}** — ${h.track_author || "Desconocido"}`).join("\n")
        )
        .setFooter({ text: `Mostrando ${history.length} canciones recientes.` });

      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("history-clear")
      .setDescription("Borra el historial de reproducción de este servidor."),
    async execute(interaction, client) {
      clearHistory(interaction.guildId);
      await interaction.reply({ embeds: [{ color: 0x57f287, description: "✅ Historial borrado." }] });
    },
  },
];