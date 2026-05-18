const { getRecommendations, searchTracks } = require("./spotify");

function norm(str) {
  return str
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/\s*-\s*topic$/gi, "")
    .replace(/[^a-z0-9áéíóúàèìòùâêîôûãõçñ\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const skipTitles = new Set();
  const skipFull = new Set();
  const all = [currentTrack, ...(player.queue.previous || []), ...(player.queue.tracks || [])];
  for (const t of all) {
    if (t?.info?.identifier) skipIds.add(t.info.identifier);
    if (t?.info?.title) {
      skipTitles.add(coreTitle(t.info.title));
      skipFull.add(`${coreTitle(t.info.title)}|${normAuthor(t.info.author || "")}`);
    }
  }
  return { skipIds, skipTitles, skipFull };
}

function isDuplicate(candidate, { skipIds, skipTitles, skipFull }) {
  if (skipIds.has(candidate.info.identifier)) return true;
  const cTitle = coreTitle(candidate.info.title || "");
  const cAuthor = normAuthor(candidate.info.author || "");
  if (skipFull.has(`${cTitle}|${cAuthor}`)) return true;
  if (skipTitles.has(cTitle)) return true;
  return false;
}

async function getAutoplayTrack(player, currentTrack) {
  const skipData = buildSkipData(player, currentTrack);

  const spotifyResult = await trySpotify(player, currentTrack, skipData);
  if (spotifyResult) return spotifyResult;

  return trySearchFallback(player, currentTrack, skipData);
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
        for (const candidate of result.tracks) {
          if (!isDuplicate(candidate, skipData)) {
            return { track: candidate, source: "spotify" };
          }
        }
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
        for (const t of result.tracks) {
          if (!isDuplicate(t, skipData)) {
            return { track: t, source: "ytmsearch" };
          }
        }
      }
    } catch {}
  }

  try {
    const result = await player.search(
      { query: `${currentTrack.info.title} ${currentTrack.info.author}`, source: "ytsearch" },
      { username: "Autoplay", id: "autoplay" }
    );
    if (result?.tracks?.length > 1) {
      for (const t of result.tracks) {
        if (!isDuplicate(t, skipData)) {
          return { track: t, source: "ytsearch" };
        }
      }
    }
  } catch {}

  return null;
}

module.exports = { getAutoplayTrack };
