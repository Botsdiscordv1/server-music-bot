const tough = require("tough-cookie");
const axios = require("axios");
const querystring = require("querystring");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const YTM_BASE = "https://music.youtube.com";
const YT_BASE = "https://www.youtube.com";
const API_VERSION = "v1";

let config = null;
let initPromise = null;
let refreshInterval = null;
let cookieJar = new tough.CookieJar();
const requestCounts = { search: 0, player: 0 };
let lastReset = Date.now();

function checkRateLimit(endpoint) {
  const now = Date.now();
  if (now - lastReset > 1000) {
    requestCounts.search = 0;
    requestCounts.player = 0;
    lastReset = now;
  }
  requestCounts[endpoint] = (requestCounts[endpoint] || 0) + 1;
  const limits = { search: 10, player: 3 };
  if (requestCounts[endpoint] > limits[endpoint]) {
    throw new Error(`Rate limited: ${endpoint} (${limits[endpoint]}/s)`);
  }
}

const playerCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

async function initialize() {
  if (config) return config;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const res = await axios.get(`${YTM_BASE}/`, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US" },
        timeout: 10000,
      });
      cookieJar = new tough.CookieJar();
      const setCookie = res.headers["set-cookie"];
      if (setCookie) {
        const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
        cookies.forEach(c => {
          try { cookieJar.setCookieSync(tough.Cookie.parse(c), YTM_BASE); } catch {}
        });
      }
      let ytcfg = {};
      res.data.split("ytcfg.set(").forEach(v => {
        try { Object.assign(ytcfg, JSON.parse(v.split(");")[0])); } catch {}
      });
      if (!ytcfg.INNERTUBE_API_KEY) throw new Error("Could not extract ytcfg from YouTube Music");
      config = {
        apiKey: ytcfg.INNERTUBE_API_KEY,
        apiVersion: ytcfg.INNERTUBE_API_VERSION || API_VERSION,
        clientName: ytcfg.INNERTUBE_CLIENT_NAME || "WEB_REMUX",
        clientNameValue: ytcfg.INNERTUBE_CONTEXT_CLIENT_NAME || 67,
        clientVersion: ytcfg.INNERTUBE_CLIENT_VERSION,
        visitorData: ytcfg.VISITOR_DATA,
        hl: ytcfg.HL || "en",
        gl: ytcfg.GL || "US",
      };
      startRefreshTimer();
      return config;
    } catch (err) {
      initPromise = null;
      throw err;
    }
  })();
  return initPromise;
}

function startRefreshTimer() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(async () => {
    try {
      initPromise = null;
      config = null;
      playerCache.clear();
      await initialize();
      console.log("[InnerTube] Config refreshed");
    } catch (e) {
      console.warn(`[InnerTube] Periodic refresh failed: ${e.message}`);
    }
  }, 30 * 60 * 1000);
  if (refreshInterval.unref) refreshInterval.unref();
}

function buildContext() {
  return {
    client: {
      clientName: config.clientName,
      clientVersion: config.clientVersion,
      hl: config.hl,
      gl: config.gl,
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      visitorData: config.visitorData || undefined,
    },
    capabilities: {},
    request: {
      internalExperimentFlags: [],
      sessionIndex: {},
    },
    user: { enableSafetyMode: false },
  };
}

function buildHeaders() {
  const cookies = cookieJar.getCookieStringSync(YTM_BASE);
  const h = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "en-US",
    "Content-Type": "application/json",
    "X-YouTube-Client-Name": String(config.clientNameValue),
    "X-YouTube-Client-Version": config.clientVersion,
    "X-Goog-Visitor-Id": config.visitorData || "",
    "X-Origin": YTM_BASE,
  };
  if (cookies) h["Cookie"] = cookies;
  return h;
}

async function apiRequest(endpoint, data, query = {}) {
  checkRateLimit(endpoint);
  const cfg = await initialize();
  const url = `${YTM_BASE}/youtubei/${cfg.apiVersion}/${endpoint}?${querystring.stringify({ alt: "json", key: cfg.apiKey, ...query })}`;
  const body = { ...data, context: buildContext() };
  try {
    const res = await axios.post(url, body, {
      headers: buildHeaders(),
      timeout: 10000,
      responseType: "json",
      transitional: { clarifyTimeoutError: true },
    });
    if (typeof res.data !== "object" || res.data === null) {
      throw new Error("Non-JSON response from InnerTube (likely blocking/CAPTCHA)");
    }
    return res.data;
  } catch (err) {
    if (err.response) {
      console.warn(`[InnerTube] ${endpoint} HTTP ${err.response.status}: ${err.response.statusText}`);
      if (err.response.status === 403 || err.response.status === 401) {
        config = null;
        initPromise = null;
      }
    }
    throw err;
  }
}

function extractArtists(item) {
  if (!item.artist) return [];
  if (Array.isArray(item.artist)) return item.artist.map(a => a.name).filter(Boolean);
  if (typeof item.artist === "object" && item.artist.name) return [item.artist.name];
  if (item.artists && Array.isArray(item.artists)) return item.artists.map(a => a.name).filter(Boolean);
  return [];
}

function cleanThumbnail(thumbnails) {
  if (!thumbnails || !thumbnails.length) return null;
  const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || null;
}

async function searchQuery(query, type = "song") {
  if (!query) return [];
  try {
    const data = await apiRequest("search", { query, params: getSearchParams(type) });
    const items = parseSearchResults(data, type);
    return items;
  } catch (err) {
    console.warn(`[InnerTube] Search failed for "${query?.slice(0, 40)}": ${err.message}${err.response ? ` (${err.response.status})` : ""}`);
    return [];
  }
}

function getSearchParams(type) {
  const params = {
    song: "Eg-KAQwIARAAGAAgACgAMABqChAEEAMQCRAFEAo=",
    video: "Eg-KAQwIABABGAAgACgAMABqChAEEAMQCRAFEAo=",
    album: "Eg-KAQwIABAAGAEgACgAMABqChAEEAMQCRAFEAo=",
    artist: "Eg-KAQwIABAAGAAgASgAMABqChAEEAMQCRAFEAo=",
    playlist: "Eg-KAQwIABAAGAAgACgBMABqChAEEAMQCRAFEAo=",
  };
  return params[type] || "";
}

function parseSearchResults(data, type) {
  if (!data?.contents?.tabbedSearchResultsRenderer?.tabs) return [];
  const tabs = data.contents.tabbedSearchResultsRenderer.tabs;
  for (const tab of tabs) {
    const content = tab?.tabRenderer?.content;
    if (!content) continue;
    const sections = content?.sectionListRenderer?.contents || [];
    const results = [];
    for (const section of sections) {
      const items = section?.musicShelfRenderer?.contents || [];
      for (const item of items) {
        const musicResponsiveListItemRenderer = item?.musicResponsiveListItemRenderer;
        if (!musicResponsiveListItemRenderer) continue;
        const parsed = parseMusicItem(musicResponsiveListItemRenderer);
        if (parsed) results.push(parsed);
      }
    }
    if (results.length) return results;
  }
  return [];
}

function parseMusicItem(renderer) {
  const flexColumns = renderer?.flexColumns || [];
  const fixedColumns = renderer?.fixedColumns || [];
  const getText = (col) => col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map(r => r.text).join("") || "";
  const title = getText(flexColumns[0]);
  const subtitle = getText(flexColumns[1]);
  const thumbnail = renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  const videoId = renderer?.playlistItemData?.videoId ||
                  renderer?.navigationEndpoint?.watchEndpoint?.videoId ||
                  renderer?.navigationEndpoint?.watchPlaylistEndpoint?.playlistId ||
                  null;
  if (!videoId || !title) return null;
  const authors = subtitle ? subtitle.split("•")[0]?.split(",").map(a => a.trim()).filter(Boolean) : [];
  return {
    videoId,
    title,
    artist: authors[0] || "",
    authors,
    album: subtitle?.includes("•") ? subtitle.split("•").slice(1).join("•").trim() : null,
    duration: null,
    artworkUrl: cleanThumbnail(thumbnail),
    thumbnail: cleanThumbnail(thumbnail),
    uri: `https://www.youtube.com/watch?v=${videoId}`,
    source: "youtube",
    isrc: null,
    explicit: false,
  };
}

async function getSignatureTimestamp() {
  try {
    const res = await axios.get(`${YT_BASE}/`, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 5000,
    });
    const match = res.data.match(/"signatureTimestamp":(\d+)/);
    if (match) return parseInt(match[1], 10);
    const match2 = res.data.match(/signatureTimestamp[=:]+(\d+)/);
    if (match2) return parseInt(match2[1], 10);
  } catch {}
  return Math.floor(Date.now() / 1000 / 3600) * 3600;
}

async function getPlayer(videoId) {
  const cached = playerCache.get(videoId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  try {
    const data = await apiRequest("player", {
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          signatureTimestamp: await getSignatureTimestamp(),
        },
      },
      serviceIntegrityDimensions: {},
      thirdPartyUploadUrlSupport: false,
    });
    if (data?.streamingData) {
      playerCache.set(videoId, { data, ts: Date.now() });
    }
    return data;
  } catch (err) {
    console.warn(`[InnerTube] Player failed for ${videoId}: ${err.message}`);
    return null;
  }
}

async function getStreamUrl(videoId) {
  const cached = playerCache.get(videoId);
  const player = cached && Date.now() - cached.ts < CACHE_TTL ? cached.data : await getPlayer(videoId);
  if (!player?.streamingData) return null;
  const { adaptiveFormats, expiresInSeconds } = player.streamingData;
  if (!adaptiveFormats?.length) return null;
  const audioFormats = adaptiveFormats.filter(f =>
    f.mimeType?.startsWith("audio/") && f.url
  );
  if (!audioFormats.length) return null;
  audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const best = audioFormats[0];
  return best.url;
}

async function searchTrack(artist, title) {
  const query = `${artist || ""} ${title || ""}`.trim();
  if (!query) return null;
  const items = await searchQuery(query, "song");
  return items.length ? items : null;
}

async function enrichTracks(tracks) {
  if (!tracks?.length) return tracks;
  const limit = Math.min(tracks.length, 6);
  const enriched = [...tracks];
  for (let i = 0; i < limit; i++) {
    const track = enriched[i];
    const title = track.title || track.track_title;
    const artist = track.artist || track.author || track.track_author;
    if (!title) continue;
    try {
      const results = await searchTrack(artist, title);
      if (results?.length) {
        const best = results[0];
        enriched[i].title = best.title;
        enriched[i].artist = best.artist;
        enriched[i].authors = best.authors;
        if (best.thumbnail) {
          enriched[i].artworkUrl = best.thumbnail;
          enriched[i].thumbnail = best.thumbnail;
        }
        enriched[i].ytVideoId = best.videoId;
      }
    } catch {}
  }
  return enriched;
}

module.exports = { searchQuery, searchTrack, enrichTracks, getStreamUrl, getPlayer, initialize };
