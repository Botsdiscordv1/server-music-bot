const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { requireVoiceChannel } = require("../../utils/checks");
const { errorEmbed, addedToQueueEmbed } = require("../../utils/embeds");
const spotify = require("../../services/spotify");

const searchResults = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Busca canciones y elige una para reproducir.")
    .addStringOption((o) =>
      o.setName("query").setDescription("Nombre de la canción a buscar").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("source")
        .setDescription("Fuente de búsqueda")
        .addChoices(
          { name: "YouTube Music", value: "ytmsearch" },
          { name: "YouTube", value: "ytsearch" }
        )
        .setRequired(false)
    ),

  async execute(interaction, client) {
    await interaction.deferReply();

    const voiceChannel = await requireVoiceChannel(interaction);
    if (!voiceChannel) return;

    const query = interaction.options.getString("query");
    const source = interaction.options.getString("source") || "ytmsearch";

    let searchQuery = query;
    if (source === "spotify") {
      try {
        const results = await spotify.searchTracks(query, 10);
        if (results.length === 0) {
          return interaction.editReply({ embeds: [errorEmbed("No se encontraron resultados.")] });
        }
        return await showSpotifyResults(interaction, client, voiceChannel, results, query);
      } catch (err) {
        console.error("[Search] Spotify error:", err.message);
        return interaction.editReply({ embeds: [errorEmbed("Fallo la busqueda en Spotify.")] });
      }
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

    const result = await player.search({ query: searchQuery, source }, interaction.user);

    if (!result || result.loadType === "error" || result.loadType === "empty") {
      return interaction.editReply({ embeds: [errorEmbed("No se encontraron resultados.")] });
    }

    const tracks = result.tracks.slice(0, 10);
    if (tracks.length === 0) {
      return interaction.editReply({ embeds: [errorEmbed("No se encontraron canciones.")] });
    }

    const searchId = `${interaction.guildId}-${interaction.user.id}-${Date.now()}`;
    searchResults.set(searchId, { tracks, player, voiceChannel, textChannelId: interaction.channelId });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🔍 Resultados de búsqueda")
      .setDescription(`Se encontraron **${tracks.length}** resultados para "${query}"`)
      .setFooter({ text: "Selecciona una canción para agregar a la cola • 60 segundos" });

    const options = tracks.map((track, index) => ({
      label: `${index + 1}. ${truncate(track.info.title, 80)}`,
      value: `${searchId}:${index}`,
      description: `${truncate(track.info.author, 50)} • ${formatDuration(track.info.duration)}`,
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("search_select")
      .setPlaceholder("Selecciona una canción...")
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.editReply({ embeds: [embed], components: [row] });

    setTimeout(() => {
      searchResults.delete(searchId);
    }, 60000);
  },
};

async function showSpotifyResults(interaction, client, voiceChannel, tracks, query) {
  const player = client.lavalink.getPlayer(interaction.guildId) ||
    await client.lavalink.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: 100,
    });

  if (!player.connected) await player.connect();

  const searchId = `${interaction.guildId}-${interaction.user.id}-${Date.now()}`;
  searchResults.set(searchId, { tracks, player, voiceChannel, textChannelId: interaction.channelId, isSpotify: true });

  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle("🔍 Resultados de Spotify")
    .setDescription(`Se encontraron **${tracks.length}** resultados para "${query}"`)
    .setFooter({ text: "Selecciona una canción para agregar a la cola • 60 segundos" });

  const options = tracks.map((track, index) => ({
    label: `${index + 1}. ${truncate(track.title, 80)}`,
    value: `${searchId}:${index}`,
    description: `${truncate(track.artist, 50)} • ${track.duration ? formatDuration(track.duration * 1000) : "?"}`,
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("search_select")
    .setPlaceholder("Selecciona una canción...")
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.editReply({ embeds: [embed], components: [row] });

  setTimeout(() => {
    searchResults.delete(searchId);
  }, 60000);
}

module.exports.handleSearchSelect = async function (interaction, client) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== "search_select") return;

  const [searchId, indexStr] = interaction.values[0].split(":");
  const index = parseInt(indexStr, 10);

  const data = searchResults.get(searchId);
  if (!data) {
    return interaction.reply({ embeds: [errorEmbed("La busqueda expiró. Por favor busca de nuevo.")], flags: 64 });
  }

  if (interaction.user.id !== searchId.split("-")[1]) {
    return interaction.reply({ embeds: [errorEmbed("No iniciaste esta busqueda.")], flags: 64 });
  }

  const { player, textChannelId, isSpotify } = data;

  const memberChannel = interaction.member?.voice?.channelId;
  if (!memberChannel || memberChannel !== player.voiceChannelId) {
    return interaction.reply({
      embeds: [errorEmbed("Debes estar en el mismo canal de voz que el bot.")],
      flags: 64,
    });
  }

  searchResults.delete(searchId);

  let track;
  if (isSpotify) {
    const spotTrack = data.tracks[index];
    await interaction.deferReply();

    const result = await player.search(
      { query: `ytmsearch:${spotTrack.title} ${spotTrack.artist}`, source: "ytmsearch" },
      interaction.user
    );

    if (!result?.tracks?.length) {
      return interaction.editReply({ embeds: [errorEmbed("No se encontro la cancion en YouTube")] });
    }

    const { filterAndSort } = require("../../utils/trackFilter");
    const sorted = filterAndSort(result.tracks);
    track = sorted.length > 0 ? sorted[0] : result.tracks[0];
    if (track) track._originalSource = "spotify";
  } else {
    track = data.tracks[index];
  }

  if (player._shuffleEnabled) {
    const pos = Math.floor(Math.random() * (player.queue.tracks.length + 1));
    await player.queue.add(track, pos);
    if (!player._naturalQueue) player._naturalQueue = [];
    player._naturalQueue.push(track);
  } else {
    player.queue.add(track);
  }

  if (!player.playing && !player.paused) {
    await player.play({ paused: false });
    player._trackStartTime = Date.now();
    await interaction.deleteReply().catch(() => { });
    return;
  }

  await interaction.update({
    embeds: [
      addedToQueueEmbed(track, player.queue.tracks.length).setDescription(
        `✅ Agregada **${track.info.title}** a la cola`
      ),
    ],
    components: [],
  });
};

function truncate(str, maxLen) {
  if (!str) return "Unknown";
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}