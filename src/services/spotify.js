const axios = require("axios");

const LAVALINK_HOST = process.env.LAVALINK_HOST || "localhost";
const LAVALINK_PORT = Number(process.env.LAVALINK_PORT) || 2333;
const LAVALINK_SECURE = process.env.LAVALINK_SECURE === "true";
const LAVALINK_PROTO = LAVALINK_SECURE ? "https" : "http";
const LAVALINK_AUTH = process.env.LAVALINK_PASSWORD || "youshallnotpass";

// ── Spotify Web API direct (OAuth Client Credentials) ─────────────
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
let spotifyToken = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;
  try {
    const res = await axios.post("https://accounts.spotify.com/api/token",
      "grant_type=client_credentials",
      {
        headers: {
          "Authorization": "Basic " + Buffer.from(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000,
      }
    );
    spotifyToken = res.data.access_token;
    spotifyTokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
    return spotifyToken;
  } catch (err) {
    console.error("[Spotify API] Token error:", err.message);
    throw err;
  }
}

async function spotifyFetch(endpoint) {
  const token = await getSpotifyToken();
  const res = await axios.get(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  });
  return res.data;
}

async function searchArtistsDirect(query, limit = 5) {
  const data = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=artist&limit=${Math.min(limit, 50)}`);
  return (data.artists?.items || []).map(a => ({
    id: a.id,
    name: a.name,
    image: a.images?.[0]?.url || null,
    genres: a.genres || [],
    popularity: a.popularity,
    followers: a.followers?.total || 0,
    uri: a.uri,
    externalUrl: a.external_urls?.spotify || null,
  }));
}

async function getArtistInfo(artistId) {
  const a = await spotifyFetch(`/artists/${artistId}`);
  return {
    id: a.id,
    name: a.name,
    images: a.images || [],
    genres: a.genres || [],
    popularity: a.popularity,
    followers: a.followers?.total || 0,
    uri: a.uri,
    externalUrl: a.external_urls?.spotify || null,
  };
}

async function getArtistDescription(name) {
  if (!name) return null;
  // Intentar Wikipedia primero (directo y con búsqueda)
  const wikiResult = await tryWikipediaDescription(name);
  if (wikiResult) return wikiResult;

  // Fallback: DuckDuckGo Instant Answer API
  try {
    const ddg = await axios.get("https://api.duckduckgo.com/", {
      params: { q: name + " music", format: "json", no_html: 1, skip_disambig: 1 },
      timeout: 5000,
    });
    const data = ddg.data;
    if (data.Abstract) {
      return { description: data.Abstract, source: "duckduckgo", url: data.AbstractURL || null };
    }
  } catch {}

  return null;
}

async function tryWikipediaDescription(name) {
  try {
    const res = await axios.get("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(name), {
      timeout: 6000,
      headers: { "User-Agent": "ServerMusic/2.0" },
    });
    if (res.data && res.data.extract && !res.data.extract.includes("may refer to")) {
      return {
        description: res.data.extract,
        source: "wikipedia",
        url: res.data.content_urls?.desktop?.page || null,
      };
    }
  } catch {}
  // fallback: search wikipedia
  try {
    const searchRes = await axios.get("https://en.wikipedia.org/w/api.php", {
      params: {
        action: "query", list: "search", srsearch: name + " musician",
        format: "json", srlimit: 1,
      },
      timeout: 6000,
    });
    const title = searchRes.data?.query?.search?.[0]?.title;
    if (title) {
      const res2 = await axios.get("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title), {
        timeout: 6000,
        headers: { "User-Agent": "ServerMusic/2.0" },
      });
      if (res2.data?.extract) {
        return {
          description: res2.data.extract,
          source: "wikipedia",
          url: res2.data.content_urls?.desktop?.page || null,
        };
      }
    }
  } catch {}
  return null;
}

async function searchArtistDeezer(name) {
  if (!name) return null;
  try {
    const res = await axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`, { timeout: 5000 });
    const artist = (res.data?.data || []).map(a => ({
      id: String(a.id),
      name: a.name,
      image: a.picture_medium || null,
      imageBig: a.picture_big || null,
      imageXl: a.picture_xl || null,
      fans: a.nb_fan || 0,
      albums: a.nb_album || 0,
      tracklist: a.tracklist || null,
    }))[0] || null;

    // Si Deezer no encontró el artista o no tiene imagen, buscar imagen vía YTM/Lavalink
    if (!artist || !artist.image) {
      const ytmImage = await searchArtistImageYTM(name);
      if (ytmImage) {
        if (artist) {
          artist.image = ytmImage;
          artist.imageBig = ytmImage;
        } else {
          return { id: null, name, image: ytmImage, imageBig: ytmImage, imageXl: ytmImage, fans: 0, albums: 0, tracklist: null };
        }
      }
    }
    return artist;
  } catch {
    const ytmImage = await searchArtistImageYTM(name);
    if (ytmImage) {
      return { id: null, name, image: ytmImage, imageBig: ytmImage, imageXl: ytmImage, fans: 0, albums: 0, tracklist: null };
    }
    return null;
  }
}

async function searchArtistImageYTM(name) {
  if (!name) return null;
  try {
    const url = `${LAVALINK_PROTO}://${LAVALINK_HOST}:${LAVALINK_PORT}/v4/loadtracks?identifier=${encodeURIComponent("ytmsearch:" + name + " artist")}`;
    const response = await axios.get(url, {
      headers: { Authorization: LAVALINK_AUTH },
      timeout: 10000,
    });
    const tracks = response.data?.data || [];
    // Buscar el track cuyo autor coincida exactamente (sin distinguir mayúsculas)
    const nameLower = name.toLowerCase();
    const match = tracks.find(t => t.info?.author?.toLowerCase() === nameLower)
      || tracks.find(t => t.info?.author?.toLowerCase().includes(nameLower))
      || tracks[0];
    return match?.info?.artworkUrl || null;
  } catch {
    return null;
  }
}

async function searchLavalink(source, query, limit = 5) {
  const url = `${LAVALINK_PROTO}://${LAVALINK_HOST}:${LAVALINK_PORT}/v4/loadtracks?identifier=${encodeURIComponent(source + ":" + query)}`;
  const response = await axios.get(url, {
    headers: { Authorization: LAVALINK_AUTH },
    timeout: 15000,
  });
  return (response.data?.data || []).slice(0, limit).map(formatLavalinkTrack);
}

function isExplicit(title, author) {
  const text = `${title || ""} ${author || ""}`.toLowerCase();
  return /\bexplicit\b/.test(text) && !/\bclean\b/.test(text);
}

function formatLavalinkTrack(t) {
  const title = t.info?.title || "";
  const author = t.info?.author || "";
  return {
    id: t.info?.identifier,
    title,
    artist: author,
    album: t.info?.albumName || t.pluginInfo?.albumName || null,
    thumbnail: t.info?.artworkUrl,
    duration: t.info?.duration,
    uri: t.info?.uri,
    isrc: t.info?.isrc || null,
    explicit: isExplicit(title, author),
    genres: [],
  };
}

async function searchLavalink(source, query, limit = 5) {
  const url = `${LAVALINK_PROTO}://${LAVALINK_HOST}:${LAVALINK_PORT}/v4/loadtracks?identifier=${encodeURIComponent(source + ":" + query)}`;
  const response = await axios.get(url, {
    headers: { Authorization: LAVALINK_AUTH },
    timeout: 15000,
  });
  const tracks = (response.data?.data || []).slice(0, limit).map(formatLavalinkTrack);
  await enrichExplicitWithDeezerISRC(tracks);
  return tracks;
}

async function enrichExplicitWithDeezerISRC(tracks) {
  const lookups = tracks
    .filter(t => t.isrc)
    .map(async (track) => {
      try {
        const res = await axios.get(`https://api.deezer.com/track/isrc:${track.isrc}`, { timeout: 3000 });
        if (res.data?.explicit_lyrics !== undefined) track.explicit = res.data.explicit_lyrics;
      } catch (e) {}
    });
  await Promise.allSettled(lookups);
}

function formatLavalinkTrack(t) {
  const title = t.info?.title || "";
  const author = t.info?.author || "";
  return {
    id: t.info?.identifier,
    title,
    artist: author,
    album: t.info?.albumName || t.pluginInfo?.albumName || null,
    thumbnail: t.info?.artworkUrl,
    duration: t.info?.duration,
    uri: t.info?.uri,
    isrc: t.info?.isrc || null,
    explicit: isExplicit(title, author),
    genres: [],
  };
}

async function searchTracks(query, limit = 5) {
  return searchLavalink("ytmsearch", query, limit);
}

async function searchAlbums(query, limit = 5) {
  const tracks = await searchLavalink("ytmsearch", query, limit * 2);
  const seen = new Set();
  const albums = [];
  for (const t of tracks) {
    const key = t.album || t.title;
    if (!seen.has(key) && albums.length < limit) {
      seen.add(key);
      albums.push({
        id: t.id,
        name: t.album || t.title,
        artists: t.artist,
        image: t.thumbnail,
        releaseDate: null,
        totalTracks: 0,
        uri: t.uri,
      });
    }
  }
  return albums;
}

async function searchArtists(query, limit = 3) {
  const tracks = await searchLavalink("ytmsearch", query, limit);
  const seen = new Set();
  const artists = [];
  for (const t of tracks) {
    if (!seen.has(t.artist) && artists.length < limit) {
      seen.add(t.artist);
      artists.push({
        id: t.id,
        name: t.artist,
        image: t.thumbnail,
        genres: [],
      });
    }
  }
  return artists;
}

async function getTrack(trackId) {
  const query = trackId.replace(/^ytmsearch:/, "");
  const tracks = await searchLavalink("ytmsearch", query, 1);
  return tracks[0] || null;
}

async function getPlaylist(playlistId) {
  const query = playlistId;
  return searchLavalink("ytmsearch", query, 50);
}

async function getRecommendations(seedTrackIds = [], seedArtistIds = [], seedGenres = []) {
  const query = seedTrackIds.slice(0, 1).join(" ") || seedArtistIds.slice(0, 1).join(" ") || "music";
  const tracks = await searchLavalink("ytmsearch", query, 10);
  return tracks.filter(t => !seedTrackIds.includes(t.uri));
}

async function getAudioFeatures(trackIds) {
  return trackIds.map(() => null);
}

async function getSeveralTracks(trackIds) {
  return trackIds.slice(0, 50).flatMap(() => []);
}

async function getArtists(artistIds) {
  return artistIds.map(() => ({ id: null, name: "", genres: [] }));
}

async function getArtistTopTracks(artistId) {
  const tracks = await searchLavalink("ytmsearch", artistId, 10);
  return tracks;
}

async function getTrackOembed(url) {
  const tracks = await searchLavalink("ytmsearch", url, 1);
  if (tracks.length) {
    return { title: tracks[0].title, artist: tracks[0].artist, thumbnail: tracks[0].thumbnail };
  }
  return { title: null, artist: null, thumbnail: null };
}

function cleanArtistName(name) {
  return name.split(/[,;&/]|feat\.|ft\.|Feat\.|Ft\./)[0].replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "").trim();
}

async function getArtistImage(name) {
  const cleanName = cleanArtistName(name);
  if (!cleanName) return null;
  try {
    const deezerRes = await axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}&limit=1`, { timeout: 5000 });
    return deezerRes.data?.data?.[0]?.picture_medium || null;
  } catch {
    return null;
  }
}

module.exports = {
  searchTracks,
  searchAlbums,
  searchArtists,
  getArtistImage,
  getTrack,
  getPlaylist,
  getRecommendations,
  getAudioFeatures,
  getSeveralTracks,
  getArtists,
  getArtistTopTracks,
  getTrackOembed,
  searchArtistsDirect,
  getArtistInfo,
  getArtistDescription,
  searchArtistDeezer,
};
