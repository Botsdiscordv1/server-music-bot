const { SlashCommandBuilder } = require("discord.js");
const { requirePlayer, requireSameChannel } = require("../../utils/checks");
const { successEmbed, errorEmbed } = require("../../utils/embeds");

// ── /skip ─────────────────────────────────────────────────────────────────
const skip = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Saltar la canción actual.")
    .addIntegerOption((o) =>
      o.setName("to").setDescription("Saltar a una posición específica en la cola").setMinValue(1)
    ),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!(await requireSameChannel(interaction, player))) return;

    const to = interaction.options.getInteger("to");
    const skipped = player.queue.current?.info.title || "Unknown";

    if (to) {
      // Remove tracks before the target position
      player.queue.splice(0, to - 1);
    }

    await player.skip();
    await interaction.reply({
      embeds: [successEmbed(to ? `Saltado a la posición **#${to}**` : `Saltado **${skipped}**`)],
    });
  },
};

// ── /stop ─────────────────────────────────────────────────────────────────
const stop = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Detiene la reproducción y borra la cola."),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!(await requireSameChannel(interaction, player))) return;

    await player.destroy();
    await interaction.reply({ embeds: [successEmbed("Detuve la reproducción y borre la cola.")] });
  },
};

// ── /pause ────────────────────────────────────────────────────────────────
const pause = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pausa la canción actual."),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!(await requireSameChannel(interaction, player))) return;

    if (player.paused) {
      return interaction.reply({ embeds: [errorEmbed("Ya está pausada. Usa `/resume` para continuar.")], flags: 64 });
    }

    await player.pause(true);
    player._pausedAt = Date.now();
    await interaction.reply({ embeds: [successEmbed("Pausado ⏸")] });
  },
};

// ── /resume ───────────────────────────────────────────────────────────────
const resume = {
  data: new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Reanuda la música."),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!(await requireSameChannel(interaction, player))) return;

    if (!player.paused) {
      return interaction.reply({ embeds: [errorEmbed("No está pausada.")], flags: 64 });
    }

    if (player._pausedAt && player._trackStartTime) {
      const pauseDuration = Date.now() - player._pausedAt;
      player._trackStartTime += pauseDuration;
    }
    await player.resume();
    await interaction.reply({ embeds: [successEmbed("Reanudada ▶️")] });
  },
};

module.exports = { skip, stop, pause, resume };

// Export each as its own command file pattern — but since discord.js
// loads by file, we re-export each individually via separate files.
// See commands/music/skip.js, stop.js, pause.js, resume.js
