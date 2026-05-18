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
  },
};
