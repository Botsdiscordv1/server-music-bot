const { getRecommendations, searchTracks } = require("./spotify");
const { isExcluded, isVariant: tfIsVariant, pickBest: tfPickBest } = require("../utils/trackFilter");

const VARIANT_WORDS = [
  "acoustic", "live", "remix", "cover", "instrumental", "sped ?up", "slowed ?down",
  "reverb", "extended", "radio edit", "club mix", "dub mix", "original mix",
  "orchestral", "piano", "strings", "demo", "edit", "reprise", "rework",
  "reimagined", "stripped", "session", "performance", "karaoke", "nightcore",
  "daycore", "super slowed", "8d", "lyric video", "lyrics", "official video",
  "official audio", "official lyric", "visualizer", "remastered", "spedup",
  "sloweddown", "a cappella", "acapella",
];

function stripVariantSuffix(str) {
  let s = str;
  for (const word of VARIANT_WORDS) {
    const regex = new RegExp(
      `[-–—|:.,;]\\s*(${word})\\s*(version)?\\s*$`, "gi"
    );
    s = s.replace(regex, "");
  }
  return s.trim();
}

function coreTitle(title) {
  return title
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/\s*-\s*topic$/gi, "")
    .replace(/[^a-z0-9áéíóúàèìòùâêîôûãõçñ\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normAuthor(author) {
  return author
    .toLowerCase()
    .replace(/\s*-\s*topic$/gi, "")
    .replace(/[^a-z0-9áéíóúàèìòùâêîôûãõçñ\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSkipData(player, currentTrack) {
  const skipIds = new Set();
  const skipBases = new Set();
  const skipFull = new Set();
  const all = [currentTrack, ...(player.queue.previous || []), ...(player.queue.tracks || [])];
  for (const t of all) {
    if (t?.info?.identifier) skipIds.add(t.info.identifier);
    if (t?.info?.title) {
      skipBases.add(coreTitle(stripVariantSuffix(t.info.title)));
      skipFull.add(`${coreTitle(t.info.title)}|${normAuthor(t.info.author || "")}`);
    }
  }
  return { skipIds, skipBases, skipFull };
}

function isDuplicate(candidate, { skipIds, skipBases, skipFull }) {
  if (skipIds.has(candidate.info.identifier)) return true;
  const cTitle = coreTitle(candidate.info.title || "");
  const cAuthor = normAuthor(candidate.info.author || "");
  const cBase = coreTitle(stripVariantSuffix(candidate.info.title || ""));
  if (skipFull.has(`${cTitle}|${cAuthor}`)) return true;
  if (skipBases.has(cBase)) return true;
  return false;
}

function isVariant(title) {
  return tfIsVariant(title);
}

function shouldDiscard(title) {
  return isExcluded(title);
}

async function getAutoplayTrack(player, currentTrack) {
  const skipData = buildSkipData(player, currentTrack);

  const spotifyResult = await trySpotify(player, currentTrack, skipData);
  if (spotifyResult) return spotifyResult;

  return trySearchFallback(player, currentTrack, skipData);
}

function pickBest(tracks, skipData, source = "ytmsearch") {
  return tfPickBest(tracks, (t) => isDuplicate(t, skipData), source);
}

async function trySpotify(player, currentTrack, skipData) {
  let spotifyId =
    currentTrack?.pluginInfo?.identifier ||
    currentTrack?.info?.uri?.match(/track[:/]([A-Za-z0-9]+)/)?.[1];

  if (!spotifyId) {
    const isrc = currentTrack?.info?.identifier;
    if (isrc && /^[A-Z]{2}/.test(isrc)) {
      try {
        const results = await searchTracks(`isrc:${isrc}`, 1);
        if (results?.[0]?.id) spotifyId = results[0].id;
      } catch {}
    }
  }

  if (!spotifyId) return null;

  try {
    const recommendations = await getRecommendations([spotifyId]);
    if (!recommendations?.length) return null;

    for (const rec of recommendations) {
      const result = await player.search(
        { query: `${rec.artist} - ${rec.title}`, source: "ytmsearch" },
        { username: "Autoplay", id: "autoplay" }
      );
      if (result?.tracks?.length) {
        const best = pickBest(result.tracks, skipData, "spotify");
        if (best) return best;
      }
    }
  } catch (err) {
    console.error("[Autoplay] Spotify error:", err.message);
  }

  return null;
}

async function trySearchFallback(player, currentTrack, skipData) {
  const queries = [
    `${currentTrack.info.title} ${currentTrack.info.author}`,
    `${currentTrack.info.author} - ${currentTrack.info.title}`,
    currentTrack.info.title,
  ];

  for (const query of queries) {
    try {
      const result = await player.search(
        { query, source: "ytmsearch" },
        { username: "Autoplay", id: "autoplay" }
      );
      if (result?.tracks?.length > 1) {
        const best = pickBest(result.tracks, skipData, "ytmsearch");
        if (best) return best;
      }
    } catch {}
  }

  try {
    const result = await player.search(
      { query: `${currentTrack.info.title} ${currentTrack.info.author}`, source: "ytsearch" },
      { username: "Autoplay", id: "autoplay" }
    );
    if (result?.tracks?.length > 1) {
      const best = pickBest(result.tracks, skipData, "ytsearch");
      if (best) return best;
    }
  } catch {}

  return null;
}

module.exports = { getAutoplayTrack };
