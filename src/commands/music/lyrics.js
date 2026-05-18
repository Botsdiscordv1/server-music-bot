const { SlashCommandBuilder } = require("discord.js");
const { getLyrics, formatLyricsForEmbed } = require("../../services/lrclib");
const { lyricsEmbed, errorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription("Obtén la letra de la canción actual o de una canción específica.")
    .addStringOption((o) =>
      o.setName("song").setDescription("Nombre de la canción (opcional; por defecto es la pista actual)")
    )
    .addStringOption((o) =>
      o.setName("artist").setDescription("Nombre del artista (opcional)")
    ),

  async execute(interaction, client) {
    await interaction.deferReply();

    let trackName = interaction.options.getString("song");
    let artistName = interaction.options.getString("artist") || "";

    // Fall back to current track if no query provided
    if (!trackName) {
      const player = client.lavalink.getPlayer(interaction.guildId);
      const current = player?.queue?.current;
      if (!current) {
        return interaction.editReply({ embeds: [errorEmbed("No hay ninguna canción sonando y no se especificó ninguna.")] });
      }
      trackName = current.info.title;
      artistName = current.info.author;
    }

    const lyrics = await getLyrics(trackName, artistName);

    if (!lyrics.found) {
      return interaction.editReply({
        embeds: [errorEmbed(`No se encontraron letras para **${trackName}**${artistName ? ` por ${artistName}` : ""}.`)],
      });
    }

    const text = formatLyricsForEmbed(lyrics);
    const isSynced = !!lyrics.synced;

    await interaction.editReply({
      embeds: [lyricsEmbed(lyrics.trackName || trackName, lyrics.artistName || artistName, text, isSynced)],
    });
  },
};
