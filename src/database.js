const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "..", "data.db");
let db;
let saveTimeout = null;
let pendingSave = false;

async function initDB() {
  const SQL = await initSqlJs();
  
  let data;
  if (fs.existsSync(dbPath)) {
    data = fs.readFileSync(dbPath);
  }
  
  db = new SQL.Database(data);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS user_stats (
      user_id TEXT PRIMARY KEY,
      tracks_played INTEGER DEFAULT 0,
      total_listen_time INTEGER DEFAULT 0,
      favorite_artist TEXT,
      last_played TEXT
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      tracks TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      track_title TEXT NOT NULL,
      track_author TEXT,
      track_url TEXT,
      track_duration INTEGER,
      played_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS liked_songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      track_title TEXT NOT NULL,
      track_author TEXT,
      track_url TEXT,
      track_duration INTEGER,
      artwork_url TEXT,
      liked_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, track_url)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_liked_user ON liked_songs(user_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_history_guild ON history(guild_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_playlists_guild ON playlists(guild_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_stats_listen ON user_stats(total_listen_time DESC)");
  
  saveDB();
  if (global._dbSaveInterval) clearInterval(global._dbSaveInterval);
  global._dbSaveInterval = setInterval(() => {
    if (pendingSave) {
      try { saveDB(); } catch (e) { console.error("[DB] Save failed:", e.message); }
      pendingSave = false;
    }
  }, 30000);
  console.log("✅ SQLite database initialized");
}

function scheduleSave() {
  pendingSave = true;
}

function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

function updateUserStats(userId, trackDuration, artist) {
  db.run(`
    INSERT INTO user_stats (user_id, tracks_played, total_listen_time, favorite_artist, last_played)
    VALUES (?, 1, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      tracks_played = tracks_played + 1,
      total_listen_time = total_listen_time + ?,
      favorite_artist = ?,
      last_played = datetime('now')
  `, [userId, trackDuration, artist, trackDuration, artist]);
  scheduleSave();
}

function getUserStats(userId) {
  const result = db.exec("SELECT * FROM user_stats WHERE user_id = ?", [userId]);
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    return {
      user_id: row[0],
      tracks_played: row[1],
      total_listen_time: row[2],
      favorite_artist: row[3],
      last_played: row[4],
    };
  }
  return null;
}

function getTopListeners(limit = 10) {
  const result = db.exec(`
    SELECT user_id, tracks_played, total_listen_time, favorite_artist
    FROM user_stats
    ORDER BY total_listen_time DESC
    LIMIT ?
  `, [limit]);
  
  if (result.length === 0) return [];
  return result[0].values.map(row => ({
    user_id: row[0],
    tracks_played: row[1],
    total_listen_time: row[2],
    favorite_artist: row[3],
  }));
}

function savePlaylist(guildId, userId, name, tracks) {
  db.run(`
    INSERT INTO playlists (guild_id, user_id, name, tracks)
    VALUES (?, ?, ?, ?)
  `, [guildId, userId, name, JSON.stringify(tracks)]);
  
  const result = db.exec("SELECT last_insert_rowid()");
  scheduleSave();
  return result[0].values[0][0];
}

function getPlaylist(id, guildId) {
  const result = db.exec("SELECT * FROM playlists WHERE id = ? AND guild_id = ?", [id, guildId]);
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    return {
      id: row[0],
      guild_id: row[1],
      user_id: row[2],
      name: row[3],
      tracks: row[4],
      created_at: row[5],
    };
  }
  return null;
}

function getGuildPlaylists(guildId) {
  const result = db.exec("SELECT * FROM playlists WHERE guild_id = ? ORDER BY created_at DESC", [guildId]);
  if (result.length === 0) return [];
  return result[0].values.map(row => ({
    id: row[0],
    guild_id: row[1],
    user_id: row[2],
    name: row[3],
    tracks: row[4],
    created_at: row[5],
  }));
}

function deletePlaylist(id, guildId) {
  db.run("DELETE FROM playlists WHERE id = ? AND guild_id = ?", [id, guildId]);
  scheduleSave();
  return { changes: db.getRowsModified() };
}

function addToHistory(guildId, track) {
  db.run(`
    INSERT INTO history (guild_id, track_title, track_author, track_url, track_duration)
    VALUES (?, ?, ?, ?, ?)
  `, [guildId, track.info.title, track.info.author, track.info.uri, track.info.duration]);
  scheduleSave();
}

function getHistory(guildId, limit = 50) {
  const result = db.exec(`
    SELECT * FROM history
    WHERE guild_id = ?
    ORDER BY played_at DESC
    LIMIT ?
  `, [guildId, limit]);
  
  if (result.length === 0) return [];
  return result[0].values.map(row => ({
    id: row[0],
    guild_id: row[1],
    track_title: row[2],
    track_author: row[3],
    track_url: row[4],
    track_duration: row[5],
    played_at: row[6],
  }));
}

function clearHistory(guildId) {
  db.run("DELETE FROM history WHERE guild_id = ?", [guildId]);
  saveDB();
  return { changes: db.getRowsModified() };
}

function addLikedSong(userId, track) {
  try {
    db.run(`
      INSERT OR IGNORE INTO liked_songs (user_id, track_title, track_author, track_url, track_duration, artwork_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [userId, track.info.title, track.info.author, track.info.uri, track.info.duration, track.info.artworkUrl]);
    scheduleSave();
    return true;
  } catch { return false; }
}

function removeLikedSong(userId, id) {
  db.run("DELETE FROM liked_songs WHERE id = ? AND user_id = ?", [id, userId]);
  saveDB();
  return db.getRowsModified() > 0;
}

function getLikedSongs(userId) {
  const result = db.exec(`
    SELECT * FROM liked_songs WHERE user_id = ? ORDER BY liked_at DESC
  `, [userId]);
  if (result.length === 0) return [];
  return result[0].values.map(row => ({
    id: row[0],
    user_id: row[1],
    track_title: row[2],
    track_author: row[3],
    track_url: row[4],
    track_duration: row[5],
    artwork_url: row[6],
    liked_at: row[7],
  }));
}

function getLikedArtists(userId) {
  const result = db.exec(`
    SELECT track_author, COUNT(*) as count FROM liked_songs
    WHERE user_id = ? AND track_author IS NOT NULL
    GROUP BY track_author ORDER BY count DESC
  `, [userId]);
  if (result.length === 0) return [];
  return result[0].values.map(row => ({ artist: row[0], count: row[1] }));
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
  getLikedArtists,
};