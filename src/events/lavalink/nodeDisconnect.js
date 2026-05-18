module.exports = {
  name: "disconnect",
  execute(node, reason) {
    console.warn(`⚠️  Lavalink node disconnected: ${node.id} — ${reason}`);
    if (reason?.includes("destroyed") || reason?.includes("manually")) return;
    setTimeout(() => {
      if (!node.connected) {
        node.connect().catch(() => {});
      }
    }, 5000);
  },
};
