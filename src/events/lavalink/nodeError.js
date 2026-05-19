module.exports = {
  name: "error",
  execute(node, error) {
    console.error(`❌ Lavalink node error: ${node.id} — ${error.message}`);
    console.error(`   host=${node.options.host} port=${node.options.port} secure=${node.options.secure} pass=${node.options.authorization ? "✓" : "✗"}`);
  },
};
