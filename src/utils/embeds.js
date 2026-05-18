const { EmbedBuilder } = require("discord.js");

const COLORS = {
  primary: 0x5865f2,   // Discord blurple
  success: 0x57f287,   // green
  error: 0xed4245,     // red
  warning: 0xfee75c,   // yellow
  music: 0x1db954,     // Spotify green
  info: 0x4f90d9,
};

function formatThumbnail(url) {
  if (!url) return null;
  const ytDomains = ["i.ytimg.com", "googlevideo.com", "yt3.ggpht.com"];
  if (!ytDomains.some(d => url.includes(d))) return url;

  if (url.includes("=w") && url.includes("=h")) {
    const base = url.split("=w")[0];
    return `${base}=w640-h480-c`;
  }

  const match = url.match(/vi\/([a-zA-Z0-9_-]{11})/);
  if (match) {
    return `https://i.ytimg.com/vi/${match[1]}/maxresdefault.jpg`;
  }

  return url;
}

/**
 * Now Playing embed with Spotify metadata.
 */
function nowPlayingEmbed(track, player, forcedPosition = null) {
  const pos = formatTime(forcedPosition !== null ? forcedPosition : player.position);
  const dur = formatTime(track.info.duration);
  const cleanAuthor = track.info.author ? track.info.author.replace(/\s*-\s*Topic$/, "") : "Unknown";

  return new EmbedBuilder()
    .setColor(COLORS.music)
    .setAuthor({ name: "🎵 Now Playing" })
    .setTitle(track.info.title)
    .setURL(track.info.uri)
    .setDescription(`**${cleanAuthor}**\n\n\`${pos} / ${dur}\``)
    .setThumbnail(formatThumbnail(track.info.artworkUrl))
    .addFields(
      { name: sourceLabel(track), value: "\u200B", inline: true },
      { name: "🔊 Volume", value: `${player.volume}%`, inline: true },
      { name: "🔁 Loop", value: loopLabel(player.repeatMode), inline: true }
    )
    .setFooter({ text: `Requested by ${track.requester?.username || "Unknown"}` });
}

/**
 * Queue embed — shows first 10 tracks.
 */
function queueEmbed(player, page = 1) {
  const queue = player.queue.tracks;
  const perPage = 10;
  const start = (page - 1) * perPage;
  const slice = queue.slice(start, start + perPage);
  const totalPages = Math.max(1, Math.ceil(queue.length / perPage));

  const current = player.queue.current;
  const currentLine = current
    ? `**Now Playing:** [${current.info.title}](${current.info.uri}) — \`${formatTime(current.info.duration)}\``
    : "Nothing playing";

  const trackList = slice.length
    ? slice
        .map(
          (t, i) =>
            `\`${start + i + 1}.\` [${t.info.title}](${t.info.uri}) — \`${formatTime(t.info.duration)}\``
        )
        .join("\n")
    : "Queue is empty";

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("📋 Queue")
    .setDescription(`${currentLine}\n\n${trackList}`)
    .setFooter({
      text: `Page ${page}/${totalPages} · ${queue.length} tracks · Total: ${formatTime(
        queue.reduce((acc, t) => acc + t.info.duration, 0)
      )}`,
    });
}

/**
 * Lyrics embed (static).
 */
function lyricsEmbed(trackTitle, artistName, lyricsText, isSynced = false) {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setAuthor({ name: isSynced ? "🎤 Synced Lyrics" : "📝 Lyrics" })
    .setTitle(`${trackTitle} — ${artistName}`)
    .setDescription(lyricsText || "No lyrics found.")
    .setFooter({ text: "Powered by LRCLib" });
}

/**
 * Simple error embed.
 */
function errorEmbed(message) {
  const safe = typeof message === "string" ? `❌ ${message}`.substring(0, 4000) : "❌ An error occurred.";
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setDescription(safe);
}

/**
 * Simple success embed.
 */
function successEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setDescription(`✅ ${message}`);
}

/**
 * Track added to queue embed.
 */
function addedToQueueEmbed(track, position) {
  const cleanAuthor = track.info.author ? track.info.author.replace(/\s*-\s*Topic$/, "") : "Unknown";
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({ name: "➕ Added to Queue" })
    .setTitle(track.info.title)
    .setURL(track.info.uri)
    .setThumbnail(formatThumbnail(track.info.artworkUrl))
    .addFields(
      { name: "Artist", value: cleanAuthor, inline: true },
      { name: "Duration", value: formatTime(track.info.duration), inline: true },
      { name: "Position", value: `#${position}`, inline: true }
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatTime(ms) {
  if (!ms || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function loopLabel(mode) {
  const modes = { none: "Off", track: "Track 🔂", queue: "Queue 🔁" };
  return modes[mode] || "Off";
}

const YT_SOURCES = new Set(["ytmsearch", "ytsearch", "youtube"]);
function sourceLabel(track) {
  if (track._originalSource === "spotify" || track.info.sourceName === "spotify") return "<:spotify:1505673638689509466> Spotify";
  if (YT_SOURCES.has(track.info.sourceName)) return "<:youtube:1505683142080598176> YTMusic";
  return "📀 Fuente";
}

module.exports = {
  nowPlayingEmbed,
  queueEmbed,
  lyricsEmbed,
  errorEmbed,
  successEmbed,
  addedToQueueEmbed,
  formatTime,
};
