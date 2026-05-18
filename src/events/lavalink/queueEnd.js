const { getAutoplayTrack } = require("../../services/autoplay");

module.exports = {
  name: "queueEnd",
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

    if (player._autoplayEnabled && track) {
      try {
        const result = await getAutoplayTrack(player, track);

        if (result) {
          const pick = result.track;
          const label = result.source === "spotify" ? " (via Spotify)" : "";

          player.queue.add(pick);

          if (!player.playing && !player.paused) {
            await player.play({ paused: false });
            player._trackStartTime = Date.now();
          }

          const channel = client.channels.cache.get(player.textChannelId);
          if (channel) {
            channel.send({ content: `🔁 Autoplay: **${pick.info.title}** — ${pick.info.author}${label}` }).catch(() => {});
          }

          return;
        }
      } catch (err) {
        console.error("[Autoplay] Error:", err.message);
      }
    }

    setTimeout(() => {
      if (!player.playing && !player.paused && !player.queue.tracks.length) {
        player.destroy();
      }
    }, 900000);
  },
};
