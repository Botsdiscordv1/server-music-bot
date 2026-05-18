const { SlashCommandBuilder } = require("discord.js");
const { EmbedBuilder } = require("discord.js");
const { requirePlayer } = require("../../utils/checks");
const { getRecommendations } = require("../../services/spotify");
const { errorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("recommend")
    .setDescription("Get Spotify song recommendations based on the current track."),

  async execute(interaction, client) {
    await interaction.deferReply();

    const player = client.lavalink.getPlayer(interaction.guildId);
    const current = player?.queue?.current;

    // Get the Spotify track ID from the track URI or plugin info
    const spotifyId =
      current?.pluginInfo?.identifier ||
      current?.info?.uri?.match(/track[:/]([A-Za-z0-9]+)/)?.[1];

    if (!spotifyId) {
      return interaction.editReply({
        embeds: [errorEmbed("No se pudieron obtener datos de Spotify para la canción actual. Asegúrate de que sea una pista de Spotify.")],
      });
    }

    const recommendations = await getRecommendations([spotifyId]).catch(() => []);

    if (!recommendations.length) {
      return interaction.editReply({ embeds: [errorEmbed("No se pudieron obtener recomendaciones en este momento.")] });
    }

    const list = recommendations
      .slice(0, 8)
      .map((t, i) => `\`${i + 1}.\` **${t.title}** — ${t.artist}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setAuthor({ name: "🎵 Recomendaciones de Spotify" })
      .setDescription(
        `Basado en **${current.info.title}**\n\n${list}\n\n> ¡Usa \`/play <nombre de la canción>\` para añadir cualquiera de estas!`
      )
      .setFooter({ text: "Powered by Spotify Web API" });

    await interaction.editReply({ embeds: [embed] });
  },
};
