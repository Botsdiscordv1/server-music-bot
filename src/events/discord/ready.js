module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.user.setActivity("🎵 /play", { type: 2 });

    async function warmUp(h, p, auth, secure) {
      const mod = secure ? require("https") : require("http");
      for (let i = 0; i < 20; i++) {
        try {
          const r = await new Promise((resolve, reject) => {
            const req = mod.request({ hostname: h, port: p, path: "/v4/info", method: "GET", timeout: 5000, headers: { Authorization: auth } }, resolve);
            req.on("error", reject); req.end();
          });
          console.log(`   Warm attempt ${i + 1}: HTTP ${r.statusCode}`);
          if (r.statusCode !== 404) { console.log(`✅ Lavalink warm (HTTP ${r.statusCode})`); return; }
        } catch { console.log(`   Warm attempt ${i + 1}: connection failed`); }
        await new Promise((r) => setTimeout(r, 3000));
      }
      console.warn("⚠️ Lavalink warm failed (still 404 after 60s)");
    }
    const n = [...client.lavalink.nodeManager.nodes.values()][0];
    if (n) await warmUp(n.options.host, n.options.port || 2333, n.options.authorization, n.options.secure);

    await client.lavalink.init({ id: client.user.id, username: client.user.username });
    console.log("✅ Lavalink initialized");

    for (const [id, node] of client.lavalink.nodeManager.nodes) {
      const s = node.options.secure ? "wss" : "ws";
      console.log(`   Node ${id}: ${s}://${node.options.host}:${node.options.port}/v4/websocket (pass: ${node.options.authorization ? "✓" : "✗"})`);
    }

    function pingLavalink() {
      for (const [id, node] of client.lavalink.nodeManager.nodes) {
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

    function clearIntervals() {
      clearInterval(client._pingInterval);
      clearInterval(client._healthInterval);
    }
    client.once("destroy", clearIntervals);
    client.on("error", () => clearIntervals());
  },
};
