function keepAlive(node) {
  const mod = node.options.secure ? require("https") : require("http");
  const opts = {
    hostname: node.options.host,
    port: node.options.port || 2333,
    path: "/v4/info",
    method: "GET",
    timeout: 5000,
    headers: { Authorization: node.options.authorization },
  };
  const req = mod.request(opts, (res) => res.resume());
  req.on("error", () => {});
  req.end();
}

module.exports = {
  name: "connect",
  async execute(node, client) {
    const proto = node.options.secure ? "wss" : "ws";
    console.log(`✅ Lavalink node connected: ${node.id} (${proto}://${node.options.host}:${node.options.port}/v4/websocket)`);

    if (node._keepAlive) clearInterval(node._keepAlive);
    node._keepAlive = setInterval(() => keepAlive(node), 60000);

    if (!client?.lavalink?.players) return;
    for (const [, player] of client.lavalink.players) {
      if (player.node.id !== node.id) continue;
      
      if (!player.voiceChannelId) continue;

      console.log(`[Lavalink Reconnect] Re-establishing voice connection for guild: ${player.guildId}`);
      try {
        await player.connect();
      } catch (err) {
        console.error(`[Lavalink Reconnect] connect() failed:`, err.message);
        continue;
      }

      setTimeout(async () => {
        try {
          if (player.queue.current) {
            console.log(`[Lavalink Reconnect] Restoring "${player.queue.current.info.title}"`);
            await player.play({ paused: player.paused });
          } else if (player.queue.tracks.length) {
            await player.play({ paused: false });
          } else if (player.queue.previous?.length > 0) {
            const last = player.queue.previous[player.queue.previous.length - 1];
            player.queue.add(last);
            await player.play({ paused: false });
          } else if (player._autoplayEnabled) {
            const { getAutoplayTrack } = require("../../services/autoplay");
            const result = await getAutoplayTrack(player, player.queue.previous?.[0] || { info: {} });
            if (result) {
              player.queue.add(result.track);
              await player.play({ paused: false });
            }
          }
        } catch (err) {
          console.error(`[Lavalink Reconnect] Failed to resume in ${player.guildId}:`, err.message);
        }
      }, 2000);
    }
  },
};
