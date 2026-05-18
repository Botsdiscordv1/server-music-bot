module.exports = {
  name: "error",
  execute(node, error) {
    console.error(`❌ Lavalink node error: ${node.id} — ${error.message}`);
    setTimeout(() => {
      if (!node.connected) {
        console.log(`🔄 Attempting Lavalink reconnect after error...`);
        node.connect().catch(() => {});
      }
    }, 5000);
  },
};
