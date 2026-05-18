module.exports = {
  name: "error",
  execute(node, error) {
    console.error(`❌ Lavalink node error: ${node.id} — ${error.message}`);
    if (!node.connected && node.connect) {
      node.connect().catch(() => {});
    }
  },
};
