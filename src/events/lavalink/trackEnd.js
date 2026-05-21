const { refillQueue } = require("../../commands/music/dj");
const { refillArtistQueue } = require("../../commands/music/djArtist");

const SET_SIZE = 10;

module.exports = {
  name: "trackEnd",
  async execute(player, track, payload, client) {
    if (player._progressInterval) {
      clearInterval(player._progressInterval);
      player._progressInterval = null;
    }

    if (player.nowPlayingMessage) {
      try {
        await player.nowPlayingMessage.delete();
      } catch (_) {}
      player.nowPlayingMessage = null;
    }

    player._trackStartTime = null;
    player._lyricsCache = null;

    if (player._djMode) {
      // Skip intro/TTS tracks — don't count toward set
      if (track?._djIntro) return;

      // Mark ended track as played for dedup
      if (track) {
        if (!player._djPlayedIds) player._djPlayedIds = new Set();
        if (!player._djPlayedTitles) player._djPlayedTitles = new Set();
        if (track.info?.identifier) player._djPlayedIds.add(track.info.identifier);
        if (track.info?.title) player._djPlayedTitles.add(track.info.title.toLowerCase());
      }

      // Track completed naturally — use as evolving seed
      if (track && player._djNegativeSeeds) {
        const key = `${track.info?.author || ""} - ${track.info?.title || ""}`.trim();
        if (!player._djNegativeSeeds.includes(key)) {
          player._djCompletedTracks = [...(player._djCompletedTracks || []), {
            key,
            title: track.info?.title || "",
            author: track.info?.author || "",
          }].slice(-20);
        }
      }

      // Track set progress — refill when queue is empty and at least 1 track played
      player._djTracksInSet = (player._djTracksInSet || 0) + 1;
      if (player.queue.tracks.length === 0 && !player._djRefilling) {
        player._djTracksInSet = 0;
        player._djSetNumber = (player._djSetNumber || 0) + 1;

        if (player._djArtistMode) {
          refillArtistQueue(player, client).catch(e => console.error("[DJ Artist refill] Error:", e.message));
        } else {
          refillQueue(player, client).catch(e => console.error("[DJ refill] Error:", e.message));
        }
      }
    }
  },
};
