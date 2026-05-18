const { SlashCommandBuilder } = require("discord.js");
const { requirePlayer, requireSameChannel } = require("../../utils/checks");
const { successEmbed, errorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("Alterna la reproducción automática de canciones relacionadas cuando la cola termina."),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!(await requireSameChannel(interaction, player))) return;

    player._autoplayEnabled = !player._autoplayEnabled;

    if (player._autoplayEnabled) {
      return interaction.reply({
        embeds: [successEmbed("Autoplay activado 🔁 — se reproducirán canciones relacionadas automáticamente cuando la cola termine.")],
      });
    }

    return interaction.reply({
      embeds: [successEmbed("Autoplay desactivado.")],
    });
  },
};
