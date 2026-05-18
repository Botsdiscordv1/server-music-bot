const { SlashCommandBuilder } = require("discord.js");
const { requireVoiceChannel } = require("../../utils/checks");
const { addedToQueueEmbed, nowPlayingEmbed, errorEmbed } = require("../../utils/embeds");
const { getTrackOembed } = require("../../services/spotify");

function truncateValue(text, max = 100) {
  return text.length > max ? text.substring(0, max - 3) + "..." : text;
}

const processedAutocomplete = new Set();
setInterval(() => processedAutocomplete.clear(), 60_000);

const autocompleteArtworkCache = new Map();
setInterval(() => autocompleteArtworkCache.clear(), 3600_000);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Reproduce una canción.")
    .addStringOption((o) =>
      o.setName("query")
        .setDescription("Nombre de la canción, URL de Spotify o YouTube.")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async execute(interaction, client) {
    await interaction.deferReply();

    const voiceChannel = await requireVoiceChannel(interaction);
    if (!voiceChannel) return;

    const query = interaction.options.getString("query");

    // ── Resolve query ───────────────────────────────────────────────────
    let searchQuery = query;
    let source = "ytmsearch";

    const isSpotify = query.includes("spotify.com") || query.startsWith("spotify:");
    const isYouTubeUrl = query.includes("youtube.com") || query.includes("youtu.be") || query.includes("music.youtube.com") || query.includes("https://");
    
    if (query.startsWith("ytm:")) {
      searchQuery = `https://music.youtube.com/watch?v=${query.slice(4)}`;
      source = "ytmsearch";
    } else if (query.startsWith("yts:")) {
      searchQuery = `https://www.youtube.com/watch?v=${query.slice(4)}`;
      source = "ytsearch";
    } else if (isSpotify) {
      if (query.includes("/playlist/") || query.includes(":playlist:") || query.includes("/album/")) {
        return interaction.editReply({
          embeds: [errorEmbed("Las listas de reproducción y los álbumes de Spotify requieren acceso a la API de Spotify Premium. En su lugar, utilice la URL de la canción o busque por nombre.")]
        });
      }
      try {
        const info = await getTrackOembed(query);
        searchQuery = info.artist ? `${info.artist} - ${info.title}` : info.title;
      } catch (err) {
        console.error("[Play] oembed error:", err.message);
        return interaction.editReply({
          embeds: [errorEmbed("No se pudo encontrar la pista de Spotify. Intente buscar por nombre.")]
        });
      }
    } else if (isYouTubeUrl) {
      const videoIdMatch = query.match(/(?:v=|youtu\.be\/|watch\?v=)([a-zA-Z0-9_-]{11})/);
      if (videoIdMatch) {
        searchQuery = query.includes("music.youtube.com") ? `https://music.youtube.com/watch?v=${videoIdMatch[1]}` : `https://www.youtube.com/watch?v=${videoIdMatch[1]}`;
      }
      source = "ytmsearch";
    } else {
      source = "ytmsearch";
    }

    // ── Get or create player ────────────────────────────────────────────
    const player = client.lavalink.getPlayer(interaction.guildId) ||
      await client.lavalink.createPlayer({
        guildId: interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        volume: 100,
      });

    if (!player.connected) await player.connect();

    let result = await player.search(
      { query: searchQuery, source },
      interaction.user
    );

    if (!isYouTubeUrl && !isSpotify && (!result?.tracks?.length || result.loadType === "empty")) {
      const ytResult = await player.search(
        { query: searchQuery, source: "ytsearch" },
        interaction.user
      );

      if (ytResult?.tracks?.length > 0) {
        result = ytResult;
      }
    }

    if (!result || result.loadType === "error" || result.loadType === "empty") {
      return interaction.editReply({ embeds: [errorEmbed("No se encontraron resultados para esa consulta.")] });
    }

    if (result.loadType === "playlist") {
      if (player._shuffleEnabled) {
        for (const t of result.tracks) {
          const pos = Math.floor(Math.random() * (player.queue.tracks.length + 1));
          await player.queue.add(t, pos);
          if (!player._naturalQueue) player._naturalQueue = [];
          player._naturalQueue.push(t);
        }
      } else {
        result.tracks.forEach((t) => player.queue.add(t));
      }

      if (!player.playing) {
        await player.play({ paused: false });
        player._trackStartTime = Date.now();
      }

      if (result.tracks[0]?.info?.identifier) {
        const cached = autocompleteArtworkCache.get(result.tracks[0].info.identifier);
        if (cached) result.tracks[0].info.artworkUrl = cached;
      }
      return interaction.editReply({
        embeds: [
          addedToQueueEmbed(result.tracks[0], player.queue.tracks.length).setDescription(
            `Added **${result.tracks.length} tracks** from playlist **${result.playlist?.name}**`
          ),
        ],
      });
    }

    const track = result.tracks[0];
    if (track?.info?.identifier) {
      const cached = autocompleteArtworkCache.get(track.info.identifier);
      if (cached) track.info.artworkUrl = cached;
    }
    if (isSpotify) track._originalSource = "spotify";

    if (player._shuffleEnabled) {
      const pos = Math.floor(Math.random() * (player.queue.tracks.length + 1));
      await player.queue.add(track, pos);
      if (!player._naturalQueue) player._naturalQueue = [];
      player._naturalQueue.push(track);
    } else {
      player.queue.add(track);
    }

    if (!player.playing && !player.paused) {
      try {
        await player.play({ paused: false });
        player._trackStartTime = Date.now();
      } catch (err) {
        console.error(`[Play] player.play() ERROR:`, err);
      }
      await interaction.deleteReply().catch(() => { });
      return;
    } else {
      return interaction.editReply({
        embeds: [addedToQueueEmbed(track, player.queue.tracks.length)],
      });
    }
  },

  async autocomplete(interaction, client) {
    if (processedAutocomplete.has(interaction.id)) return;
    processedAutocomplete.add(interaction.id);

    const query = interaction.options.getFocused();
    if (!query) {
      return interaction.respond([]).catch(() => { });
    }

    try {
      const nodes = typeof client.lavalink.nodeManager.leastUsedNodes === 'function'
        ? client.lavalink.nodeManager.leastUsedNodes()
        : [];
      const node = nodes[0] || client.lavalink.nodeManager.nodes.values().next().value;

      if (!node) {
        return interaction.respond([]).catch(() => { });
      }

      const [result, ytResult] = await Promise.allSettled([
        node.search({ query, source: "ytmsearch" }, interaction.user),
        node.search({ query, source: "ytsearch" }, interaction.user),
      ]);

      const allTracks = [];

      if (result.status === "fulfilled" && result.value?.loadType !== "error" && result.value?.loadType !== "empty" && result.value?.tracks?.length) {
        for (const track of result.value.tracks) {
          allTracks.push({ track, source: "ytm" });
          if (track.info?.identifier && track.info?.artworkUrl) {
            autocompleteArtworkCache.set(track.info.identifier, track.info.artworkUrl);
          }
        }
      }

      if (ytResult.status === "fulfilled" && ytResult.value?.loadType !== "error" && ytResult.value?.loadType !== "empty" && ytResult.value?.tracks?.length) {
        const existingIds = new Set(allTracks.filter(e => e.track.info.identifier).map(e => e.track.info.identifier));
        for (const track of ytResult.value.tracks) {
          if (!track.info.identifier || !existingIds.has(track.info.identifier)) {
            allTracks.push({ track, source: "yts" });
            if (track.info?.artworkUrl) {
              autocompleteArtworkCache.set(track.info.identifier, track.info.artworkUrl);
            }
          }
        }
      }

      if (!allTracks.length) {
        return interaction.respond([]).catch(() => { });
      }

      const choices = [];
      const vid = (entry) => entry.track.info.identifier ? `${entry.source}:${entry.track.info.identifier}` : entry.track.info.uri;

      for (const entry of allTracks.slice(0, 25)) {
        const t = entry.track;
        const displayTitle = t.info.title.length > 50 ? t.info.title.substring(0, 47) + "..." : t.info.title;
        const displayAuthor = t.info.author.length > 20 ? t.info.author.substring(0, 17) + "..." : t.info.author;
        const duration = t.info.isStream ? "Live" : `${Math.floor(t.info.duration / 60000)}:${Math.floor((t.info.duration % 60000) / 1000).toString().padStart(2, '0')}`;

        choices.push({
          name: `🎵 ${displayTitle} - ${displayAuthor} - ${duration}`,
          value: vid(entry),
        });
      }

      await interaction.respond(choices.slice(0, 25));
    } catch (err) {
      const msg = err?.message || err?.toString() || "";
      if (!msg.includes("Unknown") && !msg.includes("interaction") && !msg.includes("expired") && !msg.includes("acknowledged")) {
        console.error("[Autocomplete Error]:", err.message);
      }
      if (!interaction.responded) {
        await interaction.respond([]).catch(() => { });
      }
    }
  },
};


