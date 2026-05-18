const http = require("http");

function keepAlive(node) {
  const opts = {
    hostname: node.host,
    port: node.port || 2333,
    path: "/v4/info",
    method: "GET",
    timeout: 5000,
    headers: { Authorization: node.authorization },
  };
  const req = http.request(opts, (res) => res.resume());
  req.on("error", () => {});
  req.end();
}

module.exports = {
  name: "connect",
  execute(node, client) {
    console.log(`✅ Lavalink node connected: ${node.id}`);

    if (node._keepAlive) clearInterval(node._keepAlive);
    node._keepAlive = setInterval(() => keepAlive(node), 25000);

    if (!client?.lavalink?.players) return;
    for (const [, player] of client.lavalink.players) {
      if (player.node.id !== node.id) continue;
      if (player.voiceChannelId && !player.connected) {
        player.connect().catch(() => {});
      }
      if (!player.playing && !player.paused) {
        if (player.queue.current) {
          player.play({ paused: false }).catch(() => {});
        } else if (player.queue.previous?.length > 0) {
          const last = player.queue.previous[player.queue.previous.length - 1];
          player.queue.add(last);
          player.play({ paused: false }).catch(() => {});
        } else if (player._autoplayEnabled) {
          const { getAutoplayTrack } = require("../../services/autoplay");
          getAutoplayTrack(player, player.queue.previous?.[0] || { info: {} }).then((result) => {
            if (result) {
              player.queue.add(result.track);
              player.play({ paused: false }).catch(() => {});
            }
          }).catch(() => {});
        }
      }
    }
  },
};
