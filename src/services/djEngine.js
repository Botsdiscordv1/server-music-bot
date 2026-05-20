const { pickBest } = require("../utils/trackFilter");
const { searchTracks, getAudioFeatures, getSeveralTracks, getArtists, getRecommendations } = require("./spotify");

const EXCLUDE_WORDS = [
  "cover", "karaoke", "instrumental", "slowed", "slow",
  "speed up", "sped up", "8bit", "8-bit", "16bit", "16-bit",
  "speedup", "slowed + reverb",
];

const VARIANT_WORDS = [
  "acoustic", "live", "remix", "extended", "radio edit",
  "club mix", "dub mix", "original mix", "orchestral", "piano",
  "strings", "demo", "edit", "reprise", "rework", "reimagined",
  "stripped", "session", "performance", "nightcore", "daycore",
  "super slowed", "8d", "lyric video", "lyrics", "visualizer",
  "remastered", "a cappella", "acapella", "symphonic", "deluxe", "vip",
];

function shouldExclude(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return EXCLUDE_WORDS.some(w => lower.includes(w));
}

function hasVariantTag(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return VARIANT_WORDS.some(w => new RegExp(`\\b${w.replace(/\s+/g, "\\s+")}\\b`, "i").test(lower));
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9áéíóúàèìòùâêîôûãõçñ\s]/g, "").replace(/\s+/g, " ").trim();
}

function titleKey(title) {
  return normalize(title);
}

function authorKey(author) {
  const a = normalize(author).replace(/\s*-\s*topic$/, "").trim();
  return a;
}

/**
 * Finds a Spotify track ID for a liked song using its ISRC, or by searching.
 */
async function resolveSpotifyId(song) {
  if (song.isrc && /^[A-Z]{2}/.test(song.isrc)) {
    try {
      const results = await searchTracks(`isrc:${song.isrc}`, 1);
      if (results?.[0]?.id) return results[0];
    } catch {}
  }
  if (song.track_title && song.track_author) {
    try {
      const results = await searchTracks(`${song.track_title} ${song.track_author}`, 3);
      if (results?.length) return results[0];
    } catch {}
  }
  return null;
}

/**
 * Gets Spotify audio features + track/artist data for an array of liked songs.
 * Returns a Map of index -> { audioFeatures, track, artists }
 */
async function enrichLikedSongs(likedSongs) {
  const enriched = new Map();
  const spotifyIds = [];

  const spotifyData = await Promise.allSettled(
    likedSongs.map(s => resolveSpotifyId(s))
  );

  for (let i = 0; i < likedSongs.length; i++) {
    const result = spotifyData[i];
    if (result.status === "fulfilled" && result.value?.id) {
      spotifyIds.push({ index: i, spotifyId: result.value.id, spotifyTrack: result.value });
    }
  }

  if (spotifyIds.length === 0) return enriched;

  const ids = spotifyIds.map(s => s.spotifyId).slice(0, 50);
  const [featuresRes, tracksRes] = await Promise.allSettled([
    getAudioFeatures(ids),
    getSeveralTracks(ids),
  ]);

  const features = featuresRes.status === "fulfilled" ? featuresRes.value : [];
  const tracks = tracksRes.status === "fulfilled" ? tracksRes.value : [];

  const artistIds = [...new Set(tracks.map(t => t.artistId).filter(Boolean))];
  let artists = [];
  if (artistIds.length > 0) {
    const artistsRes = await Promise.allSettled([getArtists(artistIds.slice(0, 50))]);
    if (artistsRes[0].status === "fulfilled") artists = artistsRes[0].value;
  }
  const artistGenres = new Map();
  for (const a of artists) {
    if (a?.id && a?.genres) artistGenres.set(a.id, a.genres);
  }

  for (let i = 0; i < spotifyIds.length; i++) {
    const { index, spotifyTrack } = spotifyIds[i];
    const feat = features.find(f => f?.id === spotifyTrack.id.replace("spotify:track:", ""));
    const track = tracks.find(t => t?.id === spotifyTrack.id.replace("spotify:track:", ""));
    const genres = track?.artistId ? (artistGenres.get(track.artistId) || []) : [];
    enriched.set(index, { audioFeatures: feat || null, track: track || null, genres });
  }

  return enriched;
}

/**
 * Computes a set profile from enriched liked songs.
 */
function computeProfile(enriched, likedSongs) {
  const genres = [];
  const bpms = [];
  const energies = [];
  const danceabilities = [];
  const valences = [];
  const artists = [];
  let totalWeight = 0;

  for (const [i, data] of enriched) {
    const weight = 1;
    totalWeight += weight;
    if (data.genres?.length) genres.push(...data.genres);
    if (data.audioFeatures?.tempo) bpms.push({ value: data.audioFeatures.tempo, weight });
    if (data.audioFeatures?.energy != null) energies.push({ value: data.audioFeatures.energy, weight });
    if (data.audioFeatures?.danceability != null) danceabilities.push({ value: data.audioFeatures.danceability, weight });
    if (data.audioFeatures?.valence != null) valences.push({ value: data.audioFeatures.valence, weight });
    if (likedSongs[i]?.track_author) artists.push(likedSongs[i].track_author);
  }

  const weightedAvg = (arr) => {
    if (!arr.length) return null;
    const sum = arr.reduce((a, b) => a + b.value * b.weight, 0);
    const w = arr.reduce((a, b) => a + b.weight, 0);
    return w > 0 ? sum / w : null;
  };

  const genreCounts = {};
  for (const g of genres) {
    genreCounts[g] = (genreCounts[g] || 0) + 1;
  }
  const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
  const dominantGenres = sortedGenres.slice(0, 3).map(g => g[0]);

  const artistCounts = {};
  for (const a of artists) {
    const key = authorKey(a);
    if (key) artistCounts[key] = (artistCounts[key] || 0) + 1;
  }
  const dominantArtists = new Set(
    Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0])
  );

  return {
    dominantGenres,
    dominantArtists,
    avgBpm: weightedAvg(bpms),
    avgEnergy: weightedAvg(energies),
    avgDanceability: weightedAvg(danceabilities),
    avgValence: weightedAvg(valences),
  };
}

/**
 * Scores a liked song against the set profile.
 * Formula: genre*0.35 + bpm*0.20 + energy*0.20 + affinity*0.15 + transition*0.10
 * Each component normalised to 0-1, weights sum to 1.0 → max score = 100.
 */
function scoreLikedSong(song, data, profile) {
  if (song.track_title && shouldExclude(song.track_title)) return -Infinity;

  // genre_similarity (0-1) × 0.35
  let genreScore = 0;
  if (data?.genres?.length && profile.dominantGenres?.length) {
    const matching = data.genres.filter(g => profile.dominantGenres.includes(g)).length;
    genreScore = matching / Math.max(profile.dominantGenres.length, 1);
  }

  // bpm_similarity (0-1) × 0.20
  let bpmScore = 0;
  if (data?.audioFeatures?.tempo && profile.avgBpm) {
    const diff = Math.abs(data.audioFeatures.tempo - profile.avgBpm);
    bpmScore = 1 - Math.min(diff / 80, 1);
  }

  // energy_similarity (0-1) × 0.20
  let energyScore = 0;
  if (data?.audioFeatures?.energy != null && profile.avgEnergy != null) {
    energyScore = 1 - Math.abs(data.audioFeatures.energy - profile.avgEnergy);
  }

  // user_affinity (0-1) × 0.15
  let affinityScore = 0;
  if (song.track_author && profile.dominantArtists?.size) {
    const key = authorKey(song.track_author);
    if (profile.dominantArtists.has(key)) affinityScore += 0.5;
  }
  if (song.liked_at) {
    const days = (Date.now() - new Date(song.liked_at).getTime()) / 86400000;
    affinityScore += Math.max(0, (60 - Math.min(days, 60)) / 60) * 0.5;
  }

  let finalScore = genreScore * 35 + bpmScore * 20 + energyScore * 20 + affinityScore * 15;

  if (song.track_title && hasVariantTag(song.track_title)) finalScore -= 10;

  return finalScore;
}

/**
 * Selects the best `count` liked songs for the set.
 * Avoids consecutive same-artist by scoring down duplicates.
 */
function selectBestLiked(likedSongs, enriched, profile, count = 6) {
  const scored = likedSongs.map((song, i) => ({
    song,
    score: scoreLikedSong(song, enriched.get(i), profile),
  }))
    .filter(s => s.score > -Infinity)
    .sort((a, b) => b.score - a.score);

  const selected = [];
  const usedArtists = [];
  const usedTitleKeys = new Set();

  for (const candidate of scored) {
    if (selected.length >= count) break;

    const titleK = titleKey(candidate.song.track_title);
    if (usedTitleKeys.has(titleK)) continue;
    const authorK = authorKey(candidate.song.track_author);

    if (selected.length > 0 && usedArtists.length > 0) {
      const lastArtist = usedArtists[usedArtists.length - 1];
      if (authorK === lastArtist && selected.length < count) {
        const nextBestCompat = scored
          .filter(s => !selected.includes(s) && authorKey(s.song.track_author) !== lastArtist && !usedTitleKeys.has(titleKey(s.song.track_title)))
          .sort((a, b) => b.score - a.score);
        if (nextBestCompat.length > 0 && nextBestCompat[0].score > candidate.score * 0.85) {
          const alt = nextBestCompat[0];
          selected.push(alt);
          usedTitleKeys.add(titleKey(alt.song.track_title));
          usedArtists.push(authorKey(alt.song.track_author));
          continue;
        }
      }
    }

    selected.push(candidate);
    usedTitleKeys.add(titleK);
    usedArtists.push(authorK);
  }

  return selected.slice(0, count).map(s => s.song);
}

/**
 * Searches Lavalink for a track and returns the best match.
 */
async function resolveTrack(player, query) {
  try {
    const result = await player.search(
      { query, source: "ytmsearch" },
      { username: "DJ", id: "dj" }
    );
    if (!result?.tracks?.length) return null;
    const best = pickBest(result.tracks, () => false);
    return best?.track || result.tracks[0];
  } catch {
    return null;
  }
}

/**
 * Resolves a liked song (from DB) to a Lavalink track.
 */
async function resolveLikedTrack(player, song) {
  const queries = [
    `${song.track_author} - ${song.track_title}`,
    `${song.track_title} ${song.track_author}`,
    song.track_title,
  ];
  for (const q of queries) {
    const track = await resolveTrack(player, q);
    if (track) return track;
  }
  return null;
}

/**
 * Gets Spotify track IDs from liked songs (by ISRC or search).
 */
async function resolveSpotifyIds(songs, max = 5) {
  const ids = [];
  for (const song of songs) {
    if (ids.length >= max) break;
    if (song.isrc && /^[A-Z]{2}/.test(song.isrc)) {
      try {
        const results = await searchTracks(`isrc:${song.isrc}`, 1);
        if (results?.[0]?.id && !ids.includes(results[0].id)) {
          ids.push(results[0].id);
          continue;
        }
      } catch {}
    }
    if (song.track_title && song.track_author) {
      try {
        const results = await searchTracks(`${song.track_title} ${song.track_author}`, 1);
        if (results?.[0]?.id && !ids.includes(results[0].id)) {
          ids.push(results[0].id);
        }
      } catch {}
    }
  }
  return ids;
}

/**
 * Gets Spotify recommendations and returns Lavalink-resolved tracks.
 */
async function resolveRecommendations(player, likedSongs, profile, count = 4) {
  const spotifyIds = await resolveSpotifyIds(likedSongs, 5);

  const current = player.queue?.current;
  if (current) {
    const currentId = current.pluginInfo?.identifier || current.info?.uri?.match(/track[:/]([A-Za-z0-9]+)/)?.[1];
    if (currentId && !spotifyIds.includes(currentId)) {
      spotifyIds.unshift(currentId);
    }
  }

  if (!spotifyIds.length) return [];

  try {
    const recs = await getRecommendations(spotifyIds.slice(0, 5));

    if (!recs?.length) return [];

    const resolved = [];
    const usedTitleKeys = new Set();

    for (const rec of recs) {
      if (resolved.length >= count) break;
      const titleK = titleKey(rec.title);
      if (usedTitleKeys.has(titleK)) continue;
      const track = await resolveTrack(player, `${rec.artist} - ${rec.title}`);
      if (track) {
        if (track.info?.title && shouldExclude(track.info.title)) continue;
        track._originalSource = "spotify";
        resolved.push(track);
        usedTitleKeys.add(titleK);
      }
    }

    return resolved;
  } catch (err) {
    console.error("[DJ Engine] Recommendation error:", err.message);
    return [];
  }
}

/**
 * Orders tracks for smooth DJ transition.
 * Avoids consecutive same-artist.
 */
function orderSet(tracks) {
  if (!tracks?.length || tracks.length <= 1) return tracks || [];

  const getArtist = (t) => authorKey(t.info?.author || t.track_author || "");

  const entries = tracks.map(t => ({
    track: t,
    artist: getArtist(t),
    energy: 0.5,
  }));

  entries.sort((a, b) => a.energy - b.energy);

  const result = [];
  const usedKeys = new Set();
  let lastArtist = null;

  const hasAlternativeArtist = () =>
    entries.some(e => !usedKeys.has(titleKey(e.track.info?.title || e.track.track_title || "")) && e.artist !== lastArtist);

  while (result.length < entries.length) {
    const candidate = entries.find(e => {
      const key = titleKey(e.track.info?.title || e.track.track_title || "");
      if (usedKeys.has(key)) return false;
      if (lastArtist && e.artist === lastArtist && hasAlternativeArtist()) return false;
      return true;
    });

    if (!candidate) break;

    result.push(candidate.track);
    usedKeys.add(titleKey(candidate.track.info?.title || candidate.track.track_title || ""));
    lastArtist = candidate.artist;
  }

  return result;
}

/**
 * Main entry point. Generates a complete DJ set of 10 tracks.
 *
 * Returns { tracks: LavalinkTrack[], profile, likedUsed, recommendedUsed }
 */
async function generateSet(player, likedSongs) {
  if (!likedSongs?.length) return { tracks: [], profile: null, likedUsed: 0, recommendedUsed: 0 };

  const enriched = await enrichLikedSongs(likedSongs);
  const profile = computeProfile(enriched, likedSongs);

  const scored = likedSongs
    .map((song, i) => ({ song, score: scoreLikedSong(song, enriched.get(i), profile) }))
    .filter(s => s.score > -Infinity)
    .sort((a, b) => b.score - a.score);

  const usedTitleKeys = new Set();
  const likedTracks = [];

  for (const candidate of scored) {
    if (likedTracks.length >= 6) break;
    const key = titleKey(candidate.song.track_title);
    if (usedTitleKeys.has(key)) continue;
    const track = await resolveLikedTrack(player, candidate.song);
    if (track) {
      likedTracks.push(track);
      usedTitleKeys.add(key);
    }
  }

  const recommendedTracks = await resolveRecommendations(player, likedSongs, profile, 4);

  let extraLikedTracks = [];
  if (likedTracks.length + recommendedTracks.length < 10) {
    for (const candidate of scored) {
      if (likedTracks.length + recommendedTracks.length + extraLikedTracks.length >= 10) break;
      const key = titleKey(candidate.song.track_title);
      if (usedTitleKeys.has(key)) continue;
      const track = await resolveLikedTrack(player, candidate.song);
      if (track) {
        extraLikedTracks.push(track);
        usedTitleKeys.add(key);
      }
    }
  }

  const allTracks = [...likedTracks, ...recommendedTracks, ...extraLikedTracks];
  const ordered = orderSet(allTracks);

  return {
    tracks: ordered,
    profile,
    likedUsed: likedTracks.length + extraLikedTracks.length,
    recommendedUsed: recommendedTracks.length,
  };
}

module.exports = { generateSet };
