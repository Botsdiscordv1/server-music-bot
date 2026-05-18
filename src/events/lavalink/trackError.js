const { errorEmbed } = require("../../utils/embeds");
const { MessageFlags } = require("discord.js");

const fallbackAttempted = new Set();
setInterval(() => fallbackAttempted.clear(), 300_000);

module.exports = {
  name: "trackError",
  async execute(player, track, payload, client) {
    const exc = payload?.exception;
    const errorMsg = exc?.message || payload?.error?.message || payload?.message || payload?.error || JSON.stringify(payload).substring(0, 500);
    
    const isRestricted = errorMsg.includes("This video is not available") || errorMsg.includes("ANDROID_VR");

    if (isRestricted && track?.info?.title) {
      const trackKey = `${track.info.uri}|${track.info.title}`;
      if (fallbackAttempted.has(trackKey) || fallbackAttempted.has(track.info.uri)) {
        return;
      }
      fallbackAttempted.add(trackKey);
      if (track.info.uri) fallbackAttempted.add(track.info.uri);

      const videoId = track.info.uri?.match(/(?:v=|youtu\.be\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/)?.[1];

      console.log(`[TrackError] ⤴ Searching ytsearch for alt version of "${track.info.title}"`);
      try {
        const result = await player.search(
          { query: `${track.info.author} - ${track.info.title}`, source: "ytsearch" },
          track.requester
        );
        if (result?.tracks?.length > 0) {
          const altTrack = videoId
            ? result.tracks.find(t => !t.info.uri?.includes(videoId)) || result.tracks[0]
            : result.tracks[0];
          player.queue.add(altTrack, 0);
          const isStillOnErrored = player.queue.current?.info?.uri === track?.info?.uri;
          if (isStillOnErrored) {
            await player.skip().catch(e => console.error(`[TrackError] skip() failed:`, e.message));
          } else if (!player.playing && !player.paused) {
            await player.play({ paused: false }).catch(e => console.error(`[TrackError] play() failed:`, e.message));
          }
          return;
        }
      } catch (e) {
        console.error(`[TrackError] Fallback failed:`, e.message);
      }
    }

    console.error(`[TrackError] ❌ "${track?.info?.title}"`);
    console.error(`[TrackError]   message: ${errorMsg}`);
    console.error(`[TrackError]   severity: ${exc?.severity || "unknown"}`);

    const causeMatch = errorMsg.match(/Client \[(\w+)\] failed: (.+?)(?:\r|\n|$)/);
    const shortError = causeMatch
      ? `Client ${causeMatch[1]}: ${causeMatch[2].substring(0, 200)}`
      : errorMsg.substring(0, 300);

    const channel = client?.channels?.cache?.get(player?.textChannelId);
    if (channel) {
      const embedMsg = `Failed to play **${track?.info?.title}**.\n\`${shortError}\``;
      channel.send({ embeds: [errorEmbed(embedMsg)], flags: MessageFlags.SuppressNotifications }).catch(() => {});
    }
  },
};

