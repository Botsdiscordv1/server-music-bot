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
        const query = `${track.info.title} ${track.info.author}`;
        const result = await player.search(
          { query, source: "ytmsearch" },
          { username: "Autoplay", id: "autoplay" }
        );

        if (result?.tracks?.length > 1) {
          const currentId = track.info.identifier;
          const other = result.tracks.filter((t) => t.info.identifier !== currentId);

          if (other.length > 0) {
            const pick = other[Math.floor(Math.random() * other.length)];
            player.queue.add(pick);

            if (!player.playing && !player.paused) {
              await player.play({ paused: false });
              player._trackStartTime = Date.now();
            }

            const channel = client.channels.cache.get(player.textChannelId);
            if (channel) {
              channel.send({ content: `🔁 Autoplay: **${pick.info.title}** — ${pick.info.author}` }).catch(() => {});
            }

            return;
          }
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
