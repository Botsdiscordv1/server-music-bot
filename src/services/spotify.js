const axios = require("axios");

const LAVALINK_HOST = process.env.LAVALINK_HOST || "localhost";
const LAVALINK_PORT = Number(process.env.LAVALINK_PORT) || 2333;
const LAVALINK_SECURE = process.env.LAVALINK_SECURE === "true";
const LAVALINK_PROTO = LAVALINK_SECURE ? "https" : "http";
const LAVALINK_AUTH = process.env.LAVALINK_PASSWORD || "youshallnotpass";

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
};
