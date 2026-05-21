const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { errorEmbed } = require("../../utils/embeds");
const { getLikedSongs, getMostPlayedTracks, getDislikedKeys } = require("../../database");
const { isExcluded, isVariant } = require("../../utils/trackFilter");
const { generateSet } = require("../../services/djEngine");
const { queueTTS } = require("../../utils/ttsService");

const MAX_PLAYED_SET = 1000;

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

function trimPlayedSet(set, max = MAX_PLAYED_SET) {
  if (set.size > max) {
    const toDelete = [...set].slice(0, set.size - max);
    toDelete.forEach(v => set.delete(v));
  }
}

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

  const batch = [];
  const usedTitleKeys = new Set();
  let attempts = 0;
  let lastResult = null;

  while (batch.length < count && attempts < 5) {
    attempts++;
    const result = await generateSet(player, filtered);
    if (!result.tracks.length) break;
    lastResult = result;

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
  }

  if (batch.length === 0 && lastResult?.tracks?.[0]) {
    const fallback = lastResult.tracks[0];
    if (!isPlayed(fallback)) {
      batch.push(fallback);
    }
  }

  trimPlayedSet(playedIds);
  trimPlayedSet(playedTitles);
  player._djPlayedIds = playedIds;
  player._djPlayedTitles = playedTitles;
  return { batch, profile: lastResult?.profile || null };
}

// Local TTS logic replaced by central ttsService.js

function generateSetDescription(profile, batch, player) {
  const genres = profile?.dominantGenres || [];
  const firstTrack = batch[0];
  const firstArtist = firstTrack?.info?.author || "";
  const secondArtist = batch[1]?.info?.author || "";
  const setNum = (player?._djSetNumber || 1);

  const bpmFallbacks = ["buen ritmo", "ritmo variado", "flow constante", "vibra única", "sonido fresco"];
  const bpmDesc = profile?.avgBpm
    ? (profile.avgBpm > 120 ? "ritmo rápido" : profile.avgBpm > 90 ? "ritmo medio" : "ritmo lento")
    : bpmFallbacks[Math.floor(Math.random() * bpmFallbacks.length)];

  const energyDesc = profile?.avgEnergy != null
    ? (profile.avgEnergy > 0.7 ? "alta energía" : profile.avgEnergy > 0.4 ? "energía media" : "ambiente relajado")
    : "";

  const genreFallbacks = ["música variada", "sonidos diversos", "estilos variados", "mezcla única", "ritmos variados", "canciones seleccionadas"];
  const genreStr = genres.length
    ? `${genres.slice(0, 3).join(" y ")}`
    : genreFallbacks[Math.floor(Math.random() * genreFallbacks.length)];

  const emojis = ["🔥", "🎵", "🎶", "✨", "🎧", "⚡", "💿", "📀", "🎤", "🎸", "🎹", "🥁"];
  const mood = emojis[Math.floor(Math.random() * emojis.length)];

  // Track used templates per player to avoid repeats
  if (!player?._djUsedTemplates) player._djUsedTemplates = [];
  const used = new Set(player._djUsedTemplates);
  const pick = (arr) => {
    const pool = arr.filter(t => !used.has(t));
    if (!pool.length) {
      player._djUsedTemplates = [];
      return arr[Math.floor(Math.random() * arr.length)];
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    player._djUsedTemplates.push(picked);
    if (player._djUsedTemplates.length > 10) player._djUsedTemplates.shift();
    return picked;
  };

  const epithet = ARTIST_EPITHETS[firstArtist.toLowerCase()];
  const epithetLine = epithet ? `${epithet}, ` : "";
  const setRef = setNum > 2 ? `Set número ${setNum}. ` : "";
  const energyLine = energyDesc ? `, ${energyDesc}` : "";

  const env = { mood, firstArtist, secondArtist, genreStr, bpmDesc, energyLine, epithetLine, setRef };

  const templates = [
    `💿 Damos inicio al set #${setNum} con **${firstArtist}** trayendo una transición impecable a la cabina.`,
    `${mood} La música fluye en el set #${setNum} con **${firstArtist}** liderando los primeros minutos de la mezcla.`,
    `${mood} El set #${setNum} comienza a tomar forma con **${firstArtist}** definiendo la vibra de esta sesión.`,
    `${mood} Subimos la energía en el set #${setNum} con la apertura a cargo de **${firstArtist}**.`,
    `${mood} **${firstArtist}** toma los controles del set #${setNum} con un ritmo que marca el pulso ideal.`,
    `${mood} Sonidos frescos para arrancar el set #${setNum} con **${firstArtist}** al mando de la mezcla.`,
    `${mood} Despegamos en el set #${setNum} de la mano de **${firstArtist}** y una vibra inigualable.`,
    `${mood} La cabina del set #${setNum} se enciende con la entrada directa de **${firstArtist}**.`,
    `${mood} **${firstArtist}** nos sumerge en el set #${setNum} con una atmósfera perfecta para empezar.`,
    `${mood} Arrancamos la transmisión del set #${setNum} con **${firstArtist}** guiando los beats iniciales.`,
    `${mood} Una verdadera leyenda inaugura el set #${setNum} con **${firstArtist}** liderando la transición inicial.`,
    `${mood} El set #${setNum} recibe un sonido histórico con **${firstArtist}** al frente de esta apertura.`,
    `${mood} La voz que marcó una era abre el set #${setNum} con **${firstArtist}** en la mezcla inicial.`,
    `${mood} El legado musical se siente en el set #${setNum} con **${firstArtist}** abriendo la pista.`,
    `${mood} El set #${setNum} sube su nivel con **${firstArtist}** y un sonido imposible de olvidar.`,
  ];

  if (epithetLine) {
    templates.push(
      `${mood} Set #${setNum}. **${firstArtist}** llega sin anunciarse y el set cobra vida por sí solo.`,
      `${mood} **${firstArtist}** toma la cabina en el set #${setNum} con la autoridad de quien sabe lo que trae.`,
      `${mood} Set #${setNum}. Cuando **${firstArtist}** abre la sesión, todo lo demás queda en segundo plano.`,
      `${mood} **${firstArtist}** al frente del set #${setNum}. Arranca con la seguridad de un clásico viviente.`,
      `${mood} Set #${setNum}. **${firstArtist}** pone el primer track y el resto del set se alinea solo.`,
    );
  }

  // ── Set number ───────────────────────────────────────────────────
  if (setNum > 2) {
    templates.push(
      `${mood} ${setRef}${genreStr}, ${bpmDesc}${energyLine}. Arranca **${firstArtist}**.`,
      `${mood} ${setRef}**${firstArtist}** abre la siguiente ronda con ${genreStr}, ${bpmDesc}${energyLine}.`,
    );
  }

  return pick(templates);
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
    const description = generateSetDescription(profile, batch, player);
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
  player._djUsedTemplates = [];
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
