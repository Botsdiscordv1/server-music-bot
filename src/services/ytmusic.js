const YouTubeMusic = require("youtube-music-api");

let api = null;
let initPromise = null;
let refreshPromise = null;
let refreshInterval = null;

async function getApi() {
  if (api) return api;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const instance = new YouTubeMusic();
    await instance.initalize();
    api = instance;
    startRefreshTimer();
    return api;
  })();
  return initPromise;
}

function startRefreshTimer() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(async () => {
    try {
      await api.initalize();
      console.log("[YTMusic] Config refreshed (periodic)");
    } catch (e) {
      console.warn(`[YTMusic] Periodic refresh failed: ${e.message}`);
    }
  }, 15 * 60 * 1000);
  if (refreshInterval.unref) refreshInterval.unref();
}

async function refreshApi() {
  if (!api) return getApi();
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      await api.initalize();
    } catch (e) {
      console.warn(`[YTMusic] Refresh failed, recreating instance: ${e.message}`);
      api = null;
      initPromise = null;
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
      return getApi();
    }
    return api;
  })();
  const result = await refreshPromise;
  refreshPromise = null;
  return result;
}

async function withRetry(fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is403 = err?.response?.status === 403;
      if (is403) {
        console.warn(`[YTMusic] 403 — YouTube bloqueó InnerTube, fallback a Lavalink`);
        return null;
      }
      console.warn(`[YTMusic] InnerTube error (attempt ${attempt + 1}/3): ${err.message}`);
      if (attempt === 2) {
        console.error(`[YTMusic] All retries exhausted`);
        return null;
      }
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      await refreshApi();
    }
  }
  return null;
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
  const query = `${artist || ""} ${title || ""}`.trim();
  if (!query) return null;
  const result = await withRetry(async () => {
    const ytm = await getApi();
    return await ytm.search(query, "song");
  });
  if (!result) return null;
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
}

async function searchQuery(query, type = "song") {
  if (!query) return [];
  const result = await withRetry(async () => {
    const ytm = await getApi();
    return await ytm.search(query, type);
  });
  if (!result) return [];
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
