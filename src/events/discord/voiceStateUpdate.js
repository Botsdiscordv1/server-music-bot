module.exports = {
  name: "voiceStateUpdate",
  async execute(oldState, newState, client) {
    const player = client.lavalink.getPlayer(oldState.guild.id);
    if (!player) return;

    // If bot was moved or disconnected
    if (oldState.id === client.user.id) {
      if (!newState.channelId) {
        // Bot was disconnected from voice
        await player.destroy();
      } else {
        // Bot was moved to another channel
        player.voiceChannelId = newState.channelId;
      }
      return;
    }

    const botChannel = oldState.guild.channels.cache.get(player.voiceChannelId);
    if (!botChannel) return;

    const humanCount = () => botChannel.members.filter((m) => !m.user.bot).size;

    if (humanCount() === 0 && player.playing) {
      player.pause(true);

      if (player._autoDestroyTimer) clearTimeout(player._autoDestroyTimer);
      player._autoDestroyTimer = setTimeout(async () => {
        const p = client.lavalink.getPlayer(oldState.guild.id);
        if (p && p.paused) {
          await p.destroy();
        }
      }, 5 * 60 * 1000);
    }

    if (newState.channelId === player.voiceChannelId && player.paused && humanCount() > 0) {
      if (player._autoDestroyTimer) {
        clearTimeout(player._autoDestroyTimer);
        player._autoDestroyTimer = null;
      }
      player.resume();
    }
  },
};
