const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const ping = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Comprueba la latencia del bot."),
  async execute(interaction, client) {
    await interaction.reply({ content: "Pinging..." });
    const message = await interaction.fetchReply();
    const roundtrip = message.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(
      `🏓 Pong! Roundtrip: **${roundtrip}ms** | WebSocket: **${client.ws.ping}ms**`
    );
  },
};

const help = {
  data: new SlashCommandBuilder().setName("help").setDescription("Muestra todos los comandos disponibles."),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🎵 Music Bot — Comandos")
      .addFields(
        {
          name: "🎶 Música",
          value: [
            "`/play <query>` — Reproduce una canción o URL de Spotify",
            "`/search <query>` — Busca y selecciona de los resultados",
            "`/skip [to]` — Salta la canción o ve a una posición",
            "`/stop` — Detiene y limpia la cola",
            "`/pause` / `/resume` — Pausa o reanuda",
            "`/volume [level]` — Ajusta el volumen (1-150)",
            "`/loop <mode>` — Repite canción/cola/desactivado",
            "`/shuffle` — Mezcla la cola",
            "`/queue [page]` — Ver la cola",
            "`/nowplaying` — Info de la canción actual",
          ].join("\n"),
        },
        {
          name: "✨ Extras",
          value: [
            "`/lyrics [song] [artist]` — Obtén la letra de una canción",
            "`/karaoke` — Letras sincronizadas en tiempo real",
            "`/autoplay` — Reproducción automática de canciones relacionadas",
            "`/dj` — Modo DJ: recomendaciones basadas en tus gustos",
            "`/recommend` — Recomendaciones de Spotify",
            "`/filter <effect>` — Filtros de audio",
          ].join("\n"),
        },
        {
          name: "💾 Playlists",
          value: [
            "`/playlist-save <name>` — Guarda la cola actual",
            "`/playlist-load <id>` — Carga una playlist",
            "`/playlist-list` — Lista playlists guardadas",
            "`/playlist-delete <id>` — Elimina una playlist",
          ].join("\n"),
        },
        {
          name: "📜 Historial & Stats",
          value: [
            "`/history [limit]` — Ver historial de reproducción",
            "`/history-clear` — Limpiar historial",
            "`/stats [user]` — Tus estadísticas de escucha",
            "`/top-listeners` — Mejores oyentes",
          ].join("\n"),
        },
        {
          name: "❤️ Tus Me Gusta",
          value: [
            "`/likes` — Ver tus canciones con like",
            "`/likes-remove <id>` — Quitar una canción",
          ].join("\n"),
        },
        {
          name: "🛠 Utilidad",
          value: ["`/ping` — Comprueba la latencia", "`/help` — Este mensaje"].join("\n"),
        }
      )
      .setFooter({ text: "Letras por LRCLib · Metadatos por Spotify" });

    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};

module.exports = { ping, help };
