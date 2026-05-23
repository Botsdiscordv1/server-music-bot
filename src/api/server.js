const express = require("express");
const { requireApiKey } = require("./middleware/auth");
const db = require("../database");
const { getLyrics } = require("../services/lrclib");
const spotify = require("../services/spotify");
const axios = require("axios");
const play = require("play-dl");

let resolveWithYtDlp;
try {
  const ytDlp = require("@distube/yt-dlp");
  resolveWithYtDlp = async (videoUrl) => {
    const result = await ytDlp.raw(videoUrl, {
      format: "bestaudio",
      noWarnings: true,
      getUrl: true,
    });
    return result.stdout.toString().trim();
  };
  console.log("[API/stream] yt-dlp loaded");
} catch {
  resolveWithYtDlp = null;
  console.warn("[API/stream] yt-dlp not available, using play-dl only");
}

const streamCache = new Map();
const STREAM_CACHE_TTL = 30 * 60 * 1000; // 30 min

const LAVALINK_HOST = process.env.LAVALINK_HOST || "localhost";
const LAVALINK_PORT = Number(process.env.LAVALINK_PORT) || 2333;
const LAVALINK_SECURE = process.env.LAVALINK_SECURE === "true";
const LAVALINK_PROTO = LAVALINK_SECURE ? "https" : "http";
const LAVALINK_AUTH = process.env.LAVALINK_PASSWORD || "youshallnotpass";

const app = express();
app.use(express.json());

// Logger simple para debug en Render
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// Root Health Check (Para Render)
app.get("/", (req, res) => {
  res.send("Android Music Backend is running");
});

// API Health Check (Para el App Android)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "music-api" });
});

app.get("/api/search", requireApiKey, async (req, res) => {
  try {
    const q = req.query.q;
    const source = req.query.source || "ytmsearch";
    if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });

    const url = `${LAVALINK_PROTO}://${LAVALINK_HOST}:${LAVALINK_PORT}/v4/loadtracks?identifier=${encodeURIComponent(`${source}:${q}`)}`;
    const response = await axios.get(url, {
      headers: { Authorization: LAVALINK_AUTH },
      timeout: 10000,
    });

    const tracks = (response.data?.data || []).map(t => ({
      encoded: t.encoded,
      title: t.info?.title,
      author: t.info?.author,
      duration: t.info?.duration,
      uri: t.info?.uri,
      artworkUrl: t.info?.artworkUrl,
      source: t.info?.sourceName,
    }));

    res.json({ query: q, source, tracks });
  } catch (err) {
    console.error("Search Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stream", requireApiKey, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id || id === "undefined" || id === "null" || id.trim() === "") {
      return res.status(400).json({ error: "Missing or invalid 'id' parameter" });
    }

    const cacheKey = id.trim();
    const cached = streamCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL) {
      return res.json({ url: cached.url });
    }

    const url = (id.startsWith("http://") || id.startsWith("https://"))
      ? id
      : `https://www.youtube.com/watch?v=${id}`;

    if (resolveWithYtDlp) {
      try {
        const streamUrl = await resolveWithYtDlp(url);
        if (streamUrl) {
          streamCache.set(cacheKey, { url: streamUrl, ts: Date.now() });
          return res.json({ url: streamUrl });
        }
      } catch (ytErr) {
        console.warn("[API/stream] yt-dlp failed:", ytErr.message);
      }
    }

    const info = await play.video_info(url);
    const stream = await play.stream_from_info(info, { quality: 2 });
    if (stream?.url) {
      streamCache.set(cacheKey, { url: stream.url, ts: Date.now() });
      return res.json({ url: stream.url });
    }

    return res.status(404).json({ error: "No audio stream found" });
  } catch (err) {
    console.error("Stream Error:", err.message);
    res.status(500).json({ error: "Error en el servidor de streaming" });
  }
});

app.get("/api/lyrics", requireApiKey, async (req, res) => {
  try {
    const { track, artist, album } = req.query;
    if (!track) return res.status(400).json({ error: "Missing 'track' parameter" });
    const result = await getLyrics(track, artist || "", album || "");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/likes/:userId", requireApiKey, async (req, res) => {
  try {
    const songs = await db.getLikedSongs(req.params.userId, parseInt(req.query.limit) || 0);
    res.json({ count: songs.length, songs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/likes/:userId", requireApiKey, async (req, res) => {
  try {
    const { trackTitle, trackAuthor, trackUrl, trackDuration, artworkUrl, isrc } = req.body;
    const mockTrack = {
      info: { title: trackTitle, author: trackAuthor, uri: trackUrl || "", duration: trackDuration || 0, artworkUrl: artworkUrl || "" },
      pluginInfo: { isrc: isrc || null }
    };
    const added = await db.addLikedSong(req.params.userId, mockTrack);
    res.json({ added });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/likes/:userId", requireApiKey, async (req, res) => {
  try {
    const { trackUrl } = req.body;
    const mockTrack = { info: { uri: trackUrl } };
    const removed = await db.removeLikedSongByTrack(req.params.userId, mockTrack);
    res.json({ removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats/:userId", requireApiKey, async (req, res) => {
  try {
    const stats = await db.getUserStats(req.params.userId);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/playlists/:userId", requireApiKey, async (req, res) => {
  try {
    const guildId = req.query.guildId;
    if (!guildId) return res.status(400).json({ error: "Missing 'guildId'" });
    const guildPlaylists = await db.getGuildPlaylists(guildId);
    const userPlaylists = guildPlaylists.filter(p => p.user_id === req.params.userId);
    res.json({ playlists: userPlaylists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/playlists/:userId", requireApiKey, async (req, res) => {
  try {
    const { guildId, name, tracks } = req.body;
    const id = await db.savePlaylist(guildId, req.params.userId, name, tracks);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { app };
