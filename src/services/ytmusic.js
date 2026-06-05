const YouTubeMusic = require("youtube-music-api");

let api = null;
let initPromise = null;

async function getApi() {
  if (api) return api;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const instance = new YouTubeMusic();
    await instance.initalize();
    api = instance;
    return api;
  })();
  return initPromise;
}

function extractArtists(item) {
  if (!item.artist) return [];
  if (Array.isArray(item.artist)) return item.artist.map(a => a.name).filter(Boolean);
  if (typeof item.artist === "object" && item.artist.name) return [item.artist.name];
  return [];
}

function cleanThumbnail(thumbnails) {
  if (!thumbnails || !thumbnails.length) return null;
  const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0].url;
}

async function searchTrack(artist, title) {
  try {
    const ytm = await getApi();
    const query = `${artist || ""} ${title || ""}`.trim();
    if (!query) return null;
    const result = await ytm.search(query, "song");
    const items = result.content || [];
    const songs = items
      .filter(t => t.type === "song")
      .map(t => ({
        videoId: t.videoId,
        title: t.name,
        authors: extractArtists(t),
        artist: extractArtists(t)[0] || "",
        album: t.album?.name || null,
        duration: t.duration,
        thumbnail: cleanThumbnail(t.thumbnails),
        source: "youtube_music",
      }));
    return songs.length ? songs : null;
  } catch {
    return null;
  }
}

async function searchQuery(query, type = "song") {
  try {
    const ytm = await getApi();
    if (!query) return [];
    const result = await ytm.search(query, type);
    const items = result.content || [];
    return items
      .filter(t => t.type === "song")
      .map(t => ({
        videoId: t.videoId,
        title: t.name,
        artist: extractArtists(t)[0] || "",
        authors: extractArtists(t),
        album: t.album?.name || null,
        duration: t.duration,
        artworkUrl: cleanThumbnail(t.thumbnails),
        thumbnail: cleanThumbnail(t.thumbnails),
        uri: `https://www.youtube.com/watch?v=${t.videoId}`,
        source: "youtube",
        isrc: null,
        explicit: false,
      }));
  } catch {
    return [];
  }
}

async function enrichTracks(tracks) {
  if (!tracks || !tracks.length) return tracks;
  const limit = Math.min(tracks.length, 6);
  const enriched = [...tracks];
  for (let i = 0; i < limit; i++) {
    const track = enriched[i];
    const title = track.title || track.track_title;
    const artist = track.artist || track.author || track.track_author;
    if (!title) continue;
    try {
      const results = await searchTrack(artist, title);
      if (results && results.length > 0) {
        const best = results[0];
        enriched[i].title = best.title;
        enriched[i].artist = best.artist;
        enriched[i].authors = best.authors;
        if (best.thumbnail) {
          enriched[i].artworkUrl = best.thumbnail;
          enriched[i].thumbnail = best.thumbnail;
        }
        if (best.duration) enriched[i].duration = best.duration;
        enriched[i].ytVideoId = best.videoId;
      }
    } catch {}
  }
  return enriched;
}

module.exports = { searchTrack, searchQuery, enrichTracks };
