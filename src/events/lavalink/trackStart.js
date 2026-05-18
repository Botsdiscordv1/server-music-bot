const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { nowPlayingEmbed } = require("../../utils/embeds");
const { getLyrics } = require("../../services/lrclib");
const { updateUserStats, addToHistory } = require("../../database");


module.exports = {
  name: "trackStart",
  async execute(player, track, payload, client) {
    if (!player?.textChannelId || !client?.channels) return;

    const trackUri = track?.info?.uri;
    const now = Date.now();
    if (player._lastTrackStartUri === trackUri && player._lastTrackStartTime && (now - player._lastTrackStartTime) < 1500) {
      return;
    }
    player._lastTrackStartUri = trackUri;
    player._lastTrackStartTime = now;

    player._lyricsAvailable = false;
    player._lsyncAvailable = false;

    const channel = client.channels.cache.get(player.textChannelId);
    if (!channel) return;

    try {
      // ── Row 1: Playback controls ──────────────────────────────────────────
      const backBtn = new ButtonBuilder()
        .setCustomId("playback_back")
        .setEmoji("<:back:1504762230250410134>")
        .setStyle(ButtonStyle.Secondary);

      const pauseBtn = new ButtonBuilder()
        .setCustomId("playback_pause")
        .setEmoji("<:pausa:1504760177348313108>")
        .setStyle(ButtonStyle.Danger);

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

      // ── Row 2: Queue + Autoplay + Random + optional LSync/Lyrics ────────
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

      if (player.nowPlayingMessage) {
        player.nowPlayingMessage.delete().catch(() => {});
      }

      const msg = await channel.send({
        embeds: [nowPlayingEmbed(track, player, 0)],
        components: [row, row2],
        flags: [MessageFlags.SuppressNotifications],
      });


      player.nowPlayingMessage = msg;

      if (player._progressInterval) clearInterval(player._progressInterval);
      player._progressInterval = setInterval(async () => {
        if (!player.nowPlayingMessage?.editable || !player.queue.current) {
          clearInterval(player._progressInterval);
          player._progressInterval = null;
          return;
        }
        if (player.paused) return;
        try {
          const currentPosition = Math.min(player.position || 0, player.queue.current.info.duration);
          await player.nowPlayingMessage.edit({
            embeds: [nowPlayingEmbed(player.queue.current, player, currentPosition)],
          });
        } catch {}
      }, 20000);

      const searchLyrics = async () => {
        const currentTrackId = track.info.identifier;
        try {
          player._lyricsAvailable = false;
          player._lsyncAvailable = false;
          
          const cleanAuthor = (track.info.author || "").replace(/\s*-\s*Topic$/, "");
          let lyricsCheck = await getLyrics(track.info.title, cleanAuthor);
          
          const artistName = (cleanAuthor || "").toLowerCase();
          
          if (!lyricsCheck.found && cleanAuthor) {
            const cleanTitle = track.info.title.split(" - ")[0].split(" (")[0].split(" ft")[0].split(" feat")[0].trim();
            if (cleanTitle.toLowerCase() !== artistName) {
              lyricsCheck = await getLyrics(cleanTitle, cleanAuthor);
            }
          }
          
          if (!lyricsCheck.found && cleanAuthor) {
            const cleanTitle = track.info.title.split(" - ")[0].split(" (")[0].trim();
            const cleanArtist2 = cleanAuthor.split(" - ")[0].split(" (")[0].trim();
            if (cleanTitle.toLowerCase() !== cleanArtist2.toLowerCase()) {
              lyricsCheck = await getLyrics(cleanTitle, cleanArtist2);
            }
          }

          if (lyricsCheck.found) {
            const searched = track.info.title.toLowerCase().replace(/[^a-z0-9\s]/g, "");
            const searchedArtist = cleanAuthor.toLowerCase().replace(/[^a-z0-9\s]/g, "");
            const resultName = (lyricsCheck.trackName || "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
            const resultArtist = (lyricsCheck.artistName || "").toLowerCase().replace(/[^a-z0-9\s]/g, "");

            const titleMatch = resultName.includes(searched.slice(0, 20)) || searched.includes(resultName);
            const artistMatch = !searchedArtist || !resultArtist || resultArtist.includes(searchedArtist) || searchedArtist.includes(resultArtist);

            if (!titleMatch || !artistMatch) {
              lyricsCheck = { found: false, synced: null, plain: null };
            }
          }

          const hasLyrics = lyricsCheck.found === true && (lyricsCheck.synced?.length > 0 || lyricsCheck.plain);
          const hasSynced = lyricsCheck.found === true && lyricsCheck.synced?.length > 0;
          
          if (player.queue.current?.info?.identifier !== currentTrackId) return;
          player._lyricsAvailable = hasLyrics;
          player._lsyncAvailable = hasSynced;
          player._lyricsCache = hasLyrics ? lyricsCheck : null;
          
          if (player.nowPlayingMessage?.editable && (player._lyricsAvailable || player._lsyncAvailable)) {
            let newRow2 = new ActionRowBuilder().addComponents(randomBtn, autoplayBtn, queueBtn);
            if (player._lyricsAvailable) {
              newRow2.addComponents(
                new ButtonBuilder()
                  .setCustomId("playback_lyrics")
                  .setEmoji("<:letras:1504760747056693278>")
                  .setLabel("Lyric")
                  .setStyle(ButtonStyle.Secondary)
              );
            }
            if (player._lsyncAvailable) {
              newRow2.addComponents(
                new ButtonBuilder()
                  .setCustomId("playback_lsync")
                  .setEmoji("<:lsync:1504786103968989255>")
                  .setLabel("LSync")
                  .setStyle(ButtonStyle.Secondary)
              );
            }
            player.nowPlayingMessage.edit({ components: [row, newRow2] }).catch(() => {});
          }
        } catch (e) {
          if (player.queue.current?.info?.identifier === currentTrackId) {
            player._lyricsAvailable = false;
            player._lsyncAvailable = false;
            player._lyricsCache = null;
          }
        }
      };

      const updateStats = async () => {
        try {
          if (track.requester?.id) {
            await updateUserStats(track.requester.id, track.info.duration, track.info.author);
          }
        } catch (e) {}
      };

      const addHistory = async () => {
        try {
          await addToHistory(player.guildId, track);
        } catch (e) {}
      };

      searchLyrics();
      updateStats();
      addHistory();
    } catch (err) {
      console.error("[TrackStart] Error:", err.message);
    }
  },
};
