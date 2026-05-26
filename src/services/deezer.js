const axios = require("axios");

const api = axios.create({
  baseURL: "https://api.deezer.com",
  timeout: 10000,
});

/**
 * Search tracks on Deezer (free, no auth required).
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{ id: string, title: string, artist: string, album: string, thumbnail: string, duration: number, uri: string }>}
 */
async function searchTracks(query, limit = 5) {
  const res = await api.get("/search/track", {
    params: { q: query, limit },
  });
  return (res.data.data || []).map(formatTrack);
}

/**
 * Search albums on Deezer.
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{ id: string, name: string, artists: string, image: string, releaseDate: string, totalTracks: number, uri: string }>}
 */
async function searchAlbums(query, limit = 5) {
  const res = await api.get("/search/album", {
    params: { q: query, limit },
  });
  return (res.data.data || []).map((a) => ({
    id: String(a.id),
    name: a.title,
    artists: a.artist?.name || "Unknown",
    image: a.cover_medium || a.cover || null,
    releaseDate: a.release_date || null,
    totalTracks: a.nb_tracks || 0,
    uri: `deezer:album:${a.id}`,
  }));
}

function formatTrack(track) {
  const genres = track.album?.genres?.data?.map(g => g.name) || [];
  return {
    id: String(track.id),
    title: track.title,
    artist: track.artist?.name || "Unknown",
    artistId: track.artist?.id ? String(track.artist.id) : null,
    album: track.album?.title || null,
    thumbnail: track.album?.cover_medium || track.album?.cover || null,
    duration: (track.duration || 0) * 1000,
    uri: `deezer:track:${track.id}`,
    isrc: track.isrc || null,
    previewUrl: track.preview || null,
    explicit: track.explicit_lyrics === true,
    genres,
  };
}

module.exports = {
  searchTracks,
  searchAlbums,
};
