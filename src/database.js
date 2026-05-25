require("./dns-patch");
const mongoose = require("mongoose");
const userSchema = require("./models/User").schema;

let dbReady = false;
const queue = [];

function whenReady(fn) {
  if (dbReady) return fn();
  queue.push(fn);
}

const userStatsSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  tracksPlayed: { type: Number, default: 0 },
  totalListenTime: { type: Number, default: 0 },
  favoriteArtist: String,
  lastPlayed: Date,
}, { timestamps: true });
userStatsSchema.index({ totalListenTime: -1 });

const playlistSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  tracks: { type: Array, default: [] },
}, { timestamps: true });

const historySchema = new mongoose.Schema({
  userId: { type: String, required: true },
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
likedSongSchema.index({ userId: 1, trackUrl: 1 });
likedSongSchema.index({ userId: 1, isrc: 1 });
likedSongSchema.index({ userId: 1, trackAuthor: 1 });

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

// ── Android connection (default) ───────────────────────────────────────
const UserStats = mongoose.model("UserStats", userStatsSchema);
const Playlist = mongoose.model("Playlist", playlistSchema);
const History = mongoose.model("History", historySchema);
const LikedSong = mongoose.model("LikedSong", likedSongSchema);
const TrackPlay = mongoose.model("TrackPlay", trackPlaySchema);
const DislikedSong = mongoose.model("DislikedSong", dislikedSongSchema);

// ── Discord connection (separate DB) ──────────────────────────────────
const discordUri = process.env.DISCORD_MONGODB_URI;
const discordConn = discordUri ? mongoose.createConnection(discordUri) : null;

let DiscordUser = null;
let DiscordUserStats = null;
let DiscordPlaylist = null;
let DiscordHistory = null;
let DiscordLikedSong = null;
let DiscordTrackPlay = null;
let DiscordDislikedSong = null;

if (discordConn) {
  DiscordUser = discordConn.model("User", userSchema);
  DiscordUserStats = discordConn.model("UserStats", userStatsSchema);
  DiscordPlaylist = discordConn.model("Playlist", playlistSchema);
  DiscordHistory = discordConn.model("History", historySchema);
  DiscordLikedSong = discordConn.model("LikedSong", likedSongSchema);
  DiscordTrackPlay = discordConn.model("TrackPlay", trackPlaySchema);
  DiscordDislikedSong = discordConn.model("DislikedSong", dislikedSongSchema);
}

function getModels(source) {
  if (source === "discord" && discordConn) {
    return {
      UserStats: DiscordUserStats,
      Playlist: DiscordPlaylist,
      History: DiscordHistory,
      LikedSong: DiscordLikedSong,
      TrackPlay: DiscordTrackPlay,
      DislikedSong: DiscordDislikedSong,
    };
  }
  return { UserStats, Playlist, History, LikedSong, TrackPlay, DislikedSong };
}

// ── Init DB ─────────────────────────────────────────────────────────────
async function initDB() {
  const uri = process.env.ANDROID_MONGODB_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/musicbot";
  console.log("Conectado Android DB");
  await mongoose.connect(uri);

  if (discordConn) {
    try {
      await discordConn.asPromise();
      console.log("Conectado Discord DB");
    } catch (err) {
      console.warn("Discord DB no disponible (no fatal):", err.message);
    }
  }

  dbReady = true;
  queue.forEach(fn => fn());
  queue.length = 0;
  console.log("MongoDB ready");
}

// ── User Stats ─────────────────────────────────────────────────────────
async function updateUserStats(userId, trackDuration, artist, source = "android") {
  const { UserStats } = getModels(source);
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

async function getUserStats(userId, source = "android") {
  const { UserStats } = getModels(source);
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

async function getTopListeners(limit = 10, source = "android") {
  const { UserStats } = getModels(source);
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
async function savePlaylist(userId, name, tracks, source = "android") {
  const { Playlist } = getModels(source);
  await whenReady(() => {});
  const doc = await Playlist.create({ userId, name, tracks });
  return doc._id.toString();
}

async function getPlaylist(index, userId, source = "android") {
  const { Playlist } = getModels(source);
  await whenReady(() => {});
  const docs = await Playlist.find({ userId }).sort({ createdAt: -1 }).lean();
  const doc = docs[index - 1];
  if (!doc) return null;
  return {
    id: (index).toString(),
    user_id: doc.userId,
    name: doc.name,
    tracks: JSON.stringify(doc.tracks),
    created_at: doc.createdAt,
  };
}

async function getUserPlaylists(userId, source = "android") {
  const { Playlist } = getModels(source);
  await whenReady(() => {});
  const docs = await Playlist.find({ userId }).sort({ createdAt: -1 }).lean();
  return docs.map(doc => ({
    id: doc._id.toString(),
    user_id: doc.userId,
    name: doc.name,
    tracks: JSON.stringify(doc.tracks),
    created_at: doc.createdAt,
  }));
}

async function deletePlaylist(index, userId, source = "android") {
  const { Playlist } = getModels(source);
  await whenReady(() => {});
  const docs = await Playlist.find({ userId }).sort({ createdAt: -1 }).lean();
  const target = docs[index - 1];
  if (!target) return { changes: 0 };
  const res = await Playlist.deleteOne({ _id: target._id });
  return { changes: res.deletedCount };
}

// ── History ──────────────────────────────────────────────────────────────
async function addToHistory(userId, track, source = "android") {
  const { History } = getModels(source);
  await whenReady(() => {});
  return History.create({
    userId,
    trackTitle: track.info.title,
    trackAuthor: cleanAuthor(track.info.author),
    trackUrl: track.info.uri,
    trackDuration: track.info.duration,
  });
}

async function getHistory(userId, limit = 50, source = "android") {
  const { History } = getModels(source);
  await whenReady(() => {});
  const docs = await History.find({ userId }).sort({ playedAt: -1 }).limit(limit).lean();
  return docs.map(doc => ({
    id: doc._id.toString(),
    user_id: doc.userId,
    track_title: doc.trackTitle,
    track_author: doc.trackAuthor,
    track_url: doc.trackUrl,
    track_duration: doc.trackDuration,
    played_at: doc.playedAt,
  }));
}

async function clearHistory(userId, source = "android") {
  const { History } = getModels(source);
  await whenReady(() => {});
  const res = await History.deleteMany({ userId });
  return { changes: res.deletedCount };
}

// ── Liked Songs ─────────────────────────────────────────────────────────
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

async function addLikedSong(userId, track, source = "android") {
  const { LikedSong } = getModels(source);
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

async function removeLikedSong(userId, id, source = "android") {
  const { LikedSong } = getModels(source);
  await whenReady(() => {});
  const songs = await LikedSong.find({ userId }).sort({ likedAt: -1 }).lean();
  const target = songs[id - 1];
  if (!target) return null;
  await LikedSong.deleteOne({ _id: target._id });
  return target;
}

async function removeLikedSongByTrack(userId, track, source = "android") {
  const { LikedSong } = getModels(source);
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

async function removeAllLikedSongs(userId, source = "android") {
  const { LikedSong } = getModels(source);
  await whenReady(() => {});
  const result = await LikedSong.deleteMany({ userId });
  return result.deletedCount;
}

async function getLikedSongs(userId, limit = 0, source = "android") {
  const { LikedSong } = getModels(source);
  await whenReady(() => {});
  let query = LikedSong.find({ userId }).sort({ likedAt: -1 });
  if (limit > 0) query = query.limit(limit);
  const docs = await query.lean();
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

async function isSongLiked(userId, track, source = "android") {
  const { LikedSong } = getModels(source);
  await whenReady(() => {});
  if (!track?.info) return false;
  const url = track.info.uri;
  if (url) {
    const found = await LikedSong.findOne({ userId, trackUrl: url }).lean();
    if (found) return true;
  }
  const isrc = extractIsrc(track);
  if (isrc) {
    const found = await LikedSong.findOne({ userId, isrc }).lean();
    if (found) return true;
  }
  const title = (track.info.title || "").toLowerCase();
  const author = cleanAuthor(track.info.author || "").toLowerCase().trim();
  if (title && author) {
    const found = await LikedSong.findOne({
      userId,
      trackTitle: { $regex: `^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      trackAuthor: { $regex: `^${author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    }).lean();
    if (found) return true;
  }
  return false;
}

function isSongInLikes(likedSongs, track) {
  if (!track?.info || !likedSongs || likedSongs.length === 0) return false;

  const currentUrl = track.info.uri;
  if (currentUrl && likedSongs.some(s => s.track_url === currentUrl)) {
    return true;
  }

  const currentIsrc = extractIsrc(track);
  if (currentIsrc) {
    const isrcMatch = likedSongs.some(s => s.isrc && s.isrc === currentIsrc);
    if (isrcMatch) return true;
  }

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

async function getLikedArtists(userId, source = "android") {
  const { LikedSong } = getModels(source);
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

async function incrementTrackPlay(userId, trackTitle, trackAuthor, trackUrl, source = "android") {
  const { TrackPlay } = getModels(source);
  await whenReady(() => {});
  return TrackPlay.findOneAndUpdate(
    { userId, trackUrl },
    { $inc: { playCount: 1 }, $set: { trackTitle, trackAuthor: cleanAuthor(trackAuthor) } },
    { upsert: true }
  );
}

async function getMostPlayedTracks(userId, limit = 10, source = "android") {
  const { TrackPlay } = getModels(source);
  await whenReady(() => {});
  const docs = await TrackPlay.find({ userId }).sort({ playCount: -1 }).limit(limit).lean();
  return docs.map(doc => ({
    track_title: doc.trackTitle,
    track_author: doc.trackAuthor,
    track_url: doc.trackUrl,
    play_count: doc.playCount,
  }));
}

async function copyLikedSongs(fromUserId, toUserId, source = "android") {
  const { LikedSong } = getModels(source);
  await whenReady(() => {});
  const sourceSongs = await LikedSong.find({ userId: fromUserId }).lean();
  if (sourceSongs.length === 0) return { copied: 0, skipped: 0, total: 0 };

  const existing = await LikedSong.find({ userId: toUserId }).lean();
  const existingUrls = new Set(existing.map(s => s.trackUrl).filter(Boolean));

  const toInsert = sourceSongs.filter(song => !existingUrls.has(song.trackUrl));
  if (toInsert.length > 0) {
    const docs = toInsert.map(song => ({
      userId: toUserId,
      trackTitle: song.trackTitle,
      trackAuthor: song.trackAuthor,
      trackUrl: song.trackUrl,
      trackDuration: song.trackDuration,
      artworkUrl: song.artworkUrl,
      isrc: song.isrc,
    }));
    await LikedSong.insertMany(docs, { ordered: false });
  }

  return { copied: toInsert.length, skipped: sourceSongs.length - toInsert.length, total: sourceSongs.length };
}

async function copyPlaylist(fromUserId, toUserId, playlistName, source = "android") {
  const { Playlist } = getModels(source);
  await whenReady(() => {});
  const playlist = await Playlist.findOne({ userId: fromUserId, name: playlistName }).lean();
  if (!playlist) return null;

  let targetName = playlist.name;
  const exists = await Playlist.findOne({ userId: toUserId, name: targetName });
  if (exists) {
    targetName = `${playlist.name} (Copy)`;
  }

  await Playlist.create({
    userId: toUserId,
    name: targetName,
    tracks: playlist.tracks,
  });

  return { name: targetName, trackCount: playlist.tracks.length };
}

// ── Disliked Songs ──────────────────────────────────────────────────────
async function addDislikedSong(userId, track, source = "android") {
  const { DislikedSong } = getModels(source);
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

async function getDislikedKeys(userId, source = "android") {
  const { DislikedSong } = getModels(source);
  await whenReady(() => {});
  const docs = await DislikedSong.find({ userId }).lean();
  return new Set(docs.map(d => d.trackKey));
}

async function getDislikedSongs(userId, source = "android") {
  const { DislikedSong } = getModels(source);
  await whenReady(() => {});
  return DislikedSong.find({ userId }).sort({ dislikedAt: -1 }).lean();
}

async function removeDislikedSong(userId, trackKey, source = "android") {
  const { DislikedSong } = getModels(source);
  await whenReady(() => {});
  await DislikedSong.deleteOne({ userId, trackKey });
}

async function removeDislikedSongById(userId, id, source = "android") {
  const { DislikedSong } = getModels(source);
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
  getUserPlaylists,
  deletePlaylist,
  addToHistory,
  getHistory,
  clearHistory,
  addLikedSong,
  removeLikedSong,
  removeLikedSongByTrack,
  removeAllLikedSongs,
  getLikedSongs,
  isSongLiked,
  isSongInLikes,
  extractIsrc,
  getLikedArtists,
  incrementTrackPlay,
  getMostPlayedTracks,
  copyLikedSongs,
  copyPlaylist,
  addDislikedSong,
  getDislikedKeys,
  getDislikedSongs,
  removeDislikedSong,
  removeDislikedSongById,
  DiscordUser,
};
