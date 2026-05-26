const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");
const { requireApiKey, requireAuth } = require("./middleware/auth");
const db = require("../database");
const { DiscordUser } = db;
const { getLyrics } = require("../services/lrclib");
const spotify = require("../services/spotify");
const deezer = require("../services/deezer");
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
app.use(passport.initialize());

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
      album: t.info?.albumName || t.pluginInfo?.albumName || null,
      albumUrl: t.pluginInfo?.albumUrl || null,
    }));

    res.json({ query: q, source, tracks });
  } catch (err) {
    console.error("Search Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/spotify/search", requireApiKey, async (req, res) => {
  try {
    const q = req.query.q;
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);
    if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });
    try {
      const tracks = await spotify.searchTracks(q, limit);
      return res.json({ query: q, tracks, source: "spotify" });
    } catch (spotifyErr) {
      console.warn("Spotify Search failed, falling back to Deezer:", spotifyErr.message);
      const tracks = await deezer.searchTracks(q, limit);
      res.json({ query: q, tracks, source: "deezer" });
    }
  } catch (err) {
    console.error("All Search Sources Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/spotify/search/albums", requireApiKey, async (req, res) => {
  try {
    const q = req.query.q;
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);
    if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });
    try {
      const albums = await spotify.searchAlbums(q, limit);
      return res.json({ query: q, albums, source: "spotify" });
    } catch (spotifyErr) {
      console.warn("Spotify Album Search failed, falling back to Deezer:", spotifyErr.message);
      const albums = await deezer.searchAlbums(q, limit);
      res.json({ query: q, albums, source: "deezer" });
    }
  } catch (err) {
    console.error("All Album Search Sources Error:", err.message);
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

    // Convertir ID a URL de YouTube
    let url = id;
    if (!id.startsWith("http")) {
      url = `https://www.youtube.com/watch?v=${id}`;
    }

    // Intentar yt-dlp si está disponible (fue removido pero lo dejamos por si se reinstala)
    if (resolveWithYtDlp) {
      try {
        const streamUrl = await resolveWithYtDlp(url);
        if (streamUrl) {
          streamCache.set(cacheKey, { url: streamUrl, ts: Date.now() });
          return res.json({ url: streamUrl });
        }
      } catch (e) {}
    }

    // Fallback a play-dl (Principal)
    try {
      // Optimización: Si es un ID de 11 chars, forzar búsqueda o info directa
      const info = await play.video_info(url).catch(async () => {
         // Si video_info falla (ej: video privado/borrado), intentamos buscarlo por título si el App enviara más info,
         // pero aquí solo tenemos el ID. Intentamos una vez más con play.search
         const search = await play.search(id, { limit: 1 });
         return search[0] ? await play.video_info(search[0].url) : null;
      });

      if (info) {
        const stream = await play.stream_from_info(info, {
          quality: 2,
          discordPlayerCompatibility: true
        });
        if (stream?.url) {
          streamCache.set(cacheKey, { url: stream.url, ts: Date.now() });
          return res.json({ url: stream.url });
        }
      }
    } catch (pdErr) {
      console.error(`[play-dl] Error for ${id}:`, pdErr.message);
    }

    res.status(404).json({ error: "No stream found after fallback" });
  } catch (err) {
    console.error("Critical Stream Error:", err.stack);
    res.status(500).json({ error: "Server Internal Error" });
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
    const userId = req.userId || req.params.userId;
    const source = req.provider || "android";
    const songs = await db.getLikedSongs(userId, parseInt(req.query.limit) || 0, source);
    res.json({ count: songs.length, songs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/likes/:userId", requireApiKey, async (req, res) => {
  try {
    const userId = req.userId || req.params.userId;
    const source = req.provider || "android";
    const { trackTitle, trackAuthor, trackUrl, trackDuration, artworkUrl, isrc } = req.body;
    const mockTrack = {
      info: { title: trackTitle, author: trackAuthor, uri: trackUrl || "", duration: trackDuration || 0, artworkUrl: artworkUrl || "" },
      pluginInfo: { isrc: isrc || null }
    };
    const added = await db.addLikedSong(userId, mockTrack, source);
    res.json({ added });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/likes/:userId", requireApiKey, async (req, res) => {
  try {
    const userId = req.userId || req.params.userId;
    const source = req.provider || "android";
    const { trackUrl } = req.body;
    const mockTrack = { info: { uri: trackUrl } };
    const removed = await db.removeLikedSongByTrack(userId, mockTrack, source);
    res.json({ removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats/:userId", requireApiKey, async (req, res) => {
  try {
    const userId = req.userId || req.params.userId;
    const source = req.provider || "android";
    const stats = await db.getUserStats(userId, source);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/playlists/:userId", requireApiKey, async (req, res) => {
  try {
    const userId = req.userId || req.params.userId;
    const source = req.provider || "android";
    const playlists = await db.getUserPlaylists(userId, source);
    res.json({ playlists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/playlists/:userId", requireApiKey, async (req, res) => {
  try {
    const userId = req.userId || req.params.userId;
    const source = req.provider || "android";
    const { name, tracks } = req.body;
    const id = await db.savePlaylist(userId, name, tracks, source);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/artists/:userId", requireApiKey, async (req, res) => {
  try {
    const userId = req.userId || req.params.userId;
    const source = req.provider || "android";
    const artists = await db.getLikedArtists(userId, source);
    res.json({ artists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/artist-image", requireApiKey, async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: "Missing 'name'" });
    const deezerRes = await axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`);
    const url = deezerRes.data?.data?.[0]?.picture_medium || null;
    res.json({ url });
  } catch (err) {
    res.json({ url: null });
  }
});

app.get("/api/recommendations/:userId", requireApiKey, async (req, res) => {
  try {
    const userId = req.userId || req.params.userId;
    const source = req.provider || "android";
    const liked = await db.getLikedSongs(userId, 5, source);
    if (!liked.length) return res.json({ tracks: [] });
    const spotifyTracks = await spotify.searchTracks(`${liked[0].track_title} ${liked[0].track_author}`, 5);
    const seedIds = spotifyTracks.map(t => t.id).filter(Boolean).slice(0, 5);
    const recs = seedIds.length ? await spotify.getRecommendations(seedIds) : [];
    res.json({ tracks: recs });
  } catch (err) {
    res.json({ tracks: [] });
  }
});

app.get("/api/top-tracks/:userId", requireApiKey, async (req, res) => {
  try {
    const userId = req.userId || req.params.userId;
    const source = req.provider || "android";
    const tracks = await db.getMostPlayedTracks(userId, parseInt(req.query.limit) || 10, source);
    res.json({ tracks });
  } catch (err) {
    res.json({ tracks: [] });
  }
});

// ── Auth routes ──────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const JWT_EXPIRES = "30d";

function signToken(user, provider = "android") {
  const payload = { sub: user._id.toString(), provider };
  if (provider === "discord" && user.discordId) {
    payload.discordId = user.discordId;
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// ── Discord OAuth Strategy ────────────────────────────────────────────
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL || "http://192.168.18.81:3000/api/auth/discord/callback",
  scope: ["identify", "email"],
}, async (accessToken, refreshToken, profile, done) => {
  try {
    if (!DiscordUser) return done(new Error("Discord database not configured"));
    let user = await DiscordUser.findOne({ discordId: profile.id });
    if (user) return done(null, user);

    const email = profile.email || null;
    if (email) {
      user = await DiscordUser.findOne({ email });
      if (user) {
        user.discordId = profile.id;
        if (!user.avatar && profile.avatar) user.avatar = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`;
        await user.save();
        return done(null, user);
      }
    }

    user = await DiscordUser.create({
      username: profile.username || profile.global_name || `discord_${profile.id}`,
      email,
      discordId: profile.id,
      avatar: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : "",
    });
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

// ── Google OAuth Strategy ─────────────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback",
  scope: ["profile", "email"],
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // 1. Buscar por googleId
    let user = await User.findOne({ googleId: profile.id });
    if (user) return done(null, user);

    // 2. Si tiene email, buscar si ya existe la cuenta y vincularla
    const email = profile.emails?.[0]?.value || null;
    if (email) {
      user = await User.findOne({ email });
      if (user) {
        user.googleId = profile.id;
        if (!user.avatar && profile.photos?.[0]?.value) {
          user.avatar = profile.photos[0].value;
        }
        await user.save();
        return done(null, user);
      }
    }

    // 3. Crear nuevo usuario
    user = await User.create({
      username: profile.displayName || profile.name?.givenName || `google_${profile.id}`,
      email,
      googleId: profile.id,
      avatar: profile.photos?.[0]?.value || "",
    });
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "username, email, and password are required" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() }).exec();
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const user = await User.create({ username, email: email.toLowerCase(), password });
    const token = signToken(user);
    res.status(201).json({ token, user: user.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).exec();
    if (!user || !user.password) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user);
    res.json({ token, user: user.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const UserModel = req.provider === "discord" && DiscordUser ? DiscordUser : User;
    const user = await UserModel.findById(req.mongoId).exec();
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: user.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Discord OAuth routes ──────────────────────────────────────────────
app.get("/api/auth/discord", passport.authenticate("discord", { session: false }));

app.get("/api/auth/discord/callback", (req, res, next) => {
  passport.authenticate("discord", { session: false }, (err, user) => {
    if (err || !user) {
      const url = process.env.CLIENT_URL || "musicapp://auth";
      return res.redirect(`${url}?error=auth_failed`);
    }
    const token = signToken(user, "discord");
    const url = process.env.CLIENT_URL || "musicapp://auth";
    res.redirect(`${url}?token=${token}`);
  })(req, res, next);
});

// ── Google OAuth routes ───────────────────────────────────────────────
// Endpoint para Android (Native Google Sign-In)
app.post("/api/auth/google", async (req, res) => {
  try {
    const { id_token } = req.body;
    const idToken = id_token || req.body.idToken; // Soporta ambos formatos por si acaso

    if (!idToken) return res.status(400).json({ error: "idToken is required" });

    // Verificar token con Google API (Sin librerías extra)
    const googleRes = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    const payload = googleRes.data;

    if (!payload || googleRes.status !== 200) {
      return res.status(401).json({ error: "Invalid Google token" });
    }

    const { sub: googleId, email, name, picture } = payload;

    // 1. Buscar o vincular usuario
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (!user) {
      user = await User.create({
        username: name || `google_${googleId}`,
        email,
        googleId,
        avatar: picture || "",
      });
    } else if (!user.googleId) {
      user.googleId = googleId;
      if (!user.avatar) user.avatar = picture || "";
      await user.save();
    }

    // 2. Generar JWT y responder
    const token = signToken(user);
    res.json({ token, user: user.toPublicJSON() });

  } catch (err) {
    console.error("[Google Auth POST] Error:", err.response?.data || err.message);
    res.status(401).json({ error: "Google authentication failed" });
  }
});

app.get("/api/auth/google",
  passport.authenticate("google", { session: false, scope: ["profile", "email"] })
);

app.get("/api/auth/google/callback", (req, res, next) => {
  passport.authenticate("google", { session: false }, (err, user) => {
    const clientUrl = process.env.CLIENT_URL || "musicapp://auth";
    if (err || !user) {
      console.error("[Google OAuth] Error:", err?.message);
      return res.redirect(`${clientUrl}?error=auth_failed&provider=google`);
    }
    const token = signToken(user);
    return res.redirect(`${clientUrl}?token=${token}&provider=google`);
  })(req, res, next);
});

// Global error handler
app.use(function (err, req, res, next) {
  console.error("[ERROR] global handler:", err.stack || err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

module.exports = { app };
