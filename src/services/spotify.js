const axios = require("axios");

let accessToken = null;
let tokenExpiry = 0;

/**
 * Get a valid Spotify access token using Client Credentials flow.
 * Automatically refreshes when expired.
 */
async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await axios.post(
    "https://accounts.spotify.com/api/token",
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  accessToken = res.data.access_token;
  tokenExpiry = Date.now() + res.data.expires_in * 1000 - 5000;
  return accessToken;
}

/**
 * Search for tracks on Spotify.
 * @param {string} query
 * @param {number} limit
 * @returns {SpotifyTrack[]}
 */
async function searchTracks(query, limit = 5) {
  const token = await getAccessToken();
  const res = await axios.get("https://api.spotify.com/v1/search", {
    headers: { Authorization: `Bearer ${token}` },
    params: { q: query, type: "track", limit },
  });
  return res.data.tracks.items.map(formatTrack);
}

/**
 * Get a single track by Spotify ID or URI.
 * @param {string} trackId
 * @returns {SpotifyTrack}
 */
async function getTrack(trackId) {
  const token = await getAccessToken();
  const id = trackId.replace("spotify:track:", "");
  const res = await axios.get(`https://api.spotify.com/v1/tracks/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return formatTrack(res.data);
}

/**
 * Get all tracks in a Spotify playlist.
 * @param {string} playlistId
 * @returns {SpotifyTrack[]}
 */
async function getPlaylist(playlistId) {
  const token = await getAccessToken();
  const id = playlistId.replace("spotify:playlist:", "");
  let tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`;

  while (url) {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    tracks = tracks.concat(
      res.data.items
        .filter((item) => item.track)
        .map((item) => formatTrack(item.track))
    );
    url = res.data.next;
  }
  return tracks;
}

/**
 * Get Spotify recommendations based on seed tracks.
 * @param {string[]} seedTrackIds  Up to 5 Spotify track IDs
 * @returns {SpotifyTrack[]}
 */
async function getRecommendations(seedTrackIds) {
  const token = await getAccessToken();
  const seeds = seedTrackIds.slice(0, 5).join(",");
  const res = await axios.get("https://api.spotify.com/v1/recommendations", {
    headers: { Authorization: `Bearer ${token}` },
    params: { seed_tracks: seeds, limit: 10 },
  });
  return res.data.tracks.map(formatTrack);
}

/**
 * Get an artist's top tracks.
 * @param {string} artistId
 * @returns {SpotifyTrack[]}
 */
async function getArtistTopTracks(artistId) {
  const token = await getAccessToken();
  const res = await axios.get(
    `https://api.spotify.com/v1/artists/${artistId}/top-tracks`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { market: "US" },
    }
  );
  return res.data.tracks.map(formatTrack);
}

/**
 * @typedef {Object} SpotifyTrack
 * @property {string} id
 * @property {string} title
 * @property {string} artist
 * @property {string} album
 * @property {string} thumbnail
 * @property {number} duration   - in milliseconds
 * @property {string} uri        - spotify:track:xxx
 * @property {string} isrc
 * @property {string} previewUrl
 */

function formatTrack(track) {
  return {
    id: track.id,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    artistId: track.artists[0]?.id,
    album: track.album?.name,
    thumbnail: track.album?.images?.[0]?.url,
    duration: track.duration_ms,
    uri: track.uri,
    isrc: track.external_ids?.isrc,
    previewUrl: track.preview_url,
  };
}

/**
 * Get track info using Spotify's public oEmbed endpoint (no auth required).
 * @param {string} url - Spotify track URL (e.g. https://open.spotify.com/track/xxx)
 * @returns {{ title: string, artist: string, thumbnail: string }}
 */
async function getTrackOembed(url) {
  const res = await axios.get("https://open.spotify.com/oembed", {
    params: { url },
  });

  let artist = res.data.author_name || "";

  if (!artist) {
    try {
      const trackId = url.match(/track\/([A-Za-z0-9]+)/)?.[1];
      if (trackId) {
        const embedRes = await axios.get(
          `https://open.spotify.com/embed/track/${trackId}`,
          { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 5000 }
        );
        const jsonMatch = embedRes.data.match(
          /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/
        );
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[1]);
          const artists = data?.props?.pageProps?.state?.data?.entity?.artists;
          if (artists?.length) {
            artist = artists.map((a) => a.name).join(", ");
          }
        }
      }
    } catch (err) {
      console.error("[Spotify] Embed fallback error:", err.message);
    }
  }

  return {
    title: res.data.title,
    artist,
    thumbnail: res.data.thumbnail_url,
  };
}

module.exports = {
  searchTracks,
  getTrack,
  getPlaylist,
  getRecommendations,
  getArtistTopTracks,
  getTrackOembed,
};
