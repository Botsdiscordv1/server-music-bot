const { errorEmbed } = require("../../utils/embeds");

module.exports = {
  name: "trackStuck",
  async execute(player, track, payload, client) {
    if (player._progressInterval) {
      clearInterval(player._progressInterval);
      player._progressInterval = null;
    }
    
    player.skip();
  },
};
