module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.user.setActivity("🎵 /play", { type: 2 });

    await client.lavalink.init({ id: client.user.id, username: client.user.username });
    console.log("✅ Lavalink initialized");

    client._healthInterval = setInterval(() => {
      const nodes = client.lavalink.nodeManager.nodes;
      for (const [id, node] of nodes) {
        if (!node.connected) {
          console.warn(`⚠️  Lavalink node ${id} disconnected, attempting reconnect...`);
          node.connect().catch(() => {});
        }
      }
    }, 30000);
  },
};
