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

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "music-api" });
});

// Pre-resuelve un query de búsqueda antes de que el usuario toque
app.get("/api/prewarm", requireApiKey, async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 3) return res.json({ url: null });

  const cacheKey = "prewarm:" + q;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL) {
    return res.json({ url: cached.url });
  }

  if (!resolveWithYtDlp) return res.json({ url: null });

  try {
    const searchUrl = `ytsearch1:${q}`;
    const result = await require("@distube/yt-dlp").raw(searchUrl, {
      format: "bestaudio",
      noWarnings: true,
      getUrl: true,
    });
    const url = result.stdout.toString().trim();
    if (url) streamCache.set(cacheKey, { url, ts: Date.now() });
    res.json({ url });
  } catch {
    res.json({ url: null });
  }
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

    // Background pre-resolve top 3 tracks
    if (resolveWithYtDlp) {
      for (const track of tracks.slice(0, 3)) {
        const cacheKey = track.uri?.match(/v=([^&]+)/)?.[1] || "";
        if (cacheKey && !streamCache.has(cacheKey)) {
          resolveWithYtDlp(track.uri).then(url => {
            if (url) streamCache.set(cacheKey, { url, ts: Date.now() });
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ENDPOINT ÚNICO Y OPTIMIZADO
app.get("/api/stream", requireApiKey, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id || id === "undefined" || id === "null" || id.trim() === "") {
      return res.status(400).json({ error: "Missing or invalid 'id' parameter" });
    }

    const cacheKey = id.trim();
    const cached = streamCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL) {
      console.log("[API/stream] Cache hit:", cacheKey);
      return res.json({ url: cached.url });
    }

    console.log("[API/stream] Request ID:", id);

    const url = (id.startsWith("http://") || id.startsWith("https://"))
      ? id
      : `https://www.youtube.com/watch?v=${id}`;

    console.log("[API/stream] Resolviendo stream para:", url);

    // 1. Try yt-dlp (fast, ~1-3s)
    if (resolveWithYtDlp) {
      try {
        const streamUrl = await resolveWithYtDlp(url);
        if (streamUrl) {
          streamCache.set(cacheKey, { url: streamUrl, ts: Date.now() });
          console.log("[API/stream] yt-dlp success:", cacheKey);
          return res.json({ url: streamUrl });
        }
      } catch (ytErr) {
        console.warn("[API/stream] yt-dlp failed:", ytErr.message);
      }
    }

    // 2. Fallback to play-dl
    console.log("[API/stream] Fallback to play-dl");
    try {
      const info = await play.video_info(url);
      const stream = await play.stream_from_info(info, { quality: 2 });
      if (stream?.url) {
        streamCache.set(cacheKey, { url: stream.url, ts: Date.now() });
        console.log("[API/stream] play-dl cached:", cacheKey);
        return res.json({ url: stream.url });
      }
    } catch (pdErr) {
      console.warn("[API/stream] play-dl failed:", pdErr.message);
    }

    // 3. Last resort: try play-dl with soundcloud quality fallback
    try {
      const stream = await play.stream(url, { quality: 1, seek: 0 });
      if (stream?.url) {
        streamCache.set(cacheKey, { url: stream.url, ts: Date.now() });
        return res.json({ url: stream.url });
      }
    } catch (pdErr2) {
      console.warn("[API/stream] play-dl last resort failed:", pdErr2.message);
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

app.get("/api/artist-image", requireApiKey, async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: "Missing 'name' parameter" });
    const url = await spotify.getArtistImage(name);
    res.json({ url });
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
