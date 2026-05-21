const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { errorEmbed } = require("../../utils/embeds");
const { getLikedSongs, getDislikedKeys } = require("../../database");
const { generateArtistSet } = require("../../services/djEngine");
const { queueTTS } = require("../../utils/ttsService");

const ARTIST_EPITHETS = {
  "michael jackson": "el Rey del Pop",
  "queen": "la reina del rock",
  "bob marley": "el rey del reggae",
  "elvis presley": "el Rey del Rock and Roll",
  "madonna": "la Reina del Pop",
  "beyoncé": "la Reina",
  "tupac": "leyenda del rap",
  "the beatles": "los fabulosos cuatro de Liverpool",
  "david bowie": "el camaleón del rock",
  "freddie mercury": "la voz más grande del rock",
  "shakira": "la reina del pop latino",
  "juan gabriel": "el Divo de Juárez",
  "héctor lavoe": "el Cantante de los Cantantes",
  "celia cruz": "la Reina de la Salsa",
  "rubén blades": "el poeta de la salsa",
  "marc anthony": "el rey de la salsa",
  "daddy yankee": "el Big Boss del reggaetón",
  "don omar": "el Rey del Reggaetón",
  "wisin & yandel": "los reyes del reggaetón",
  "ivy queen": "la Reina del Reggaetón",
  "nicki minaj": "la Reina del Rap",
  "eminem": "el mejor rapero de todos los tiempos",
  "dr. dre": "el productor legendario del rap",
  "snoop dogg": "el perro del rap callejero",
  "jay-z": "el magnate del hip hop",
  "kanye west": "el genio controvertido del hip hop",
  "lil wayne": "el mejor rapero vivo",
  "drake": "el rostro del hip hop moderno",
  "j balvin": "el embajador del reggaetón",
  "maluma": "el pretty boy del reggaetón",
  "rosalía": "la revolución del flamenco pop",
  "bad bunny": "el Conejo Malo, número uno del mundo",
  "j. cole": "la conciencia del hip hop",
  "bruno mars": "el showman por excelencia",
  "prince": "el genio de Minneapolis",
  "stevie wonder": "el genio de la música soul",
  "aretha franklin": "la Reina del Soul",
  "whitney houston": "la voz más poderosa del pop",
  "amy winehouse": "el alma del soul moderno",
  "nirvana": "los reyes del grunge",
  "pink floyd": "los arquitectos del rock psicodélico",
  "led zeppelin": "los dioses del rock clásico",
  "ac/dc": "los dueños del rock and roll",
  "metallica": "los titanes del metal",
  "radiohead": "los innovadores del rock alternativo",
};

// Local TTS logic replaced by central ttsService.js

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

    let author = track.info?.author || track.track_author || track.author || "";
    author = author.replace(/\s*-\s*Topic$/i, "").trim();
    const title = track.info?.title || track.track_title || track.title || "";
    const trackKey = `${author} - ${title}`.trim();

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
      `🎙️ Especial **${artistName}** en tu reproductor. **${firstArtist}** suena primero.`,
      `🎙️ **${artistName}** suena diferente hoy. **${firstArtist}** nos introduce al viaje.`,
      `🎙️ Si te gusta **${artistName}**, esto te va a encantar. Arranca **${firstArtist}**.`,
      `🎙️ De los favoritos de **${artistName}**, **${firstArtist}** abre la sesión.`,
      `🎙️ **${artistName}** sin filtro. Primer track: **${firstArtist}**.`,
    ];
    const epithet = ARTIST_EPITHETS[artistName.toLowerCase()];
    if (epithet) {
      descTemplates.push(
        `🎙️ Set dedicado a ${epithet}. Arrancando con **${firstArtist}**…`,
        `🎙️ Momento de ${epithet}. Disfruta del set.`,
      );
    }
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
    let deferred = false;
    try {
      await interaction.deferReply();
      deferred = true;
    } catch (e) {
      console.error("[DJ Artist] deferReply failed:", e.message);
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
        return reply(new EmbedBuilder()
          .setColor(0xff6b6b)
          .setDescription(
            kept.length > 0
              ? `⏹️ Modo Artista **${artistName}** desactivado. ${kept.length} canciones manuales conservadas.`
              : `⏹️ Modo Artista **${artistName}** desactivado.`
          )
        );
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

        return reply(embed);
      } else {
        if (typeof player.stopPlaying === "function") await player.stopPlaying();

        await initArtistDJ(player, interaction.user.id, artistName, client);

        if (player.queue.tracks.length === 0) {
          return reply(errorEmbed(`No se encontraron canciones de **${artistName}** en Tus Me Gusta.`));
        }

        await player.play({ paused: false });
        player._trackStartTime = Date.now();

        const embed = new EmbedBuilder()
          .setColor(0x1db954)
          .setAuthor({ name: `🎧 Modo Artista: ${artistName}` })
          .setDescription(`Sets de 10 canciones enfocados en **${artistName}**.\n5 likeadas + 5 recomendadas`)
          .setFooter({ text: "Powered by Spotify & YouTube Music" });

        await reply(embed);
      }
    } catch (e) {
      console.error("[DJ Artist] Error:", e);
      try { reply(errorEmbed(`Error: ${e.message}`)); } catch {}
    }
  },
};

module.exports.refillArtistQueue = refillArtistQueue;
