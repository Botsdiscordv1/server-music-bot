const express = require("express");
const { requireApiKey } = require("./middleware/auth");
const db = require("../database");
const { getLyrics } = require("../services/lrclib");
const spotify = require("../services/spotify");
const axios = require("axios");
const play = require("play-dl");

const LAVALINK_HOST = process.env.LAVALINK_HOST || "localhost";
const LAVALINK_PORT = Number(process.env.LAVALINK_PORT) || 2333;
const LAVALINK_SECURE = process.env.LAVALINK_SECURE === "true";
const LAVALINK_PROTO = LAVALINK_SECURE ? "https" : "http";
const LAVALINK_AUTH = process.env.LAVALINK_PASSWORD || "youshallnotpass";

const app = express();
app.use(express.json());

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
    res.status(500).json({ error: err.message });
  }
});

// src/api/server.js - Actualizado
app.get("/api/stream", requireApiKey, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing 'id' parameter" });

    // Método más estable para obtener el stream directo
    const stream = await play.stream(id, { quality: 2 });

    res.json({ url: stream.url });
  } catch (err) {
    console.error("Stream Error:", err);
    res.status(500).json({ error: "No se pudo obtener el audio" });
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
    const limit = parseInt(req.query.limit) || 0;
    const songs = await db.getLikedSongs(req.params.userId, limit);
    res.json({ count: songs.length, songs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/likes/:userId", requireApiKey, async (req, res) => {
  try {
    const { trackTitle, trackAuthor, trackUrl, trackDuration, artworkUrl, isrc } = req.body;
    if (!trackTitle || !trackAuthor) {
      return res.status(400).json({ error: "Missing required fields: trackTitle, trackAuthor" });
    }

    const mockTrack = {
      info: {
        title: trackTitle,
        author: trackAuthor,
        uri: trackUrl || "",
        duration: trackDuration || 0,
        artworkUrl: artworkUrl || "",
      },
      pluginInfo: { isrc: isrc || null },
    };

    const added = await db.addLikedSong(req.params.userId, mockTrack);
    res.json({ added });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/likes/:userId/:id", requireApiKey, async (req, res) => {
  try {
    const removed = await db.removeLikedSong(req.params.userId, parseInt(req.params.id));
    if (!removed) return res.status(404).json({ error: "Like not found" });
    res.json({ removed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/likes/:userId", requireApiKey, async (req, res) => {
  try {
    const { trackUrl } = req.body;
    if (!trackUrl) return res.status(400).json({ error: "Missing 'trackUrl'" });

    const mockTrack = { info: { uri: trackUrl } };
    const removed = await db.removeLikedSongByTrack(req.params.userId, mockTrack);
    res.json({ removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/likes/:userId/all", requireApiKey, async (req, res) => {
  try {
    const count = await db.removeAllLikedSongs(req.params.userId);
    res.json({ removed: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/artists/:userId", requireApiKey, async (req, res) => {
  try {
    const artists = await db.getLikedArtists(req.params.userId);
    res.json({ artists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats/:userId", requireApiKey, async (req, res) => {
  try {
    const stats = await db.getUserStats(req.params.userId);
    if (!stats) return res.json({ stats: null });
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats/top", requireApiKey, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const top = await db.getTopListeners(limit);
    res.json({ top });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/top-tracks/:userId", requireApiKey, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const tracks = await db.getMostPlayedTracks(req.params.userId, limit);
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/recommendations/:userId", requireApiKey, async (req, res) => {
  try {
    const liked = await db.getLikedSongs(req.params.userId, 5);
    if (!liked.length) return res.json({ tracks: [] });

    const spotifyIds = liked.map(s => s.isrc).filter(Boolean);
    if (!spotifyIds.length) return res.json({ tracks: [] });

    const spotifyTracks = await spotify.searchTracks(
      `${liked[0].track_title} ${liked[0].track_author}`,
      5
    );
    const seedIds = spotifyTracks.map(t => t.id).filter(Boolean).slice(0, 5);
    if (!seedIds.length) return res.json({ tracks: [] });

    const recs = await spotify.getRecommendations(seedIds);
    res.json({ tracks: recs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/spotify/search", requireApiKey, async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: "Missing 'q' parameter" });
    const limit = parseInt(req.query.limit) || 5;
    const tracks = await spotify.searchTracks(q, limit);
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/playlists/:userId", requireApiKey, async (req, res) => {
  try {
    const guildId = req.query.guildId;
    if (!guildId) return res.status(400).json({ error: "Missing 'guildId' query" });

    if (req.query.name) {
      const playlists = await db.getUserPlaylists(guildId, req.params.userId);
      res.json({ playlists });
    } else {
      const guildPlaylists = await db.getGuildPlaylists(guildId);
      const userPlaylists = guildPlaylists.filter(p => p.user_id === req.params.userId);
      res.json({ playlists: userPlaylists });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/playlists/:userId", requireApiKey, async (req, res) => {
  try {
    const { guildId, name, tracks } = req.body;
    if (!guildId || !name || !tracks) {
      return res.status(400).json({ error: "Missing required fields: guildId, name, tracks" });
    }
    const id = await db.savePlaylist(guildId, req.params.userId, name, tracks);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/playlists/:userId/:index", requireApiKey, async (req, res) => {
  try {
    const guildId = req.query.guildId;
    if (!guildId) return res.status(400).json({ error: "Missing 'guildId' query" });
    const result = await db.deletePlaylist(parseInt(req.params.index), guildId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history/:guildId", requireApiKey, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = await db.getHistory(req.params.guildId, limit);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tts", requireApiKey, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: "Missing 'text' parameter" });

    const { getTTSUrl } = require("../utils/ttsService");
    const url = getTTSUrl(text);

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return res.status(502).json({ error: `TTS provider returned ${response.status}` });

    const buffer = Buffer.from(await response.arrayBuffer());
    res.set("Content-Type", "audio/mpeg");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function startApi(port) {
  return new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`[API] Music API running on port ${port}`);
      resolve();
    });
  });
}

module.exports = { app, startApi };
