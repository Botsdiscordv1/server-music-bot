module.exports = {
  name: "disconnect",
  execute(node, reason) {
    const msg = typeof reason === "string" ? reason : reason?.reason || JSON.stringify(reason);
    console.warn(`⚠️  Lavalink node disconnected: ${node.id} — ${msg}`);
    if (msg.includes("destroyed") || msg.includes("manually")) return;
    if (!node.connected && typeof node.connect === "function") {
      node.connect();
    }
  },
};
