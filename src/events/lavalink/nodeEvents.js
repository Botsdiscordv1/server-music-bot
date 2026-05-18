// Node connected event — registered on client.lavalink.nodeManager
module.exports = {
  name: "connect",
  execute(node) {
    console.log(`✅ Lavalink node connected: ${node.id}`);
  },
};
