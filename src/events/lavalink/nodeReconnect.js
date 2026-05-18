module.exports = {
  name: "reconnect",
  execute(node, attempts) {
    console.log(`🔄 Lavalink reconnecting... (attempt ${attempts})`);
  },
};
