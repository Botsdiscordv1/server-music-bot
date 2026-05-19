const { SlashCommandBuilder } = require("discord.js");
const { requireVoiceChannel } = require("../../utils/checks");
const { errorEmbed } = require("../../utils/embeds");
const { getLikedSongs, getMostPlayedTracks } = require("../../database");

function getTrackKey(track) {
  const author = track.info?.author || track.track_author || track.author || "";
  const title = track.info?.title || track.track_title || track.title || "";
  return `${author} - ${title}`.trim();
}

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// All strategies use the full "artist - title" query so Lavalink
// returns complete metadata (feat., explicit, etc.) → lyrics work.
const SEARCH_STRATEGIES = [
  // 0: skip first 2 results
  async (player, seed, skip) => {
    const r = await player.search({ query: `${seed.author} - ${seed.title}`, source: "ytmsearch" }, { id: "dj", username: "DJ" });
    if (!r?.tracks?.length) return null;
    for (let i = Math.min(2, r.tracks.length - 1); i < r.tracks.length; i++) {
      if (!skip(r.tracks[i])) return r.tracks[i];
    }
    return null;
  },
  // 1: skip first 3
  async (player, seed, skip) => {
    const r = await player.search({ query: `${seed.author} - ${seed.title}`, source: "ytmsearch" }, { id: "dj", username: "DJ" });
    if (!r?.tracks?.length) return null;
    for (let i = Math.min(3, r.tracks.length - 1); i < r.tracks.length; i++) {
      if (!skip(r.tracks[i])) return r.tracks[i];
    }
    return null;
  },
  // 2: random non-first
  async (player, seed, skip) => {
    const r = await player.search({ query: `${seed.author} - ${seed.title}`, source: "ytmsearch" }, { id: "dj", username: "DJ" });
    if (!r?.tracks?.length) return null;
    const indices = [...Array(r.tracks.length).keys()].slice(1);
    shuffle(indices);
    for (const i of indices) { if (!skip(r.tracks[i])) return r.tracks[i]; }
    return null;
  },
  // 3: last result
  async (player, seed, skip) => {
    const r = await player.search({ query: `${seed.author} - ${seed.title}`, source: "ytmsearch" }, { id: "dj", username: "DJ" });
    if (!r?.tracks?.length) return null;
    for (let i = r.tracks.length - 1; i >= 0; i--) {
      if (!skip(r.tracks[i])) return r.tracks[i];
    }
    return null;
  },
  // 4: first result (fallback)
  async (player, seed, skip) => {
    const r = await player.search({ query: `${seed.author} - ${seed.title}`, source: "ytmsearch" }, { id: "dj", username: "DJ" });
    return r?.tracks?.[0] || null;
  },
];

async function loadSeedsFromDB(player) {
  const userId = player.requesterId;
  const [liked, top] = await Promise.all([
    getLikedSongs(userId),
    getMostPlayedTracks(userId, 10),
  ]);
  const neg = new Set(player._djNegativeSeeds || []);
  if (!player._djLikedUrls) player._djLikedUrls = new Set();
  const seedMap = new Map();
  for (const s of liked) {
    const key = `${s.track_author} - ${s.track_title}`.trim();
    if (!neg.has(key)) seedMap.set(key, { key, title: s.track_title, author: s.track_author });
    if (s.track_url) player._djLikedUrls.add(s.track_url);
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
  const used = new Set(player._djUsedSeeds || []);
  const neg = new Set(player._djNegativeSeeds || []);

  // Collect available seeds (positive → completed)
  let pool = (player._djPositiveSeeds || []).filter(s => !neg.has(s.key) && !used.has(s.key));
  if (pool.length < count) {
    const completed = (player._djCompletedTracks || []).filter(s => !neg.has(s.key));
    for (const s of completed) {
      if (!neg.has(s.key) && !pool.find(p => p.key === s.key)) pool.push(s);
    }
  }
  // Reset used and retry with all positive seeds
  if (pool.length < count) {
    player._djUsedSeeds = [];
    pool = (player._djPositiveSeeds || []).filter(s => !neg.has(s.key));
  }
  // Pull from DB
  if (pool.length < count) {
    const dbSeeds = await loadSeedsFromDB(player);
    pool = dbSeeds.filter(s => !neg.has(s.key));
  }

  if (pool.length === 0) return [];

  pool = shuffle(pool);

  const VARIANT_WORDS = [
    "acoustic", "live", "remix", "cover", "instrumental", "sped up", "slowed down",
    "reverb", "extended", "radio edit", "club mix", "dub mix", "original mix",
    "orchestral", "piano", "strings", "demo", "edit", "reprise", "rework",
    "reimagined", "stripped", "session", "performance", "karaoke", "nightcore",
    "daycore", "super slowed", "8d", "lyric video", "lyrics", "official video",
    "official audio", "official lyric", "visualizer", "remastered", "spedup",
    "sloweddown", "a cappella", "acapella",
  ];
  const isVariant = (title) => {
    const lower = title.toLowerCase();
    return VARIANT_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(lower));
  };

  const playedIds = player._djPlayedIds || new Set();
  const playedTitles = player._djPlayedTitles || new Set();
  const skip = (t) =>
    playedIds.has(t.info?.identifier) ||
    playedTitles.has(t.info?.title?.toLowerCase()) ||
    isVariant(t.info?.title || "");

  const batch = [];
  const MAX_ATTEMPTS = pool.length * 2;
  let attempts = 0;

  for (let i = 0; i < pool.length && batch.length < count && attempts < MAX_ATTEMPTS; i++) {
    attempts++;
    const seed = pool[i];
    const strategy = SEARCH_STRATEGIES[i % SEARCH_STRATEGIES.length];
    try {
      const track = await strategy(player, seed, skip);
      if (track && !skip(track)) {
        batch.push(track);
        playedIds.add(track.info?.identifier);
        playedTitles.add(track.info?.title?.toLowerCase());
      }
    } catch {}
    // Mark seed as used regardless of result
    const usedArr = player._djUsedSeeds || [];
    if (!usedArr.includes(seed.key)) usedArr.push(seed.key);
    player._djUsedSeeds = usedArr.slice(-50);
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

  await loadSeedsFromDB(player);
  await refillQueue(player);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dj")
    .setDescription("Modo DJ — radio infinita con recomendaciones que aprenden de tus gustos."),

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

      // Toggle off if DJ mode is already active
      if (player._djMode) {
        player._djMode = false;
        const djIds = player._djAddedIds || new Set();
        const kept = player.queue.tracks.filter(t => !djIds.has(t.info?.identifier));
        if (typeof player.queue.splice === "function") {
          await player.queue.splice(0, player.queue.tracks.length);
        }
        if (kept.length > 0) player.queue.add(kept);
        return interaction.editReply({ embeds: [new (require("discord.js").EmbedBuilder)()
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

        const embed = new (require("discord.js").EmbedBuilder)()
          .setColor(0x1db954)
          .setAuthor({ name: "🎧 Modo DJ Programado" })
          .setDescription(
            `El bot entrará en Modo DJ al terminar la canción actual: **${player.queue.current.info.title}**.\n` +
            `Seed tracks: ${player._djPositiveSeeds.length} canciones · ` +
            `Cola: ${player.queue.tracks.length} tracks`
          )
          .setFooter({ text: "Powered by YouTube Music" });

        return interaction.editReply({ embeds: [embed] });
      } else {
        if (typeof player.stopPlaying === "function") await player.stopPlaying();

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
          .setFooter({ text: "Powered by YouTube Music" });

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (e) {
      console.error("[DJ] Error:", e);
      try { await interaction.editReply({ embeds: [errorEmbed(`Error: ${e.message}`)] }); } catch {}
    }
  },
};

// ── Exports for trackEnd and interactionCreate to use ───────────────
module.exports.refillQueue = refillQueue;
module.exports.getTrackKey = getTrackKey;
