const { SlashCommandBuilder } = require("discord.js");
const { requirePlayer, requireSameChannel } = require("../../utils/checks");
const { successEmbed, errorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Establecer o verificar el volumen.")
    .addIntegerOption((o) =>
      o.setName("level").setDescription("Nivel de volumen (1-150)").setMinValue(1).setMaxValue(150)
    ),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;

    const level = interaction.options.getInteger("level");

    // If no level provided, show current volume
    if (level === null) {
      return interaction.reply({
        embeds: [{ color: 0x5865f2, description: `🔊 Volumen actual: **${player.volume}%**` }],
        flags: 64,
      });
    }

    if (!(await requireSameChannel(interaction, player))) return;

    await player.setVolume(level);
    const emoji = level === 0 ? "🔇" : level < 50 ? "🔈" : level < 100 ? "🔉" : "🔊";
    await interaction.reply({ embeds: [successEmbed(`${emoji} Volumen establecido al **${level}%**`)] });
  },
};
