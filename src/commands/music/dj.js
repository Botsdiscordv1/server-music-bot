const { SlashCommandBuilder } = require("discord.js");
const { requireVoiceChannel } = require("../../utils/checks");
const { errorEmbed } = require("../../utils/embeds");
const { getLikedSongs, getUserStats } = require("../../database");
const { getRecommendations, searchTracks } = require("../../services/spotify");

async function getSpotifyId(track) {
  const uri = track.info?.uri || track.track_url || track.info?.trackUrl || "";
  const author = track.info?.author || track.track_author || "";
  const title = track.info?.title || track.track_title || "";
  const m = uri.match(/track\/([A-Za-z0-9]+)/) || uri.match(/spotify:track:([A-Za-z0-9]+)/);
  if (m) return m[1];
  if (author && title) {
    const res = await searchTracks(`${author} - ${title}`, 1);
    if (res[0]?.id) return res[0].id;
  }
  return null;
}

async function refillQueue(player, client) {
  if (player._djRefilling) return;
  player._djRefilling = true;

  try {
    const positiveSeeds = player._djPositiveSeeds || [];
    const negativeSeeds = player._djNegativeSeeds || [];

    let seeds = positiveSeeds.slice(0, 5);
    if (seeds.length === 0) {
      const userId = player.requesterId;
      const liked = await getLikedSongs(userId);
      for (const s of liked) {
        const id = await getSpotifyId(s);
        if (id && !negativeSeeds.includes(id) && !seeds.includes(id)) {
          seeds.push(id);
          if (seeds.length >= 5) break;
        }
      }
    }

    if (seeds.length === 0) {
      if (player.queue.tracks.length === 0) player._djMode = false;
      return;
    }

    const recs = await getRecommendations(seeds);

    for (const rec of recs) {
      if (negativeSeeds.includes(rec.id)) continue;
      const result = await player.search({ query: `${rec.artist} - ${rec.title}`, source: "ytmsearch" }, { id: "dj", username: "DJ" });
      if (result?.tracks?.[0]) {
        player.queue.add(result.tracks[0]);
      }
      if (player.queue.tracks.length >= 20) break;
    }

    if (player.queue.tracks.length === 0) player._djMode = false;
  } catch {
    if (player.queue.tracks.length === 0) player._djMode = false;
  } finally {
    player._djRefilling = false;
  }
}

async function initDJ(player, userId) {
  player._djMode = true;
  player.requesterId = userId;
  player._djPositiveSeeds = [];
  player._djNegativeSeeds = [];

  const liked = await getLikedSongs(userId);
  for (const s of liked.slice(0, 5)) {
    const id = await getSpotifyId(s);
    if (id) player._djPositiveSeeds.push(id);
  }

  const stats = await getUserStats(userId);
  if (player._djPositiveSeeds.length === 0 && stats?.favorite_artist) {
    const res = await searchTracks(stats.favorite_artist, 1);
    if (res[0]?.artistId) {
      const artistRecs = await getRecommendations([], [res[0].artistId]);
      for (const r of artistRecs.slice(0, 5)) {
        if (r.id) player._djPositiveSeeds.push(r.id);
      }
    }
  }

  await refillQueue(player);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dj")
    .setDescription("Modo DJ — radio infinita con recomendaciones que aprenden de tus gustos."),

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

    await player.queue.splice(0, player.queue.tracks.length);
    await player.stopPlaying();

    await initDJ(player, interaction.user.id);

    if (player.queue.tracks.length === 0) {
      return interaction.editReply({ embeds: [errorEmbed("No se pudieron generar recomendaciones. Agrega canciones a ❤️ Tus Me Gusta primero.")] });
    }

    await player.play({ paused: false });
    player._trackStartTime = Date.now();

    const embed = new (require("discord.js").EmbedBuilder)()
      .setColor(0x1db954)
      .setAuthor({ name: "🎧 Modo DJ Activado" })
      .setDescription(
        `Radio infinita basada en tus gustos.\n` +
        `Seed tracks: ${player._djPositiveSeeds.length} canciones · ` +
        `Cola: ${player.queue.tracks.length} tracks`
      )
      .setFooter({ text: "Powered by Spotify Web API" });

    await interaction.editReply({ embeds: [embed] });
  },
};

// ── Exports for trackEnd and interactionCreate to use ───────────────
module.exports.refillQueue = refillQueue;
module.exports.getSpotifyId = getSpotifyId;
