const { pickBest } = require("../utils/trackFilter");
const { searchTracks, getAudioFeatures, getSeveralTracks, getArtists, getRecommendations } = require("./spotify");

const EXCLUDE_WORDS = [
  "cover", "karaoke", "instrumental", "slowed", "slow",
  "speed up", "sped up", "8bit", "8-bit", "16bit", "16-bit",
  "speedup", "slowed + reverb",
  "official video", "official music video", "official lyric video",
  "music video", "dj mix", "mixtape",
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

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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
    enriched.set(index, { audioFeatures: feat || null, track: track || null, genres, spotifyId: spotifyTrack.id });
  }

  return enriched;
}

/**
 * Groups liked songs into clusters by genre (from Spotify) or by artist.
 * Returns [{ label, songs: [...], genres: [...], avgBpm, avgEnergy }]
 */
function buildClusters(likedSongs, enriched) {
  const genreClusters = new Map();
  const artistSongs = new Map();
  const misc = [];

  for (let i = 0; i < likedSongs.length; i++) {
    const song = likedSongs[i];
    if (song.track_title && shouldExclude(song.track_title)) continue;

    const data = enriched.get(i);

    if (data?.genres?.length) {
      const primary = data.genres[0];
      if (!genreClusters.has(primary)) {
        genreClusters.set(primary, { songs: [], genres: new Set(), bpms: [], energies: [] });
      }
      const cluster = genreClusters.get(primary);
      cluster.songs.push(song);
      data.genres.forEach(g => cluster.genres.add(g));
      if (data.audioFeatures?.tempo) cluster.bpms.push(data.audioFeatures.tempo);
      if (data.audioFeatures?.energy != null) cluster.energies.push(data.audioFeatures.energy);
      continue;
    }

    const author = song.track_author ? authorKey(song.track_author) : null;
    if (author) {
      if (!artistSongs.has(author)) artistSongs.set(author, []);
      artistSongs.get(author).push(song);
      continue;
    }

    misc.push(song);
  }

  const clusters = [];

  for (const [genre, c] of genreClusters) {
    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    clusters.push({
      label: genre,
      songs: c.songs,
      genres: [...c.genres],
      avgBpm: avg(c.bpms),
      avgEnergy: avg(c.energies),
    });
  }

  for (const [artist, songs] of artistSongs) {
    clusters.push({
      label: artist,
      songs,
      genres: [],
      avgBpm: null,
      avgEnergy: null,
    });
  }

  if (misc.length > 0) {
    clusters.push({
      label: "general",
      songs: misc,
      genres: [],
      avgBpm: null,
      avgEnergy: null,
    });
  }

  return clusters;
}

/**
 * Picks a random cluster, avoiding the previously used one.
 */
function pickCluster(clusters, lastLabel) {
  const available = clusters.filter(c => c.label !== lastLabel && c.songs.length >= 2);
  const pool = available.length ? available : clusters;
  const weights = pool.map(c => Math.min(c.songs.length, 20));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Picks `count` random songs from a cluster, avoiding dups and consecutive artist repeats.
 */
function pickSongs(cluster, count = 6) {
  const shuffled = shuffle(cluster.songs);
  const selected = [];
  const usedKeys = new Set();
  const usedArtists = [];

  for (const song of shuffled) {
    if (selected.length >= count) break;
    const key = titleKey(song.track_title);
    if (usedKeys.has(key)) continue;
    const artist = authorKey(song.track_author);
    if (usedArtists.length && artist === usedArtists[usedArtists.length - 1]) {
      const alt = shuffled.find(s => {
        if (selected.includes(s)) return false;
        const k = titleKey(s.track_title);
        return !usedKeys.has(k) && authorKey(s.track_author) !== artist;
      });
      if (alt) {
        selected.push(alt);
        usedKeys.add(titleKey(alt.track_title));
        usedArtists.push(authorKey(alt.track_author));
        continue;
      }
    }
    selected.push(song);
    usedKeys.add(key);
    usedArtists.push(artist);
  }

  return selected.slice(0, count);
}

/**
 * Computes profile from a specific set of selected songs.
 */
function computeSetProfile(selectedSongs, enriched, likedSongs) {
  const genres = new Set();
  const bpms = [];
  const energies = [];
  const artists = [];

  for (const song of selectedSongs) {
    const idx = likedSongs.indexOf(song);
    if (idx === -1) continue;
    const data = enriched.get(idx);
    if (data?.genres) data.genres.forEach(g => genres.add(g));
    if (data?.audioFeatures?.tempo) bpms.push(data.audioFeatures.tempo);
    if (data?.audioFeatures?.energy != null) energies.push(data.audioFeatures.energy);
    if (song.track_author) artists.push(authorKey(song.track_author));
  }

  return {
    dominantGenres: [...genres].slice(0, 3),
    dominantArtists: new Set(artists),
    avgBpm: bpms.length ? bpms.reduce((a, b) => a + b, 0) / bpms.length : null,
    avgEnergy: energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : null,
  };
}

async function resolveTrack(player, query) {
  const sources = ["ytmsearch", "ytsearch"];
  for (const source of sources) {
    try {
      const result = await player.search(
        { query, source },
        { username: "DJ", id: "dj" }
      );
      if (!result?.tracks?.length) continue;
      const best = pickBest(result.tracks, () => false);
      if (best?.track) return best.track;
      for (const t of result.tracks) {
        if (!shouldExclude(t.info?.title || "")) return t;
      }
      return result.tracks[0];
    } catch {}
  }
  return null;
}

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

async function resolveRecommendations(player, selectedSongs, profile, enriched, likedSongs, count = 4) {
  const songIndexByKey = new Map();
  likedSongs.forEach((s, i) => {
    songIndexByKey.set(`${authorKey(s.track_author)}::${titleKey(s.track_title)}`, i);
  });

  const spotifyIds = [];
  for (const song of selectedSongs) {
    if (spotifyIds.length >= 5) break;
    const key = `${authorKey(song.track_author)}::${titleKey(song.track_title)}`;
    const idx = songIndexByKey.get(key);
    if (idx === undefined) continue;
    const data = enriched.get(idx);
    if (data?.spotifyId && !spotifyIds.includes(data.spotifyId)) {
      spotifyIds.push(data.spotifyId);
    }
  }

  const current = player.queue?.current;
  if (current) {
    const currentId = current.pluginInfo?.identifier || current.info?.uri?.match(/track[:/]([A-Za-z0-9]+)/)?.[1];
    if (currentId && !spotifyIds.includes(currentId)) {
      spotifyIds.unshift(currentId);
    }
  }

  const hasSeeds = spotifyIds.length || profile?.dominantGenres?.length;
  if (!hasSeeds) return [];

  try {
    const recs = await getRecommendations(
      spotifyIds.slice(0, 5),
      [],
      profile?.dominantGenres?.slice(0, 2)
    );
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
 * Falls back to YouTube-based related tracks when Spotify recommendations produce 0 results.
 * Searches for each selected song's author on YouTube Music and picks non-duplicate results.
 */
async function fallbackRecommendations(player, selectedSongs, likedSongs, count = 4) {
  const likedKeys = new Set(likedSongs.map(s => `${authorKey(s.track_author)}::${titleKey(s.track_title)}`));
  const resolved = [];
  const usedTitleKeys = new Set();

  const authorQueries = [...new Set(selectedSongs.map(s => s.track_author).filter(Boolean))];
  shuffle(authorQueries);

  for (const author of authorQueries) {
    if (resolved.length >= count) break;

    const query = `${author} - top tracks`;
    try {
      const result = await player.search(
        { query, source: "ytmsearch" },
        { username: "DJ", id: "dj" }
      );
      if (!result?.tracks?.length) continue;

      let taken = 0;
      for (const track of result.tracks) {
        if (resolved.length >= count || taken >= 2) break;
        const title = track.info?.title || "";
        if (shouldExclude(title)) continue;
        const key = `${authorKey(track.info?.author || "")}::${titleKey(title)}`;
        if (usedTitleKeys.has(key)) continue;
        if (likedKeys.has(key)) continue;
        resolved.push(track);
        usedTitleKeys.add(key);
        taken++;
      }
    } catch {}
  }

  return resolved;
}

function orderSet(tracks) {
  if (!tracks?.length || tracks.length <= 1) return tracks || [];

  const getArtist = (t) => authorKey(t.info?.author || t.track_author || "");

  const entries = tracks.map(t => ({
    track: t,
    artist: getArtist(t),
  }));

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
 * Ensures no artist appears more than `maxPerArtist` times in the selected songs.
 * Swaps extras with songs from other artists in the full likedSongs pool.
 */
function diversifySongs(selected, likedSongs, maxPerArtist = 2) {
  const artistCount = new Map();
  for (const s of selected) {
    const a = authorKey(s.track_author);
    artistCount.set(a, (artistCount.get(a) || 0) + 1);
  }

  const overLimit = [...artistCount.entries()].filter(([, c]) => c > maxPerArtist);
  if (!overLimit.length) return selected;

  const keep = [];
  const perArtist = new Map();
  for (const s of selected) {
    const a = authorKey(s.track_author);
    const count = perArtist.get(a) || 0;
    if (count < maxPerArtist) {
      keep.push(s);
      perArtist.set(a, count + 1);
    }
  }

  const selectedKeys = new Set(keep.map(s => `${authorKey(s.track_author)}::${titleKey(s.track_title)}`));
  const pool = shuffle(likedSongs.filter(s => {
    const key = `${authorKey(s.track_author)}::${titleKey(s.track_title)}`;
    if (selectedKeys.has(key)) return false;
    const a = authorKey(s.track_author);
    return (perArtist.get(a) || 0) < maxPerArtist;
  }));

  const needed = selected.length - keep.length;
  return [...keep, ...pool.slice(0, needed)];
}

/**
 * Main entry point. Generates a complete DJ set of 10 tracks.
 *
 * Algorithm:
 * 1. Cluster liked songs by genre/artist
 * 2. Pick a random cluster (different from last set)
 * 3. Randomly select 6 liked songs from that cluster
 * 4. Compute set profile from the 6 selected songs
 * 5. Get 4 Spotify recommendations matching the profile
 * 6. Order for smooth transitions
 *
 * Tracks the last cluster label on player._lastDjCluster.
 */
async function generateSet(player, likedSongs) {
  if (!likedSongs?.length) return { tracks: [], profile: null, likedUsed: 0, recommendedUsed: 0 };

  const enriched = await enrichLikedSongs(likedSongs);
  const clusters = buildClusters(likedSongs, enriched);

  if (!clusters.length) return { tracks: [], profile: null, likedUsed: 0, recommendedUsed: 0 };

  const cluster = pickCluster(clusters, player._lastDjCluster);
  player._lastDjCluster = cluster.label;

  let selectedSongs = pickSongs(cluster, 6);

  // Diversify: max 2 songs per artist in the set
  selectedSongs = diversifySongs(selectedSongs, likedSongs, 2);

  if (selectedSongs.length < 6) {
    const pool = likedSongs.filter(s => !selectedSongs.includes(s));
    const extra = shuffle(pool).slice(0, 6 - selectedSongs.length);
    selectedSongs.push(...extra);
    selectedSongs = diversifySongs(selectedSongs, likedSongs, 2);
  }

  const profile = computeSetProfile(selectedSongs, enriched, likedSongs);

  const likedTracks = [];
  const usedTitleKeys = new Set();
  for (const song of shuffle(selectedSongs)) {
    const key = titleKey(song.track_title);
    if (usedTitleKeys.has(key)) continue;
    const track = await resolveLikedTrack(player, song);
    if (track) {
      likedTracks.push(track);
      usedTitleKeys.add(key);
    }
  }

  let recommendedTracks = await resolveRecommendations(player, selectedSongs, profile, enriched, likedSongs, 4);

  if (recommendedTracks.length < 4) {
    const fallback = await fallbackRecommendations(player, selectedSongs, likedSongs, 4 - recommendedTracks.length);
    recommendedTracks = [...recommendedTracks, ...fallback];
  }

  const allTracks = [...likedTracks, ...recommendedTracks];
  const ordered = orderSet(allTracks);

  return {
    tracks: ordered,
    profile,
    likedUsed: likedTracks.length,
    recommendedUsed: recommendedTracks.length,
  };
}

/**
 * Generates a 10-track set for a specific artist.
 * Uses 5 liked songs by the artist as seeds + 5 recommendations.
 */
async function generateArtistSet(player, likedSongs, artistName) {
  if (!likedSongs?.length || !artistName) return { tracks: [], likedUsed: 0, recommendedUsed: 0 };

  const enriched = await enrichLikedSongs(likedSongs);

  const authorLower = artistName.toLowerCase();
  const artistSongs = likedSongs.filter(s => {
    const a = (s.track_author || "").toLowerCase();
    return a.includes(authorLower) || authorLower.includes(a);
  });

  if (!artistSongs.length) return { tracks: [], likedUsed: 0, recommendedUsed: 0 };

  const seedSongs = shuffle(artistSongs).slice(0, 5);
  const profile = computeSetProfile(seedSongs, enriched, likedSongs);

  const likedTracks = [];
  const usedTitleKeys = new Set();
  for (const song of shuffle(seedSongs)) {
    const key = titleKey(song.track_title);
    if (usedTitleKeys.has(key)) continue;
    const track = await resolveLikedTrack(player, song);
    if (track) {
      likedTracks.push(track);
      usedTitleKeys.add(key);
    }
  }

  let recommendedTracks = await resolveRecommendations(player, seedSongs, profile, enriched, likedSongs, 5);
  if (recommendedTracks.length < 5) {
    const fallback = await fallbackRecommendations(player, seedSongs, likedSongs, 5 - recommendedTracks.length);
    recommendedTracks = [...recommendedTracks, ...fallback];
  }

  const allTracks = [...likedTracks, ...recommendedTracks];
  const ordered = orderSet(allTracks);

  return {
    tracks: ordered,
    profile,
    likedUsed: likedTracks.length,
    recommendedUsed: recommendedTracks.length,
  };
}

module.exports = { generateSet, generateArtistSet };
