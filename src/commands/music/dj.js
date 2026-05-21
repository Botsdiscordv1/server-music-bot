const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { errorEmbed } = require("../../utils/embeds");
const { getLikedSongs, getMostPlayedTracks, getDislikedKeys } = require("../../database");
const { isExcluded, isVariant } = require("../../utils/trackFilter");
const { generateSet } = require("../../services/djEngine");
const { queueTTS } = require("../../utils/ttsService");

function getTrackKey(track) {
  let author = track.info?.author || track.track_author || track.author || "";
  author = author.replace(/\s*-\s*Topic$/i, "").trim();
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
  if (!userId) return { batch: [], profile: null };

  const likedSongs = await getLikedSongs(userId);
  if (!likedSongs.length) return { batch: [], profile: null };

  // Filter out disliked songs
  const dislikedKeys = await getDislikedKeys(userId);
  const filtered = likedSongs.filter(s => {
    const key = `${s.track_author} - ${s.track_title}`.trim();
    return !dislikedKeys.has(key);
  });
  if (!filtered.length) return { batch: [], profile: null };

  const result = await generateSet(player, filtered);

  if (!result.tracks.length) return { batch: [], profile: null };

  const batch = [];
  const usedTitleKeys = new Set();

  for (const track of result.tracks) {
    if (batch.length >= count) break;
    if (isPlayed(track)) continue;
    if (shouldDiscard(track.info?.title || "")) continue;

    const trackKey = getTrackKey(track);
    if (dislikedKeys.has(trackKey.toLowerCase()) || dislikedKeys.has(trackKey)) continue;

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
  return { batch, profile: result.profile };
}

// Local TTS logic replaced by central ttsService.js

function generateSetDescription(profile, batch) {
  const genres = profile?.dominantGenres || [];
  const firstTrack = batch[0];
  const firstArtist = firstTrack?.info?.author || "";
  const secondArtist = batch[1]?.info?.author || "";

  const bpmDesc = profile?.avgBpm
    ? (profile.avgBpm > 120 ? "ritmo rápido" : profile.avgBpm > 90 ? "ritmo medio" : "ritmo lento")
    : "";

  const energyDesc = profile?.avgEnergy != null
    ? (profile.avgEnergy > 0.7 ? "alta energía" : profile.avgEnergy > 0.4 ? "energía media" : "ambiente relajado")
    : "";

  const mood = profile?.avgEnergy != null
    ? (profile.avgEnergy > 0.7 ? "🔥" : profile.avgEnergy > 0.4 ? "🎵" : "🌙")
    : "🎵";

  const templates = [];

  if (genres.length) {
    templates.push(
      `${mood} Mezcla de ${genres.slice(0, 3).join(" y ")}, con ${bpmDesc || "buen ritmo"}. Arrancando con **${firstArtist}**…`,
      `${mood} La sesión de hoy trae ${genres.slice(0, 2).join(" y ") || "buena música"}, ${energyDesc}. **${firstArtist}** abre el set.`,
      `${mood} De vuelta con ${genres[0] || "música"}, ${bpmDesc}. Empezamos con **${firstArtist}**…`,
      `${mood} ${genres.slice(0, 2).join(" y ")} del bueno. **${firstArtist}** nos prende desde el vamos.`,
      `${mood} Taca taca taca — puro ${genres[0] || "sabor"} para tus oídos. Cortesía de **${firstArtist}**.`,
    );
  }

  templates.push(
    `${mood} Set listo para ti. **${firstArtist}** nos pone en ambiente…`,
    `${mood} Nueva tanda de canciones, arrancando con **${firstArtist}**.`,
    `${mood} Suena **${firstArtist}** para empezar con todo este set.`,
    `${mood} ¿Listo? **${firstArtist}** abre la sesión de hoy.`,
    `${mood} Dale play y déjate llevar. **${firstArtist}** empieza el viaje.`,
    `${mood} Sube el volumen que arranca **${firstArtist}**.`,
  );

  if (secondArtist && secondArtist !== firstArtist) {
    templates.push(
      `${mood} De **${firstArtist}** a **${secondArtist}**, esto se pone bueno.`,
      `${mood} **${firstArtist}** abre, **${secondArtist}** continúa. Buen set en camino.`,
    );
  }

  return templates[Math.floor(Math.random() * templates.length)];
}

async function refillQueue(player, client) {
  if (player._djRefilling) return;
  player._djRefilling = true;
  try {
    const { batch, profile } = await generateBatch(player, 10);
    if (batch.length === 0) {
      if (player.queue.tracks.length === 0) player._djMode = false;
      return;
    }
    const addedIds = player._djAddedIds || new Set();
    for (const t of batch) {
      if (t.info?.identifier) addedIds.add(t.info.identifier);
    }
    player._djAddedIds = addedIds;

    // Queue TTS intro then the batch
    const setNum = player._djSetNumber || 1;
    const description = generateSetDescription(profile, batch);
    const ttsTrack = await queueTTS(player, description);
    if (ttsTrack) {
      player.queue.add(ttsTrack);
    }
    player.queue.add(batch);

    // Show set list embed with DJ description
    const lines = batch.map((t, i) => {
      const title = t.info?.title || "Unknown";
      const author = t.info?.author || "Unknown";
      return `\`${i + 1}.\` **${title}** — ${author}`;
    });
    const setEmbed = new EmbedBuilder()
      .setColor(0x1db954)
      .setAuthor({ name: `🎧 Set #${setNum}` })
      .setDescription(`${description}\n\n${lines.join("\n")}`)
      .setFooter({ text: `${player._djTracksInSet || 0}/${player._djSetSize || 10} · +${batch.length} canciones` });

    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) {
      await channel.send({ embeds: [setEmbed] }).catch(() => {});
    }

    // If queue was empty, resume playback
    if (!player.playing && !player.paused && batch.length > 0) {
      await player.play({ paused: false }).catch(() => {});
      player._trackStartTime = Date.now();
    }
  } catch (err) {
    console.error("[DJ] refillQueue error:", err);
    if (player.queue.tracks.length === 0) player._djMode = false;
  } finally {
    player._djRefilling = false;
  }
}

async function initDJ(player, userId, client) {
  player._djMode = true;
  player._djArtistMode = false;
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
  player._djSetNumber = 1;
  player._djTracksInSet = 0;
  player._djSetSize = 10;

  await loadSeedsFromDB(player);
  await refillQueue(player, client);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dj")
    .setDescription("Modo DJ — sets inteligentes de 10 canciones basados en tus gustos."),

  async execute(interaction, client) {
    let deferred = false;
    try {
      await interaction.deferReply();
      deferred = true;
    } catch (e) {
      console.error("[DJ] deferReply failed:", e.message);
    }

    const reply = (embed) => {
      if (deferred) return interaction.editReply({ embeds: [embed] }).catch(() => {});
      return interaction.channel?.send({ embeds: [embed] }).catch(() => {});
    };

    try {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        return reply(errorEmbed("Debes estar en un canal de voz."));
      }

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
        player._djArtistMode = false;
        const djIds = player._djAddedIds || new Set();
        const kept = player.queue.tracks.filter(t => !djIds.has(t.info?.identifier));
        if (typeof player.queue.splice === "function") {
          await player.queue.splice(0, player.queue.tracks.length);
        }
        if (kept.length > 0) player.queue.add(kept);
        return reply(new EmbedBuilder()
          .setColor(0xff6b6b)
          .setDescription(
            kept.length > 0
              ? `⏹️ Modo DJ desactivado. ${kept.length} canciones manuales conservadas.`
              : "⏹️ Modo DJ desactivado."
          )
        );
      }

      const isPlaying = player.playing && player.queue.current;

      if (typeof player.queue.splice === "function") {
        await player.queue.splice(0, player.queue.tracks.length);
      } else if (typeof player.queue.clear === "function") {
        player.queue.clear();
      }

      if (isPlaying) {
        await initDJ(player, interaction.user.id, client);

        const embed = new EmbedBuilder()
          .setColor(0x1db954)
          .setAuthor({ name: "🎧 Modo DJ Programado" })
          .setDescription(
            `El bot entrará en Modo DJ al terminar la canción actual: **${player.queue.current.info.title}**.\n` +
            `Canciones disponibles: ${player._djLikedSongs.length} · ` +
            `Cola: ${player.queue.tracks.length} tracks`
          )
          .setFooter({ text: "Powered by Spotify & YouTube Music" });

        return reply(embed);
      } else {
        if (typeof player.stopPlaying === "function") await player.stopPlaying();

        await initDJ(player, interaction.user.id, client);

        if (player.queue.tracks.length === 0) {
          return reply(errorEmbed("No se pudieron generar recomendaciones. Agrega canciones a ❤️ Tus Me Gusta primero."));
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

        await reply(embed);
      }
    } catch (e) {
      console.error("[DJ] Error:", e);
      try { reply(errorEmbed(`Error: ${e.message}`)); } catch {}
    }
  },
};

module.exports.refillQueue = refillQueue;
module.exports.getTrackKey = getTrackKey;
