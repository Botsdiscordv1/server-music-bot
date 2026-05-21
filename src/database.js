const mongoose = require("mongoose");

let dbReady = false;
const queue = [];

function whenReady(fn) {
  if (dbReady) return fn();
  queue.push(fn);
}

// ── Schemas ──────────────────────────────────────────────────────────
const userStatsSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  tracksPlayed: { type: Number, default: 0 },
  totalListenTime: { type: Number, default: 0 },
  favoriteArtist: String,
  lastPlayed: Date,
}, { timestamps: true });

const playlistSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  name: { type: String, required: true },
  tracks: { type: Array, default: [] },
}, { timestamps: true });

const historySchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  trackTitle: String,
  trackAuthor: String,
  trackUrl: String,
  trackDuration: Number,
  playedAt: { type: Date, default: Date.now },
});

const likedSongSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  trackTitle: String,
  trackAuthor: String,
  trackUrl: String,
  trackDuration: Number,
  artworkUrl: String,
  isrc: String,
  likedAt: { type: Date, default: Date.now },
});

const trackPlaySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  trackTitle: String,
  trackAuthor: String,
  trackUrl: String,
  playCount: { type: Number, default: 1 },
});
trackPlaySchema.index({ userId: 1, trackUrl: 1 }, { unique: true });

const dislikedSongSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  trackTitle: String,
  trackAuthor: String,
  trackUrl: String,
  trackKey: { type: String, required: true },
  dislikedAt: { type: Date, default: Date.now },
});
dislikedSongSchema.index({ userId: 1, trackKey: 1 }, { unique: true });

function cleanAuthor(author) {
  return (author || "").replace(/\s*-\s*Topic$/i, "").trim();
}

const UserStats = mongoose.model("UserStats", userStatsSchema);
const Playlist = mongoose.model("Playlist", playlistSchema);
const History = mongoose.model("History", historySchema);
const LikedSong = mongoose.model("LikedSong", likedSongSchema);
const TrackPlay = mongoose.model("TrackPlay", trackPlaySchema);
const DislikedSong = mongoose.model("DislikedSong", dislikedSongSchema);

async function initDB() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/musicbot";
  await mongoose.connect(uri);
  dbReady = true;
  queue.forEach(fn => fn());
  queue.length = 0;
  console.log("✅ MongoDB connected");
}

// ── User Stats ─────────────────────────────────────────────────────────
async function updateUserStats(userId, trackDuration, artist) {
  await whenReady(() => {});
  return UserStats.findOneAndUpdate(
    { userId },
    {
      $inc: { tracksPlayed: 1, totalListenTime: trackDuration },
      $set: { favoriteArtist: cleanAuthor(artist), lastPlayed: new Date() },
    },
    { upsert: true }
  );
}

async function getUserStats(userId) {
  await whenReady(() => {});
  const doc = await UserStats.findOne({ userId }).lean();
  if (!doc) return null;
  return {
    user_id: doc.userId,
    tracks_played: doc.tracksPlayed,
    total_listen_time: doc.totalListenTime,
    favorite_artist: doc.favoriteArtist,
    last_played: doc.lastPlayed,
  };
}

async function getTopListeners(limit = 10) {
  await whenReady(() => {});
  const docs = await UserStats.find().sort({ totalListenTime: -1 }).limit(limit).lean();
  return docs.map(doc => ({
    user_id: doc.userId,
    tracks_played: doc.tracksPlayed,
    total_listen_time: doc.totalListenTime,
    favorite_artist: doc.favoriteArtist,
  }));
}

// ── Playlists ───────────────────────────────────────────────────────────
async function savePlaylist(guildId, userId, name, tracks) {
  await whenReady(() => {});
  const doc = await Playlist.create({ guildId, userId, name, tracks });
  return doc._id.toString();
}

async function getPlaylist(index, guildId) {
  await whenReady(() => {});
  const docs = await Playlist.find({ guildId }).sort({ createdAt: -1 }).lean();
  const doc = docs[index - 1];
  if (!doc) return null;
  return {
    id: (index).toString(),
    guild_id: doc.guildId,
    user_id: doc.userId,
    name: doc.name,
    tracks: JSON.stringify(doc.tracks),
    created_at: doc.createdAt,
  };
}

async function getGuildPlaylists(guildId) {
  await whenReady(() => {});
  const docs = await Playlist.find({ guildId }).sort({ createdAt: -1 }).lean();
  return docs.map(doc => ({
    id: doc._id.toString(),
    guild_id: doc.guildId,
    user_id: doc.userId,
    name: doc.name,
    tracks: JSON.stringify(doc.tracks),
    created_at: doc.createdAt,
  }));
}

async function deletePlaylist(index, guildId) {
  await whenReady(() => {});
  const docs = await Playlist.find({ guildId }).sort({ createdAt: -1 }).lean();
  const target = docs[index - 1];
  if (!target) return { changes: 0 };
  const res = await Playlist.deleteOne({ _id: target._id });
  return { changes: res.deletedCount };
}

// ── History ──────────────────────────────────────────────────────────────
async function addToHistory(guildId, track) {
  await whenReady(() => {});
  return History.create({
    guildId,
    trackTitle: track.info.title,
    trackAuthor: cleanAuthor(track.info.author),
    trackUrl: track.info.uri,
    trackDuration: track.info.duration,
  });
}

async function getHistory(guildId, limit = 50) {
  await whenReady(() => {});
  const docs = await History.find({ guildId }).sort({ playedAt: -1 }).limit(limit).lean();
  return docs.map(doc => ({
    id: doc._id.toString(),
    guild_id: doc.guildId,
    track_title: doc.trackTitle,
    track_author: doc.trackAuthor,
    track_url: doc.trackUrl,
    track_duration: doc.trackDuration,
    played_at: doc.playedAt,
  }));
}

async function clearHistory(guildId) {
  await whenReady(() => {});
  const res = await History.deleteMany({ guildId });
  return { changes: res.deletedCount };
}

// ── Liked Songs ─────────────────────────────────────────────────────────

/**
 * Extracts the ISRC from a Lavalink track, if available.
 * Checks multiple sources in order: pluginInfo.isrc, info.isrc, info.extra.isrc, info.identifier (ISRC format).
 */
function extractIsrc(track) {
  if (!track?.info) return null;
  if (track.pluginInfo?.isrc) return track.pluginInfo.isrc;
  if (track.info.isrc) return track.info.isrc;
  if (track.info.extra?.isrc) return track.info.extra.isrc;
  if (track.info.identifier && /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/.test(track.info.identifier)) {
    return track.info.identifier;
  }
  return null;
}

async function addLikedSong(userId, track) {
  await whenReady(() => {});
  try {
    const exists = await LikedSong.findOne({ userId, trackUrl: track.info.uri });
    if (exists) return false;
    const isrc = extractIsrc(track);
    await LikedSong.create({
      userId,
      trackTitle: track.info.title,
      trackAuthor: cleanAuthor(track.info.author),
      trackUrl: track.info.uri,
      trackDuration: track.info.duration,
      artworkUrl: track.info.artworkUrl,
      isrc: isrc || undefined,
    });
    return true;
  } catch { return false; }
}

async function removeLikedSong(userId, id) {
  await whenReady(() => {});
  const songs = await LikedSong.find({ userId }).sort({ likedAt: -1 }).lean();
  const target = songs[id - 1];
  if (!target) return null;
  await LikedSong.deleteOne({ _id: target._id });
  return target;
}

async function removeLikedSongByTrack(userId, track) {
  await whenReady(() => {});
  const url = track?.info?.uri;
  if (url) {
    const deleted = await LikedSong.deleteOne({ userId, trackUrl: url });
    return deleted.deletedCount > 0;
  }
  const isrc = extractIsrc(track);
  if (isrc) {
    const deleted = await LikedSong.deleteOne({ userId, isrc });
    if (deleted.deletedCount > 0) return true;
  }
  const title = track?.info?.title;
  const author = track?.info?.author ? cleanAuthor(track.info.author) : "";
  if (title && author) {
    const deleted = await LikedSong.deleteOne({ userId, trackTitle: title, trackAuthor: author });
    if (deleted.deletedCount > 0) return true;
  }
  return false;
}

async function removeAllLikedSongs(userId) {
  await whenReady(() => {});
  const result = await LikedSong.deleteMany({ userId });
  return result.deletedCount;
}

async function getLikedSongs(userId) {
  await whenReady(() => {});
  const docs = await LikedSong.find({ userId }).sort({ likedAt: -1 }).lean();
  return docs.map(doc => ({
    id: doc._id.toString(),
    user_id: doc.userId,
    track_title: doc.trackTitle,
    track_author: doc.trackAuthor,
    track_url: doc.trackUrl,
    track_duration: doc.trackDuration,
    artwork_url: doc.artworkUrl,
    isrc: doc.isrc,
    liked_at: doc.likedAt,
  }));
}

function isSongInLikes(likedSongs, track) {
  if (!track?.info || !likedSongs || likedSongs.length === 0) return false;

  // Priority 1: URL match (matches addLikedSong's uniqueness check)
  const currentUrl = track.info.uri;
  if (currentUrl && likedSongs.some(s => s.track_url === currentUrl)) {
    return true;
  }

  // Priority 2: ISRC match
  const currentIsrc = extractIsrc(track);
  if (currentIsrc) {
    const isrcMatch = likedSongs.some(s => s.isrc && s.isrc === currentIsrc);
    if (isrcMatch) return true;
  }

  // Priority 3: exact title + exact artist (case-insensitive, strict otherwise)
  const currentTitle = (track.info.title || "").toLowerCase();
  const currentAuthor = (track.info.author || "").replace(/\s*-\s*topic$/i, "").toLowerCase().trim();

  if (currentTitle && currentAuthor) {
    for (const song of likedSongs) {
      const likedTitle = (song.track_title || "").toLowerCase();
      const likedAuthor = (song.track_author || "").toLowerCase().trim();
      if (currentTitle === likedTitle && currentAuthor === likedAuthor) {
        return true;
      }
    }
  }

  return false;
}

async function getLikedArtists(userId) {
  await whenReady(() => {});
  const docs = await LikedSong.find({ userId, trackAuthor: { $ne: null } }).lean();
  const counts = {};
  for (const doc of docs) {
    const artist = doc.trackAuthor;
    if (artist) counts[artist] = (counts[artist] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => b.count - a.count);
}

async function incrementTrackPlay(userId, trackTitle, trackAuthor, trackUrl) {
  await whenReady(() => {});
  return TrackPlay.findOneAndUpdate(
    { userId, trackUrl },
    { $inc: { playCount: 1 }, $set: { trackTitle, trackAuthor: cleanAuthor(trackAuthor) } },
    { upsert: true }
  );
}

async function getMostPlayedTracks(userId, limit = 10) {
  await whenReady(() => {});
  const docs = await TrackPlay.find({ userId }).sort({ playCount: -1 }).limit(limit).lean();
  return docs.map(doc => ({
    track_title: doc.trackTitle,
    track_author: doc.trackAuthor,
    track_url: doc.trackUrl,
    play_count: doc.playCount,
  }));
}

async function copyLikedSongs(fromUserId, toUserId) {
  await whenReady(() => {});
  const sourceSongs = await LikedSong.find({ userId: fromUserId }).lean();
  if (sourceSongs.length === 0) return { copied: 0, skipped: 0, total: 0 };

  let copied = 0;
  let skipped = 0;
  for (const song of sourceSongs) {
    const exists = await LikedSong.findOne({ userId: toUserId, trackUrl: song.trackUrl });
    if (!exists) {
      await LikedSong.create({
        userId: toUserId,
        trackTitle: song.trackTitle,
        trackAuthor: song.trackAuthor,
        trackUrl: song.trackUrl,
        trackDuration: song.trackDuration,
        artworkUrl: song.artworkUrl,
        isrc: song.isrc,
      });
      copied++;
    } else {
      skipped++;
    }
  }
  return { copied, skipped, total: sourceSongs.length };
}

async function copyPlaylist(guildId, fromUserId, toUserId, playlistName) {
  await whenReady(() => {});
  const playlist = await Playlist.findOne({ guildId, userId: fromUserId, name: playlistName }).lean();
  if (!playlist) return null;

  let targetName = playlist.name;
  const exists = await Playlist.findOne({ guildId, userId: toUserId, name: targetName });
  if (exists) {
    targetName = `${playlist.name} (Copy)`;
  }

  await Playlist.create({
    guildId,
    userId: toUserId,
    name: targetName,
    tracks: playlist.tracks,
  });

  return { name: targetName, trackCount: playlist.tracks.length };
}

async function getUserPlaylists(guildId, userId) {
  await whenReady(() => {});
  return Playlist.find({ guildId, userId }).sort({ name: 1 }).lean();
}

// ── Disliked Songs ──────────────────────────────────────────────────────
async function addDislikedSong(userId, track) {
  await whenReady(() => {});
  const title = track.info?.title || track.track_title || "";
  const author = track.info?.author || track.track_author || "";
  const url = track.info?.uri || track.track_url || "";
  const key = `${cleanAuthor(author)} - ${title}`.trim();
  try {
    await DislikedSong.create({ userId, trackTitle: title, trackAuthor: author, trackUrl: url, trackKey: key });
    return true;
  } catch {
    return false;
  }
}

async function getDislikedKeys(userId) {
  await whenReady(() => {});
  const docs = await DislikedSong.find({ userId }).lean();
  return new Set(docs.map(d => d.trackKey));
}

async function getDislikedSongs(userId) {
  await whenReady(() => {});
  return DislikedSong.find({ userId }).sort({ dislikedAt: -1 }).lean();
}

async function removeDislikedSong(userId, trackKey) {
  await whenReady(() => {});
  await DislikedSong.deleteOne({ userId, trackKey });
}

async function removeDislikedSongById(userId, id) {
  await whenReady(() => {});
  const songs = await DislikedSong.find({ userId }).sort({ dislikedAt: -1 }).lean();
  const target = songs[id - 1];
  if (!target) return null;
  await DislikedSong.deleteOne({ _id: target._id });
  return target;
}

module.exports = {
  initDB,
  updateUserStats,
  getUserStats,
  getTopListeners,
  savePlaylist,
  getPlaylist,
  getGuildPlaylists,
  deletePlaylist,
  addToHistory,
  getHistory,
  clearHistory,
  addLikedSong,
  removeLikedSong,
  removeLikedSongByTrack,
  removeAllLikedSongs,
  getLikedSongs,
  isSongInLikes,
  extractIsrc,
  getLikedArtists,
  incrementTrackPlay,
  getMostPlayedTracks,
  copyLikedSongs,
  copyPlaylist,
  getUserPlaylists,
  addDislikedSong,
  getDislikedKeys,
  getDislikedSongs,
  removeDislikedSong,
  removeDislikedSongById,
};

