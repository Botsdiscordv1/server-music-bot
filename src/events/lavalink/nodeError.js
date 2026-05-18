module.exports = {
  name: "error",
  execute(node, error) {
    console.error(`❌ Lavalink node error: ${node.id} — ${error.message}`);
    if (!node.connected && typeof node.connect === "function") {
      node.connect();
    }
  },
};
