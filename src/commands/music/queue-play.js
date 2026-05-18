const { SlashCommandBuilder } = require("discord.js");
const { requirePlayer, requireSameChannel } = require("../../utils/checks");
const { successEmbed, errorEmbed } = require("../../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue-play")
    .setDescription("Reproducir una canción de la cola por su posición.")
    .addStringOption((o) =>
      o.setName("position")
        .setDescription("Posición de la canción en la cola (escribe un número)")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async execute(interaction, client) {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!(await requireSameChannel(interaction, player))) return;

    const positionStr = interaction.options.getString("position");
    const position = parseInt(positionStr, 10);

    if (isNaN(position) || position < 1) {
      return interaction.reply({
        embeds: [errorEmbed("Por favor ingresa un número válido de posición.")],
      });
    }

    const queue = player.queue.tracks;

    if (position > queue.length) {
      return interaction.reply({
        embeds: [errorEmbed(`La posición ${position} no existe. La cola tiene ${queue.length} canciones.`)],
      });
    }

    const track = queue[position - 1];
    queue.splice(position - 1, 1);
    queue.unshift(track);

    if (!player.playing) {
      await player.play();
    } else {
      await player.skip();
    }

    await interaction.reply({
      embeds: [successEmbed(`Reproduciendo: **${track.info.title}** (posición #${position})`)],
    });
  },

  async autocomplete(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    const queue = player?.queue.tracks || [];
    const focused = interaction.options.getFocused().toLowerCase();

    if (queue.length === 0) {
      return interaction.respond([{ name: "La cola está vacía", value: "empty" }]).catch(() => {});
    }

    let choices = [];

    if (focused && /^\d+$/.test(focused)) {
      const num = parseInt(focused, 10);
      if (num >= 1 && num <= queue.length) {
        const track = queue[num - 1];
        const title = track.info.title.length > 60 ? track.info.title.substring(0, 57) + "..." : track.info.title;
        const author = track.info.author.length > 25 ? track.info.author.substring(0, 22) + "..." : track.info.author;
        const duration = track.info.isStream ? "Live" : `${Math.floor(track.info.duration / 60000)}:${Math.floor((track.info.duration % 60000) / 1000).toString().padStart(2, '0')}`;
        
        choices.push({
          name: `▶ Reproducir #${num}: ${title} - ${author} (${duration})`,
          value: focused,
        });
      }
    } else if (focused.length > 0) {
      const searchTerms = focused.split(" ").filter(t => t.length > 1);
      const matched = [];
      
      for (let i = 0; i < queue.length; i++) {
        const track = queue[i];
        const titleLower = track.info.title.toLowerCase();
        const authorLower = track.info.author.toLowerCase();
        
        const hasMatch = searchTerms.every(term => 
          titleLower.includes(term) || authorLower.includes(term)
        );
        
        if (hasMatch) {
          matched.push({ index: i + 1, track, priority: 0 });
        } else if (searchTerms.some(term => 
          titleLower.includes(term) || authorLower.includes(term)
        )) {
          matched.push({ index: i + 1, track, priority: 1 });
        }
      }

      matched.sort((a, b) => a.priority - b.priority);

      if (matched.length > 0) {
        for (const m of matched.slice(0, 25)) {
          const track = m.track;
          const duration = track.info.isStream ? "Live" : `${Math.floor(track.info.duration / 60000)}:${Math.floor((track.info.duration % 60000) / 1000).toString().padStart(2, '0')}`;
          const title = track.info.title.length > 45 ? track.info.title.substring(0, 42) + "..." : track.info.title;
          const author = track.info.author.length > 18 ? track.info.author.substring(0, 15) + "..." : track.info.author;
          
          choices.push({
            name: `#${m.index}. ${title} - ${author} (${duration})`,
            value: String(m.index),
          });
        }
      } else {
        choices.push({ name: "No se encontraron canciones", value: "none" });
      }
    } else {
      for (let i = 0; i < Math.min(queue.length, 25); i++) {
        const track = queue[i];
        const duration = track.info.isStream ? "Live" : `${Math.floor(track.info.duration / 60000)}:${Math.floor((track.info.duration % 60000) / 1000).toString().padStart(2, '0')}`;
        const title = track.info.title.length > 45 ? track.info.title.substring(0, 42) + "..." : track.info.title;
        const author = track.info.author.length > 18 ? track.info.author.substring(0, 15) + "..." : track.info.author;

        choices.push({
          name: `${i + 1}. ${title} - ${author} (${duration})`,
          value: String(i + 1),
        });
      }
    }

    await interaction.respond(choices).catch(() => {});
  },
};