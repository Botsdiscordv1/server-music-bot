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
  execute(node, client) {
    const proto = node.options.secure ? "wss" : "ws";
    console.log(`✅ Lavalink node connected: ${node.id} (${proto}://${node.options.host}:${node.options.port}/v4/websocket)`);

    if (node._keepAlive) clearInterval(node._keepAlive);
    node._keepAlive = setInterval(() => keepAlive(node), 60000);
  },
};
