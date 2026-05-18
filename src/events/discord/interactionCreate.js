const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { errorEmbed, successEmbed, queueEmbed, lyricsEmbed } = require("../../utils/embeds");
const { getLyrics, formatLyricsForEmbed } = require("../../services/lrclib");
const { startKaraoke } = require("../../commands/music/karaoke");
const searchCommand = require("../../commands/music/search");
const { addLikedSong } = require("../../database");

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    // Monkey-patch interaction methods to automatically send silent messages
    ['reply', 'editReply', 'followUp'].forEach(method => {
      const original = interaction[method];
      if (original) {
        interaction[method] = async function(options) {
          if (typeof options === 'string') {
            options = { content: options, flags: MessageFlags.SuppressNotifications };
          } else if (options) {
            options.flags = (options.flags || 0) | MessageFlags.SuppressNotifications;
          }
          return original.call(this, options);
        };
      }
    });

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction, client);
      } catch (err) {
        const msg = err?.message || err?.toString() || "";
        if (msg.includes("Unknown interaction") || msg.includes("10062") || msg.includes("expired") || msg.includes("acknowledged")) {
          return;
        }
        console.error(`[Command Error] /${interaction.commandName}:`, err);
        const reply = { embeds: [errorEmbed("An error occurred while running this command.")], flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        if (command.autocomplete) {
          await command.autocomplete(interaction, client);
        }
      } catch (err) {
        const msg = err?.message || err?.toString() || "";
        if (msg.includes("Unknown") || msg.includes("interaction") || msg.includes("expired") || msg.includes("acknowledged")) return;
        console.error(`[Autocomplete Error] /${interaction.commandName}:`, err);
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === "playback_queue") {
        return await handleQueueButton(interaction, client);
      }
      if (interaction.customId.startsWith("playback_")) {
        return await handlePlaybackButton(interaction, client);
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "search_select") {
        return await searchCommand.handleSearchSelect(interaction, client);
      }
    }
  },
};

async function handlePlaybackButton(interaction, client) {
  const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) {
    return interaction.reply({ embeds: [errorEmbed("No active player.")], flags: MessageFlags.Ephemeral });
  }

  const memberChannel = interaction.member?.voice?.channelId;
  if (!memberChannel || memberChannel !== player.voiceChannelId) {
    return interaction.reply({
      embeds: [errorEmbed("You must be in the same voice channel as the bot.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    switch (interaction.customId) {
      case "playback_back": {
        await interaction.deferUpdate();
        const previous = player.queue.previous;
        if (previous.length > 0) {
          const prevTrack = previous.shift();
          const currentTrack = player.queue.current;
          if (currentTrack) await player.queue.add(currentTrack, 0);
          await player.queue.add(prevTrack, 0);
          await player.skip();
        } else {
          await player.seek(0);
        }
        break;
      }
      case "playback_pause": {
        await interaction.deferUpdate();
        if (player.paused) {
          await player.resume();
        } else {
          await player.pause();
        }
        await updateNowPlayingButtons(player, client);
        break;
      }
      case "playback_skip": {
        await interaction.deferUpdate();
        if (player.queue.tracks.length > 0) {
          await player.skip();
        } else if (player._autoplayEnabled && player.queue.current) {
          const track = player.queue.current;
          const query = `${track.info.title} ${track.info.author}`;
          try {
            const result = await player.search(
              { query, source: "ytmsearch" },
              { username: "Autoplay", id: "autoplay" }
            );
            if (result?.tracks?.length > 1) {
              const other = result.tracks.filter((t) => t.info.identifier !== track.info.identifier);
              if (other.length > 0) {
                const pick = other[Math.floor(Math.random() * other.length)];
                player.queue.add(pick);
                await player.skip();
              }
            }
          } catch {}
        }
        break;
      }
       case "playback_stop": {
         const msg = player.nowPlayingMessage;
         await player.stopPlaying(true, false);
         if (msg?.editable) {
           await msg.edit({ components: [] }).catch(() => {});
         }
         await interaction.reply({ content: "El player ha sido detenido con éxito.", flags: MessageFlags.Ephemeral });
         break;
       }
case "playback_lyrics": {
           await interaction.deferReply({ flags: 64 });
           const trackName = player.queue.current?.info.title;
          const artistName = (player.queue.current?.info.author || "").replace(/\s*-\s*Topic$/, "");
          if (!trackName) return interaction.editReply({ embeds: [errorEmbed("No track is currently playing.")] });
          const lyrics = player._lyricsCache?.found ? player._lyricsCache : await getLyrics(trackName, artistName);
          if (!lyrics.found) return interaction.editReply({ embeds: [errorEmbed(`No lyrics found for **${trackName}**${artistName ? ` by ${artistName}` : ""}.`)] });
           const searched = trackName.toLowerCase().replace(/[^a-z0-9\s]/g, "");
          const searchedArtist = artistName.toLowerCase().replace(/[^a-z0-9\s]/g, "");
          const resultName = (lyrics.trackName || "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
          const resultArtist = (lyrics.artistName || "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
          const titleMatch = resultName.includes(searched.slice(0, 20)) || searched.includes(resultName);
          const artistMatch = !searchedArtist || !resultArtist || resultArtist.includes(searchedArtist) || searchedArtist.includes(resultArtist);
          if (!titleMatch || !artistMatch) {
            return interaction.editReply({ embeds: [errorEmbed(`No lyrics found for **${trackName}**${artistName ? ` by ${artistName}` : ""}.`)] });
          }
          const text = formatLyricsForEmbed(lyrics);
          const isSynced = !!lyrics.synced;
          await interaction.editReply({
            embeds: [lyricsEmbed(lyrics.trackName || trackName, lyrics.artistName || artistName, text, isSynced)],
          });
          break;
         }
        case "playback_lsync": {
          await interaction.deferReply();
          await startKaraoke(interaction, client);
          break;
        }
         case "playback_random": {
           await interaction.deferUpdate();
           if (player._shuffleEnabled) {
             const natural = player._naturalQueue || [];
             const currentSet = new Set(player.queue.tracks);
             const toRestore = natural.filter(t => currentSet.has(t));
             if (toRestore.length) {
               await player.queue.splice(0, player.queue.tracks.length);
               await player.queue.add(toRestore);
             }
             player._shuffleEnabled = false;
             player._originalQueue = null;
             player._naturalQueue = null;
           } else {
             player._naturalQueue = player.queue.tracks.slice();
             const shuffled = [...player.queue.tracks];
             for (let i = shuffled.length - 1; i > 0; i--) {
               const j = Math.floor(Math.random() * (i + 1));
               [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
             }
             await player.queue.splice(0, player.queue.tracks.length);
             if (shuffled.length) await player.queue.add(shuffled);
             player._shuffleEnabled = true;
           }
           await updateNowPlayingButtons(player, client);
         break;
       }
        case "playback_autoplay": {
            await interaction.deferUpdate();
            player._autoplayEnabled = !player._autoplayEnabled;
            await updateNowPlayingButtons(player, client);
          break;
        }
        case "playback_like": {
          const track = player.queue.current;
          if (!track) {
            return interaction.reply({ embeds: [errorEmbed("No hay ninguna canción reproduciéndose.")], flags: MessageFlags.Ephemeral });
          }
          addLikedSong(interaction.user.id, track);
          await interaction.reply({ embeds: [successEmbed(`❤️ **${track.info.title}** añadida a Tus Me Gusta`)], flags: MessageFlags.Ephemeral });
          break;
        }
       }
     } catch (err) {
    console.error(`[Playback Button] Error:`, err);
    await interaction.editReply({ embeds: [errorEmbed("An error occurred.")] });
  }
}

async function updateNowPlayingButtons(player, client) {
  const msg = player.nowPlayingMessage;
  if (!msg?.editable) return;

  // ── Row 1: Playback controls ──────────────────────────────────────────
  const backBtn = new ButtonBuilder()
    .setCustomId("playback_back")
    .setEmoji("<:back:1504762230250410134>")
    .setStyle(ButtonStyle.Secondary);

  const pauseBtn = new ButtonBuilder()
    .setCustomId("playback_pause")
    .setEmoji(player.paused ? "<:reproducir:1504760122285625444>" : "<:pausa:1504760177348313108>")
    .setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Danger);

  const skipBtn = new ButtonBuilder()
    .setCustomId("playback_skip")
    .setEmoji("<:skip:1504760250153046107>")
    .setStyle(ButtonStyle.Secondary);

  const stopBtn = new ButtonBuilder()
    .setCustomId("playback_stop")
    .setEmoji("<:stop:1504789139311169721>")
    .setStyle(ButtonStyle.Secondary);

  const likeBtn = new ButtonBuilder()
    .setCustomId("playback_like")
    .setEmoji("🤍")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(backBtn, pauseBtn, skipBtn, stopBtn, likeBtn);

  // ── Row 2: Queue + Autoplay + Random + optional Lyrics/LSync ─────────
  const queueBtn = new ButtonBuilder()
    .setCustomId("playback_queue")
    .setEmoji("<:lista:1504760412221079553>")
        .setLabel("List")
    .setStyle(ButtonStyle.Secondary);

  const autoplayBtn = new ButtonBuilder()
    .setCustomId("playback_autoplay")
    .setEmoji("<:autoplay:1505670487806836787>")
    .setLabel("Autoplay")
    .setStyle(player._autoplayEnabled ? ButtonStyle.Success : ButtonStyle.Secondary);

  const randomBtn = new ButtonBuilder()
    .setCustomId("playback_random")
    .setEmoji("<:random:1504767140228632607>")
    .setStyle(player._shuffleEnabled ? ButtonStyle.Success : ButtonStyle.Secondary);

  const row2 = new ActionRowBuilder().addComponents(randomBtn, autoplayBtn, queueBtn);

  const hasLyrics = player._lyricsAvailable === true;
  const hasSynced = player._lsyncAvailable === true;

  if (hasLyrics) {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId("playback_lyrics")
        .setEmoji("<:letras:1504760747056693278>")
        .setLabel("Lyric")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (hasSynced) {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId("playback_lsync")
        .setEmoji("<:lsync:1504786103968989255>")
        .setLabel("LSync")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  await msg.edit({ components: [row, row2] }).catch(() => {});
}

async function handleQueueButton(interaction, client) {
  const player = client.lavalink.getPlayer(interaction.guildId);
  if (!player) {
    return interaction.reply({ embeds: [errorEmbed("No hay un reproductor activo.")], flags: MessageFlags.Ephemeral });
  }

  const page = 1;
  const totalPages = Math.max(1, Math.ceil(player.queue.tracks.length / 10));
  const embed = queueEmbed(player, page);

  const row = totalPages > 1
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("queue_prev_1")
          .setLabel("◀ Prev")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("queue_next_1")
          .setLabel("Next ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(totalPages <= 1)
      )
    : null;

  const reply = await interaction.reply({
    embeds: [embed],
    components: row ? [row] : [],
    withResponse: true,
  });
  const message = reply?.message;

  if (!row || !message) return;

  const collector = message.createMessageComponentCollector({ time: 60_000 });
  let currentPage = page;

  collector.on("collect", async (btn) => {
    if (btn.user.id !== interaction.user.id) {
      return btn.reply({ content: "Use `/queue` yourself to browse pages.", flags: MessageFlags.Ephemeral });
    }

    currentPage += btn.customId.startsWith("queue_prev") ? -1 : 1;
    const newEmbed = queueEmbed(player, currentPage);
    const newRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue_prev_${currentPage}`)
        .setLabel("◀ Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage <= 1),
      new ButtonBuilder()
        .setCustomId(`queue_next_${currentPage}`)
        .setLabel("Next ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages)
    );

    await btn.update({ embeds: [newEmbed], components: [newRow] });
  });

  collector.on("end", () => {
    reply.edit({ components: [] }).catch(() => {});
  });
}
