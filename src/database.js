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

function cleanAuthor(author) {
  return (author || "").replace(/\s*-\s*Topic$/i, "").trim();
}

const UserStats = mongoose.model("UserStats", userStatsSchema);
const Playlist = mongoose.model("Playlist", playlistSchema);
const History = mongoose.model("History", historySchema);
const LikedSong = mongoose.model("LikedSong", likedSongSchema);
const TrackPlay = mongoose.model("TrackPlay", trackPlaySchema);

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
async function addLikedSong(userId, track) {
  await whenReady(() => {});
  try {
    const exists = await LikedSong.findOne({ userId, trackUrl: track.info.uri });
    if (exists) return false;
    await LikedSong.create({
      userId,
      trackTitle: track.info.title,
      trackAuthor: cleanAuthor(track.info.author),
      trackUrl: track.info.uri,
      trackDuration: track.info.duration,
      artworkUrl: track.info.artworkUrl,
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
    liked_at: doc.likedAt,
  }));
}

function isSongInLikes(likedSongs, track) {
  if (!track?.info || !likedSongs || likedSongs.length === 0) return false;

  const currentUri = track.info.uri;
  if (currentUri) {
    const exactMatch = likedSongs.some(s => s.track_url === currentUri);
    if (exactMatch) return true;
  }

  const cleanTitle = (title) => (title || "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/\s*-\s*topic$/gi, "")
    .replace(/[^a-z0-9áéíóúàèìòùâêîôûãõçñ\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const cleanAuthor = (author) => (author || "")
    .toLowerCase()
    .replace(/\s*-\s*topic$/gi, "")
    .replace(/[^a-z0-9áéíóúàèìòùâêîôûãõçñ\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const currentTitle = cleanTitle(track.info.title);
  const currentAuthor = cleanAuthor(track.info.author);

  if (currentTitle && currentAuthor) {
    for (const song of likedSongs) {
      const likedTitle = cleanTitle(song.track_title);
      const likedAuthor = cleanAuthor(song.track_author);
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
  getLikedSongs,
  isSongInLikes,
  getLikedArtists,
  incrementTrackPlay,
  getMostPlayedTracks,
  copyLikedSongs,
  copyPlaylist,
  getUserPlaylists,
};

