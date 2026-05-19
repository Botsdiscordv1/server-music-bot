const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { requireVoiceChannel } = require("../../utils/checks");
const { errorEmbed } = require("../../utils/embeds");
const { getLikedSongs, getLikedArtists, getUserStats } = require("../../database");
const { getRecommendations, searchTracks } = require("../../services/spotify");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dj")
    .setDescription("Modo DJ — reproduce recomendaciones basadas en tus gustos."),

  async execute(interaction, client) {
    await interaction.deferReply();

    const voiceChannel = await requireVoiceChannel(interaction);
    if (!voiceChannel) return;

    const player = client.lavalink.getPlayer(interaction.guildId) ||
      await client.lavalink.createPlayer({
        guildId: interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        volume: 100,
      });

    if (!player.connected) await player.connect();

    await interaction.editReply({ embeds: [{ color: 0x1db954, description: "🎧 Generando recomendaciones para ti..." }] });

    const liked = await getLikedSongs(interaction.user.id);
    const stats = await getUserStats(interaction.user.id);
    let seedArtists = [];

    const topArtists = await getLikedArtists(interaction.user.id);
    if (topArtists.length > 0) {
      try {
        const searchRes = await searchTracks(topArtists[0].artist, 1);
        if (searchRes[0]?.artistId) seedArtists.push(searchRes[0].artistId);
      } catch {}
    }

    let seedTracks = [];
    for (const s of liked.slice(0, 3)) {
      let match = s.track_url?.match(/track\/([A-Za-z0-9]+)/) || s.track_url?.match(/spotify:track:([A-Za-z0-9]+)/);
      if (match) {
        seedTracks.push(match[1]);
      } else if (s.track_author && s.track_title) {
        try {
          const searchRes = await searchTracks(`${s.track_author} - ${s.track_title}`, 1);
          if (searchRes[0]?.id) seedTracks.push(searchRes[0].id);
        } catch {}
      }
    }

    if (seedTracks.length === 0 && stats?.favorite_artist) {
      try {
        const searchRes = await searchTracks(stats.favorite_artist, 1);
        if (searchRes[0]?.artistId) seedArtists.push(searchRes[0].artistId);
      } catch {}
    }

    let recommendations = [];
    if (seedTracks.length > 0 || seedArtists.length > 0) {
      const params = {};
      if (seedTracks.length > 0) params.seed_tracks = seedTracks.slice(0, 5);
      if (seedArtists.length > 0) params.seed_artists = seedArtists.slice(0, 2);
      recommendations = await getRecommendations(seedTracks.slice(0, 5)).catch(() => []);
    }

    if (recommendations.length === 0 && stats?.favorite_artist) {
      try {
        const searchRes = await searchTracks(stats.favorite_artist, 5);
        for (const t of searchRes) {
          const result = await player.search({ query: `${t.artist} - ${t.title}`, source: "ytmsearch" }, interaction.user);
          if (result?.tracks?.[0]) {
            player.queue.add(result.tracks[0]);
          }
        }
      } catch {}
    }

    for (const rec of recommendations.slice(0, 10)) {
      const result = await player.search({ query: `${rec.artist} - ${rec.title}`, source: "ytmsearch" }, interaction.user);
      if (result?.tracks?.[0]) {
        player.queue.add(result.tracks[0]);
      }
    }

    if (!player.queue.tracks.length) {
      return interaction.editReply({ embeds: [errorEmbed("No se pudieron generar recomendaciones. Agrega canciones a ❤️ Tus Me Gusta primero.")] });
    }

    if (!player.playing && !player.paused) {
      await player.play({ paused: false });
      player._trackStartTime = Date.now();
    }

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setAuthor({ name: "🎧 Modo DJ Activado" })
      .setDescription(`Se agregaron **${player.queue.tracks.length}** canciones recomendadas a la cola.\n\nBasado en tus **${liked.length}** canciones con like y artistas más escuchados.`)
      .setFooter({ text: "Powered by Spotify Web API" });

    await interaction.editReply({ embeds: [embed] });
  },
};
