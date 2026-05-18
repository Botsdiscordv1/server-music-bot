const { getRecommendations, searchTracks } = require("./spotify");

function norm(str) {
  return str
    .toLowerCase()
    .replace(/\(official\s+(music\s+)?video\)|\(lyric\s+video\)|\(audio\)|\(visualizer\)|\(official\)|\(hd\)|\(4k\)|\(360\)|\(.*?remaster.*?\)|\(.*?remix.*?\)|\s*-\s*topic$/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeNameKey(t) {
  return norm(`${t.info.title} ${t.info.author}`);
}

function isDuplicate(candidate, skipNames, skipIds) {
  if (skipIds.has(candidate.info.identifier)) return true;
  if (skipNames.has(makeNameKey(candidate))) return true;
  return false;
}

async function getAutoplayTrack(player, currentTrack) {
  const { skipIds, skipNames } = buildSkipData(player, currentTrack);

  const spotifyResult = await trySpotify(player, currentTrack, skipIds, skipNames);
  if (spotifyResult) return spotifyResult;

  return trySearchFallback(player, currentTrack, skipIds, skipNames);
}

function buildSkipData(player, currentTrack) {
  const skipIds = new Set();
  const skipNames = new Set();
  const all = [currentTrack, ...(player.queue.previous || []), ...(player.queue.tracks || [])];
  for (const t of all) {
    if (t?.info?.identifier) skipIds.add(t.info.identifier);
    if (t?.info?.title) skipNames.add(makeNameKey(t));
  }
  return { skipIds, skipNames };
}

async function trySpotify(player, currentTrack, skipIds, skipNames) {
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
          if (!isDuplicate(candidate, skipNames, skipIds)) {
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

async function trySearchFallback(player, currentTrack, skipIds, skipNames) {
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
          if (!isDuplicate(t, skipNames, skipIds)) {
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
        if (!isDuplicate(t, skipNames, skipIds)) {
          return { track: t, source: "ytsearch" };
        }
      }
    }
  } catch {}

  return null;
}

module.exports = { getAutoplayTrack };
