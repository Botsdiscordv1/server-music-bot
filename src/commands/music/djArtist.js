const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { requireVoiceChannel } = require("../../utils/checks");
const { errorEmbed } = require("../../utils/embeds");
const { getLikedSongs, getDislikedKeys } = require("../../database");
const { generateArtistSet } = require("../../services/djEngine");

const TTS_PRONUNCIATION = [
  [/\b6ix9ine\b/gi, "six nine"],
  [/\b6ix\b/gi, "six"],
  [/\b9ine\b/gi, "nine"],
  [/\b21 savage\b/gi, "twenty one savage"],
  [/\b24k\s?goldn\b/gi, "twenty four karat golden"],
  [/\b2pac\b/gi, "two pac"],
  [/\b50 cent\b/gi, "fifty cent"],
  [/\b6lack\b/gi, "black"],
  [/\$ap\b/gi, "money ap"],
  [/\bXXXTentacion\b/gi, "triple ex tentacion"],
  [/\bHalsey\b/gi, "halsey"],
  [/\bB[oó]y Hars[hi]ss\b/gi, "boy harshish"],
  [/\bMitski\b/gi, "mitski"],
  [/\bGrimes\b/gi, "grimes"],
  [/\bKacey\s+Musgraves\b/gi, "kacey musgraves"],
  [/\bJoji\b/gi, "joji"],
  [/\bRina\s+Sawayama\b/gi, "rina sawayama"],
  [/\bJPEGMafia\b/gi, "jpeg mafia"],
  [/\bDeath\s+Grips\b/gi, "death grips"],
  [/\bTyler,\s*the\s+Creator\b/gi, "tyler the creator"],
  [/\bChildish\s+Gambino\b/gi, "childish gambino"],
  [/\bMgmt\b/gi, "em gee em tee"],
];

function fixTTS(text) {
  let t = text.replace(/\*\*/g, "").replace(/[🎙️…]/g, "").trim();
  for (const [pattern, replacement] of TTS_PRONUNCIATION) {
    t = t.replace(pattern, replacement);
  }
  return t;
}

function ttsUrl(text) {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es&q=${encodeURIComponent(fixTTS(text).slice(0, 200))}`;
}

async function queueTTS(player, text) {
  try {
    const result = await player.search({ query: ttsUrl(text) }, { username: "DJ", id: "dj" });
    if (result?.tracks?.length) {
      const ttsTrack = result.tracks[0];
      ttsTrack._djIntro = true;
      return ttsTrack;
    }
  } catch {}
  return null;
}

async function generateBatch(player, artistName, count = 10) {
  const playedIds = player._djPlayedIds || new Set();
  const playedTitles = player._djPlayedTitles || new Set();

  const isPlayed = (t) =>
    playedIds.has(t.info?.identifier) ||
    playedTitles.has(t.info?.title?.toLowerCase());

  const userId = player.requesterId;
  if (!userId) return { batch: [], profile: null };

  const likedSongs = await getLikedSongs(userId);
  if (!likedSongs.length) return { batch: [], profile: null };

  const dislikedKeys = await getDislikedKeys(userId);
  const filtered = likedSongs.filter(s => {
    const key = `${s.track_author} - ${s.track_title}`.trim();
    return !dislikedKeys.has(key);
  });
  if (!filtered.length) return { batch: [], profile: null };

  const result = await generateArtistSet(player, filtered, artistName);
  if (!result.tracks.length) return { batch: [], profile: null };

  const batch = [];
  const usedTitleKeys = new Set();

  for (const track of result.tracks) {
    if (batch.length >= count) break;
    if (isPlayed(track)) continue;
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

async function refillArtistQueue(player, client) {
  if (player._djRefilling) return;
  player._djRefilling = true;
  try {
    const artistName = player._djArtistName;
    if (!artistName) {
      player._djArtistMode = false;
      player._djMode = false;
      return;
    }

    const { batch, profile } = await generateBatch(player, artistName, 10);
    if (batch.length === 0) {
      if (player.queue.tracks.length === 0) {
        player._djArtistMode = false;
        player._djMode = false;
        const channel = client?.channels?.cache?.get(player.textChannelId);
        if (channel) {
          channel.send({ embeds: [new EmbedBuilder()
            .setColor(0xff6b6b)
            .setDescription(`⏹️ No hay más canciones de **${artistName}** en Tus Me Gusta. Modo Artista desactivado.`)
          ]}).catch(() => {});
        }
      }
      return;
    }

    const addedIds = player._djAddedIds || new Set();
    for (const t of batch) {
      if (t.info?.identifier) addedIds.add(t.info.identifier);
    }
    player._djAddedIds = addedIds;

    const setNum = player._djSetNumber || 1;
    const firstTrack = batch[0];
    const firstArtist = firstTrack?.info?.author || "";
    const descTemplates = [
      `🎙️ Sumérgete en **${artistName}**. Arrancando con **${firstArtist}**…`,
      `🎙️ Todo **${artistName}** para ti. Empezamos con **${firstArtist}**.`,
      `🎙️ Nueva sesión de **${artistName}**, abriendo con **${firstArtist}**…`,
    ];
    const description = descTemplates[Math.floor(Math.random() * descTemplates.length)];

    // Queue TTS intro then the batch
    const ttsTrack = await queueTTS(player, description);
    if (ttsTrack) {
      player.queue.add(ttsTrack);
    }
    player.queue.add(batch);

    const lines = batch.map((t, i) => {
      const title = t.info?.title || "Unknown";
      const author = t.info?.author || "Unknown";
      return `\`${i + 1}.\` **${title}** — ${author}`;
    });
    const setEmbed = new EmbedBuilder()
      .setColor(0x1db954)
      .setAuthor({ name: `🎧 ${artistName} — Set #${setNum}` })
      .setDescription(`${description}\n\n${lines.join("\n")}`)
      .setFooter({ text: `${player._djTracksInSet || 0}/${player._djSetSize || 10} · +${batch.length} canciones` });

    const channel = client?.channels?.cache?.get(player.textChannelId);
    if (channel) {
      await channel.send({ embeds: [setEmbed] }).catch(() => {});
    }

    if (!player.playing && !player.paused && batch.length > 0) {
      await player.play({ paused: false }).catch(() => {});
      player._trackStartTime = Date.now();
    }
  } catch (err) {
    console.error("[DJ Artist] refillArtistQueue error:", err);
    if (player.queue.tracks.length === 0) {
      player._djArtistMode = false;
      player._djMode = false;
    }
  } finally {
    player._djRefilling = false;
  }
}

async function initArtistDJ(player, userId, artistName, client) {
  player._djMode = true;
  player._djArtistMode = true;
  player._djArtistName = artistName;
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

  await refillArtistQueue(player, client);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dj-artist")
    .setDescription("Modo DJ Artista — sets de 10 canciones enfocados en un artista.")
    .addStringOption((o) =>
      o.setName("artist")
        .setDescription("Nombre del artista")
        .setRequired(true)
    ),

  async execute(interaction, client) {
    try {
      await interaction.deferReply();
    } catch (e) {
      return console.error("[DJ Artist] deferReply failed:", e.message);
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

      // Toggle off
      if (player._djArtistMode) {
        player._djArtistMode = false;
        player._djMode = false;
        const djIds = player._djAddedIds || new Set();
        const kept = player.queue.tracks.filter(t => !djIds.has(t.info?.identifier));
        if (typeof player.queue.splice === "function") {
          await player.queue.splice(0, player.queue.tracks.length);
        }
        if (kept.length > 0) player.queue.add(kept);
        const artistName = player._djArtistName || "";
        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(0xff6b6b)
          .setDescription(
            kept.length > 0
              ? `⏹️ Modo Artista **${artistName}** desactivado. ${kept.length} canciones manuales conservadas.`
              : `⏹️ Modo Artista **${artistName}** desactivado.`
          )
        ]});
      }

      // Toggle off regular DJ mode first if active
      if (player._djMode) {
        player._djMode = false;
        if (typeof player.queue.splice === "function") {
          await player.queue.splice(0, player.queue.tracks.length);
        }
      }

      const artistName = interaction.options.getString("artist", true);
      const isPlaying = player.playing && player.queue.current;

      if (typeof player.queue.splice === "function") {
        await player.queue.splice(0, player.queue.tracks.length);
      } else if (typeof player.queue.clear === "function") {
        player.queue.clear();
      }

      if (isPlaying) {
        await initArtistDJ(player, interaction.user.id, artistName, client);

        const embed = new EmbedBuilder()
          .setColor(0x1db954)
          .setAuthor({ name: `🎧 Modo Artista: ${artistName}` })
          .setDescription(
            `El bot entrará en Modo Artista al terminar la canción actual: **${player.queue.current.info.title}**.\n` +
            `Artista: **${artistName}**`
          )
          .setFooter({ text: "5 likeadas · 5 recomendadas" });

        return interaction.editReply({ embeds: [embed] });
      } else {
        if (typeof player.stopPlaying === "function") await player.stopPlaying();

        await initArtistDJ(player, interaction.user.id, artistName, client);

        if (player.queue.tracks.length === 0) {
          return interaction.editReply({ embeds: [errorEmbed(`No se encontraron canciones de **${artistName}** en Tus Me Gusta.`)] });
        }

        await player.play({ paused: false });
        player._trackStartTime = Date.now();

        const embed = new EmbedBuilder()
          .setColor(0x1db954)
          .setAuthor({ name: `🎧 Modo Artista: ${artistName}` })
          .setDescription(`Sets de 10 canciones enfocados en **${artistName}**.\n5 likeadas + 5 recomendadas`)
          .setFooter({ text: "Powered by Spotify & YouTube Music" });

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (e) {
      console.error("[DJ Artist] Error:", e);
      try { await interaction.editReply({ embeds: [errorEmbed(`Error: ${e.message}`)] }); } catch {}
    }
  },
};

module.exports.refillArtistQueue = refillArtistQueue;
