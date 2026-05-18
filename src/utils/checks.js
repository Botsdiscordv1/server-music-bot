const { errorEmbed } = require("./embeds");

async function requireVoiceChannel(interaction) {
  const member = interaction.member;
  const channel = member?.voice?.channel;
  if (!channel) {
    await interaction.reply({ embeds: [errorEmbed("Debes estar en un canal de voz.")], flags: 64 });
    return null;
  }
  return channel;
}

async function requirePlayer(interaction, client) {
  const player = client.lavalink.getPlayer(interaction.guildId);
  if (!player || !player.queue.current) {
    await interaction.reply({ embeds: [errorEmbed("No hay nada reproduciéndose en este momento.")], flags: 64 });
    return null;
  }
  return player;
}

async function requireSameChannel(interaction, player) {
  const userChannel = interaction.member?.voice?.channelId;
  if (userChannel !== player.voiceChannelId) {
    await interaction.reply({
      embeds: [errorEmbed("Debes estar en el mismo canal de voz que el bot.")],
      flags: 64,
    });
    return false;
  }
  return true;
}

module.exports = { requireVoiceChannel, requirePlayer, requireSameChannel };
