module.exports = {
  name: "connect",
  execute(node, client) {
    console.log(`✅ Lavalink node connected: ${node.id}`);
    if (!client?.lavalink?.players) return;
    for (const [, player] of client.lavalink.players) {
      if (player.node.id !== node.id) continue;
      if (player.voiceChannelId && !player.connected) {
        player.connect().catch(() => {});
      }
      if (!player.playing && !player.paused && player.queue.current) {
        player.play({ paused: false }).catch(() => {});
      }
    }
  },
};
