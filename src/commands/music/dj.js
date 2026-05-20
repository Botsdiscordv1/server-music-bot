const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { requireVoiceChannel } = require("../../utils/checks");
const { errorEmbed } = require("../../utils/embeds");
const { getLikedSongs, getMostPlayedTracks } = require("../../database");
const { isExcluded, isVariant } = require("../../utils/trackFilter");
const { generateSet } = require("../../services/djEngine");

function getTrackKey(track) {
  const author = track.info?.author || track.track_author || track.author || "";
  const title = track.info?.title || track.track_title || track.title || "";
  return `${author} - ${title}`.trim();
}

function shouldDiscard(title) {
  return isExcluded(title);
}

async function loadSeedsFromDB(player) {
  const userId = player.requesterId;
  const [liked, top] = await Promise.all([
    getLikedSongs(userId),
    getMostPlayedTracks(userId, 10),
  ]);
  player._djLikedSongs = liked;
  if (!player._djLikedUrls) player._djLikedUrls = new Set();
  for (const s of liked) {
    if (s.track_url) player._djLikedUrls.add(s.track_url);
  }
  const neg = new Set(player._djNegativeSeeds || []);
  const seedMap = new Map();
  for (const s of liked) {
    const key = `${s.track_author} - ${s.track_title}`.trim();
    if (!neg.has(key)) seedMap.set(key, { key, title: s.track_title, author: s.track_author });
  }
  for (const s of top) {
    const key = `${s.track_author} - ${s.track_title}`.trim();
    if (!neg.has(key) && !seedMap.has(key)) seedMap.set(key, { key, title: s.track_title, author: s.track_author });
  }
  const seeds = [...seedMap.values()].slice(0, 20);
  player._djPositiveSeeds.push(...seeds);
  return seeds;
}

async function generateBatch(player, count = 10) {
  const playedIds = player._djPlayedIds || new Set();
  const playedTitles = player._djPlayedTitles || new Set();

  const isPlayed = (t) =>
    playedIds.has(t.info?.identifier) ||
    playedTitles.has(t.info?.title?.toLowerCase());

  const userId = player.requesterId;
  if (!userId) return [];

  const likedSongs = await getLikedSongs(userId);
  if (!likedSongs.length) return [];

  const result = await generateSet(player, likedSongs);

  if (!result.tracks.length) return [];

  const batch = [];
  const usedTitleKeys = new Set();

  for (const track of result.tracks) {
    if (batch.length >= count) break;
    if (isPlayed(track)) continue;
    if (shouldDiscard(track.info?.title || "")) continue;

    const titleKey = (track.info?.title || "").toLowerCase();
    if (usedTitleKeys.has(titleKey)) continue;

    batch.push(track);
    usedTitleKeys.add(titleKey);
    playedIds.add(track.info?.identifier);
    playedTitles.add(track.info?.title?.toLowerCase());
  }

  if (batch.length === 0) {
    const track = result.tracks[0];
    if (track && !isPlayed(track)) {
      batch.push(track);
    }
  }

  player._djPlayedIds = playedIds;
  player._djPlayedTitles = playedTitles;
  return batch;
}

async function refillQueue(player, client) {
  if (player._djRefilling) return;
  player._djRefilling = true;
  try {
    const batch = await generateBatch(player, 10);
    if (batch.length === 0) {
      if (player.queue.tracks.length === 0) player._djMode = false;
      return;
    }
    const addedIds = player._djAddedIds || new Set();
    for (const t of batch) {
      if (t.info?.identifier) addedIds.add(t.info.identifier);
    }
    player._djAddedIds = addedIds;
    player.queue.add(batch);
  } catch (err) {
    console.error("[DJ] refillQueue error:", err);
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
  player._djUsedSeeds = [];
  player._djCompletedTracks = [];
  player._djPlayedIds = new Set();
  player._djPlayedTitles = new Set();
  player._djAddedIds = new Set();
  player._djLikedUrls = new Set();
  player._djLikedSongs = [];

  await loadSeedsFromDB(player);
  await refillQueue(player);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dj")
    .setDescription("Modo DJ — sets inteligentes de 10 canciones basados en tus gustos."),

  async execute(interaction, client) {
    try {
      await interaction.deferReply();
    } catch (e) {
      return console.error("[DJ] deferReply failed:", e.message);
    }

    try {
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

      if (player._djMode) {
        player._djMode = false;
        const djIds = player._djAddedIds || new Set();
        const kept = player.queue.tracks.filter(t => !djIds.has(t.info?.identifier));
        if (typeof player.queue.splice === "function") {
          await player.queue.splice(0, player.queue.tracks.length);
        }
        if (kept.length > 0) player.queue.add(kept);
        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(0xff6b6b)
          .setDescription(
            kept.length > 0
              ? `⏹️ Modo DJ desactivado. ${kept.length} canciones manuales conservadas.`
              : "⏹️ Modo DJ desactivado."
          )
        ]});
      }

      const isPlaying = player.playing && player.queue.current;

      if (typeof player.queue.splice === "function") {
        await player.queue.splice(0, player.queue.tracks.length);
      } else if (typeof player.queue.clear === "function") {
        player.queue.clear();
      }

      if (isPlaying) {
        await initDJ(player, interaction.user.id);

        const embed = new EmbedBuilder()
          .setColor(0x1db954)
          .setAuthor({ name: "🎧 Modo DJ Programado" })
          .setDescription(
            `El bot entrará en Modo DJ al terminar la canción actual: **${player.queue.current.info.title}**.\n` +
            `Canciones disponibles: ${player._djLikedSongs.length} · ` +
            `Cola: ${player.queue.tracks.length} tracks`
          )
          .setFooter({ text: "Powered by Spotify & YouTube Music" });

        return interaction.editReply({ embeds: [embed] });
      } else {
        if (typeof player.stopPlaying === "function") await player.stopPlaying();

        await initDJ(player, interaction.user.id);

        if (player.queue.tracks.length === 0) {
          return interaction.editReply({ embeds: [errorEmbed("No se pudieron generar recomendaciones. Agrega canciones a ❤️ Tus Me Gusta primero.")] });
        }

        await player.play({ paused: false });
        player._trackStartTime = Date.now();

        const embed = new EmbedBuilder()
          .setColor(0x1db954)
          .setAuthor({ name: "🎧 Modo DJ Activado" })
          .setDescription(
            `Sets inteligentes de 10 canciones.\n` +
            `Canciones disponibles: ${player._djLikedSongs.length} · ` +
            `Cola: ${player.queue.tracks.length} tracks`
          )
          .setFooter({ text: "Powered by Spotify & YouTube Music" });

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (e) {
      console.error("[DJ] Error:", e);
      try { await interaction.editReply({ embeds: [errorEmbed(`Error: ${e.message}`)] }); } catch {}
    }
  },
};

module.exports.refillQueue = refillQueue;
module.exports.getTrackKey = getTrackKey;
