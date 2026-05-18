const { SlashCommandBuilder } = require("discord.js");
const { requirePlayer, requireSameChannel } = require("../../utils/checks");
const { successEmbed, errorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Aplica un filtro de audio.")
    .addStringOption((o) =>
      o
        .setName("effect")
        .setDescription("Filtro a aplicar")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!(await requireSameChannel(interaction, player))) return;

    const effect = interaction.options.getString("effect");

    if (!player.filterManager) {
      return interaction.reply({ embeds: [errorEmbed("Los filtros no están disponibles en este momento.")] });
    }

    const names = {
      bassboost_low: "🎸 Bass Boost - Bajo",
      bassboost_medium: "🎸 Bass Boost - Medio",
      bassboost_high: "🎸 Bass Boost - Alto",
      nightcore: "🌙 Nightcore",
      vaporwave: "🌊 Vaporwave",
      karaoke: "🎤 Karaoke",
      "8d": "🎧 8D Audio",
      tremolo: "🌀 Tremolo",
      vibrato: "🔔 Vibrato",
      clear: "❌ Filtros",
    };

    const bassLevels = {
      bassboost_low: [
        { band: 0, gain: 0.15 },
        { band: 1, gain: 0.10 },
        { band: 2, gain: 0.05 },
        { band: 3, gain: -0.20 },
        { band: 4, gain: -0.50 },
      ],
      bassboost_medium: [
        { band: 0, gain: 0.3 },
        { band: 1, gain: 0.35 },
        { band: 2, gain: 0.35 },
        { band: 3, gain: 0 },
        { band: 4, gain: -0.25 },
      ],
      bassboost_high: [
        { band: 0, gain: 0.7 },
        { band: 1, gain: 0.8 },
        { band: 2, gain: 0.8 },
        { band: 3, gain: 0 },
        { band: 4, gain: -0.5 },
      ],
    };

    try {
      if (effect === "clear") {
        await player.filterManager.resetFilters();
        await player.filterManager.clearEQ();
        return interaction.reply({ embeds: [successEmbed("✨ Filtros de audio eliminados.")] });
      }

      if (bassLevels[effect]) {
        await player.filterManager.setEQ(bassLevels[effect]);
      } else if (effect === "nightcore") {
        await player.filterManager.toggleNightcore(1.2, 1.2, 1);
      } else if (effect === "vaporwave") {
        await player.filterManager.toggleVaporwave(0.8, 0.8, 1);
      } else if (effect === "karaoke") {
        await player.filterManager.toggleKaraoke(1, 1, 220, 100);
      } else if (effect === "8d") {
        await player.filterManager.toggleRotation(0.2);
      } else if (effect === "tremolo") {
        await player.filterManager.toggleTremolo(4, 0.5);
      } else if (effect === "vibrato") {
        await player.filterManager.toggleVibrato(14, 1);
      }

      await interaction.reply({ embeds: [successEmbed(`Aplicado filtro: **${names[effect]}**`)] });
    } catch (err) {
      console.error("[Filter] Error:", err);
      return interaction.reply({ embeds: [errorEmbed("Error al aplicar el filtro.")] });
    }
  },

  async autocomplete(interaction, client) {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = [
      { name: "🎸 Bass Boost - Bajo", value: "bassboost_low" },
      { name: "🎸 Bass Boost - Medio", value: "bassboost_medium" },
      { name: "🎸 Bass Boost - Alto", value: "bassboost_high" },
      { name: "🌙 Nightcore", value: "nightcore" },
      { name: "🌊 Vaporwave", value: "vaporwave" },
      { name: "🎤 Karaoke", value: "karaoke" },
      { name: "🎧 8D Audio", value: "8d" },
      { name: "🌀 Tremolo", value: "tremolo" },
      { name: "🔔 Vibrato", value: "vibrato" },
      { name: "❌ Quitar Filtros", value: "clear" },
    ];

    const filtered = focused
      ? choices.filter(c => c.name.toLowerCase().includes(focused))
      : choices;

    await interaction.respond(filtered.slice(0, 25)).catch(() => {});
  },
};