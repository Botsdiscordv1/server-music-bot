const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { savePlaylist, getPlaylist, getGuildPlaylists, deletePlaylist } = require("../../database");
const { errorEmbed, successEmbed } = require("../../utils/embeds");

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName("playlist-save")
      .setDescription("Guarda la lista actual como una playlist.")
      .addStringOption((o) => o.setName("name").setDescription("Nombre de la playlist").setRequired(true)),
    async execute(interaction, client) {
      const player = client.lavalink.getPlayer(interaction.guildId);
      if (!player || player.queue.tracks.length === 0) {
        return interaction.reply({ embeds: [errorEmbed("La cola está vacía.")] });
      }

      const name = interaction.options.getString("name");
      const tracks = player.queue.tracks.map((t) => ({
        title: t.info.title,
        author: t.info.author,
        uri: t.info.uri,
        duration: t.info.duration,
        artwork: t.info.artworkUrl,
      }));

      await savePlaylist(interaction.guildId, interaction.user.id, name, tracks);
      await interaction.reply({ embeds: [successEmbed(`Saved playlist **${name}** with ${tracks.length} tracks.`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("playlist-load")
      .setDescription("Cargar una playlist guardada")
      .addIntegerOption((o) => o.setName("id").setDescription("ID de la playlist").setRequired(true)),
    async execute(interaction, client) {
      const id = interaction.options.getInteger("id");
      const playlist = await getPlaylist(id, interaction.guildId);

      if (!playlist) {
        return interaction.reply({ embeds: [errorEmbed("No se encontro la playlist.")] });
      }

      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ embeds: [errorEmbed("Debes estar en un canal de voz.")] });
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

      const tracks = JSON.parse(playlist.tracks);
      for (const t of tracks) {
        const result = await player.search({ query: `${t.title} ${t.author}`, source: "ytmsearch" }, interaction.user);
        if (result?.tracks?.[0]) {
          if (player._shuffleEnabled) {
            const pos = Math.floor(Math.random() * (player.queue.tracks.length + 1));
            await player.queue.add(result.tracks[0], pos);
            if (!player._naturalQueue) player._naturalQueue = [];
            player._naturalQueue.push(result.tracks[0]);
          } else {
            player.queue.add(result.tracks[0]);
          }
        }
      }

      if (!player.playing) {
        await player.play({ paused: false });
      }

      interaction.reply({ embeds: [successEmbed(`Loaded **${playlist.name}** (${tracks.length} tracks) to queue.`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("playlist-list")
      .setDescription("Lista de playlists guardadas en este servidor"),
    async execute(interaction, client) {
      const playlists = await getGuildPlaylists(interaction.guildId);

      if (playlists.length === 0) {
        return interaction.reply({ embeds: [errorEmbed("No se encontraron playlists guardadas.")] });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📋 Saved Playlists")
        .setDescription(
          playlists.map((p) => `**${p.id}.** ${p.name} (${JSON.parse(p.tracks).length} tracks) — by <@${p.user_id}>`).join("\n")
        );

      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("playlist-delete")
      .setDescription("Eliminar una playlist guardada")
      .addIntegerOption((o) => o.setName("id").setDescription("ID de la playlist").setRequired(true)),
    async execute(interaction, client) {
      const id = interaction.options.getInteger("id");
      const result = await deletePlaylist(id, interaction.guildId);

      if (result.changes === 0) {
        return interaction.reply({ embeds: [errorEmbed("No se encontro la playlist.")] });
      }

      interaction.reply({ embeds: [successEmbed("Playlist eliminada.")] });
    },
  },
];