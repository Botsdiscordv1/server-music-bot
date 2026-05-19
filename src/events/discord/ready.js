module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.user.setActivity("🎵 /play", { type: 2 });

    await client.lavalink.init({ id: client.user.id, username: client.user.username });
    console.log("✅ Lavalink initialized");

    for (const [id, node] of client.lavalink.nodeManager.nodes) {
      const s = node.options.secure ? "wss" : "ws";
      console.log(`   Node ${id}: ${s}://${node.options.host}:${node.options.port}/v4/websocket (pass: ${node.options.authorization ? "✓" : "✗"})`);
    }

    function pingLavalink() {
      const mod = require("https");
      for (const [id, node] of client.lavalink.nodeManager.nodes) {
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
    }
    pingLavalink();
    client._pingInterval = setInterval(pingLavalink, 25000);

    client._healthInterval = setInterval(() => {
      const nodes = client.lavalink.nodeManager.nodes;
      for (const [id, node] of nodes) {
        if (!node.connected) {
          console.warn(`⚠️  Lavalink node ${id} disconnected, attempting reconnect...`);
        }
      }
    }, 30000);
  },
};
