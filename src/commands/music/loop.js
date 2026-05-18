const { SlashCommandBuilder } = require("discord.js");
const { requirePlayer, requireSameChannel } = require("../../utils/checks");
const { successEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Activa el modo de repetición.")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Modo de repetición")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "none" },
          { name: "Track 🔂", value: "track" },
          { name: "Queue 🔁", value: "queue" }
        )
    ),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!(await requireSameChannel(interaction, player))) return;

    const mode = interaction.options.getString("mode");
    player.setRepeatMode(mode);

    const labels = { none: "Loop **off**", track: "Looping current **track** 🔂", queue: "Looping **queue** 🔁" };
    await interaction.reply({ embeds: [successEmbed(labels[mode])] });
  },
};
