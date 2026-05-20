/**
 * trackFilter.js — Centralized track filtering & scoring utility.
 *
 * Exclusion list (case-insensitive, full-word match where possible):
 *   cover, karaoke, instrumental, slow, slowed, speed up, sped up,
 *   8bit, 8-bit, 16bit, 16-bit, speedup, slowed + reverb
 *
 * Priority order for search results:
 *   1. Official uploads (Topic channels, VEVO, official audio/video)
 *   2. Original audio (no variant keywords at all)
 *   3. Everything else that passes the exclusion filter
 */

// ── Exclusion patterns ────────────────────────────────────────────────────────
// These terms cause a track to be *hard excluded* regardless of context.
const EXCLUDE_TERMS = [
  "cover",
  "karaoke",
  "instrumental",
  "slow",
  "slowed",
  "speed up",
  "sped up",
  "tribute",
  "8bit",
  "8-bit",
  "16bit",
  "16-bit",
  "speedup",
  "slowed + reverb",
  "official video",
  "official music video",
  "official lyric video",
  "music video",
  "dj mix",
  "mixtape",
];

// Retained for backward compatibility
const EXCLUDE_PATTERNS = [
  /\bcover\b/i,
  /\bkaraoke\b/i,
  /\binstrumental\b/i,
  /\bslow(ed)?\b/i,
  /slowed\s*\+\s*reverb/i,
  /\bspeed[\s-]?up\b/i,
  /\bsped[\s-]?up\b/i,
  /\bspeedup\b/i,
  /\b8[\s-]?bit\b/i,
  /\b16[\s-]?bit\b/i,
  /\btribute\b/i,
  /\bofficial\s+(video|music\s+video|lyric\s+video)\b/i,
  /\bmusic\s+video\b/i,
  /\bdj\s+mix\b/i,
  /\bmixtape\b/i,
  /\b(live|dj|acoustic|studio)\s+set\b/i,
  /\bset\s+mix\b/i,
];

// ── Soft variant words (used only for scoring / deprioritisation) ─────────────
// Tracks matching these are not hard-excluded but score lower.
const VARIANT_WORDS = [
  "acoustic", "live", "remix", "extended", "radio edit",
  "club mix", "dub mix", "original mix", "orchestral", "piano",
  "strings", "demo", "edit", "reprise", "rework", "reimagined",
  "stripped", "session", "performance", "nightcore", "daycore",
  "super slowed", "8d", "lyric video", "lyrics", "visualizer",
  "remastered", "a cappella", "acapella",
];

// ── Official-channel signals (used for scoring) ───────────────────────────────
const OFFICIAL_AUTHOR_PATTERNS = [
  /\bvevo\b/i,
  /\s-\s*topic$/i,     // "Artist - Topic" (YouTube Music auto-generated)
  /\bofficial\b/i,
];

const OFFICIAL_TITLE_PATTERNS = [
  /\bofficial\s+audio\b/i,
  /\baudio\b/i,
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true when a track title should be *hard excluded*.
 * @param {string} title
 * @returns {boolean}
 */
function isExcluded(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return EXCLUDE_TERMS.some((term) => lower.includes(term));
}

/**
 * Returns true when a track has soft variant keywords (not excluded, just deprioritised).
 * @param {string} title
 * @returns {boolean}
 */
function isVariant(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return VARIANT_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(lower));
}

/**
 * Scores a track for priority selection.
 * Higher = better.
 *
 * 100 — official channel (Topic / VEVO / official keyword in author)
 *  50 — "official audio/video" in title
 *  20 — no variant keywords at all (clean original)
 *   0 — has soft variant keywords
 *  -∞ — excluded (should never reach scoring)
 *
 * @param {{ info: { title: string, author: string } }} track
 * @returns {number}
 */
function scoreTrack(track) {
  const title  = track?.info?.title  || "";
  const author = track?.info?.author || "";

  // Hard-excluded tracks should never be scored; return -Infinity as safety net.
  if (isExcluded(title)) return -Infinity;

  let score = 0;

  // Official author bonus
  if (OFFICIAL_AUTHOR_PATTERNS.some((re) => re.test(author))) score += 100;

  // Official title bonus
  if (OFFICIAL_TITLE_PATTERNS.some((re) => re.test(title))) score += 50;

  // Penalise soft variants
  if (isVariant(title)) score -= 10;
  else score += 20; // clean track bonus

  return score;
}

/**
 * Filters an array of tracks, removing hard-excluded ones, then sorts by
 * priority (official > original > variants).
 *
 * @param {Array<{ info: { title: string, author: string } }>} tracks
 * @returns {Array}  Filtered and sorted tracks (best first)
 */
function filterAndSort(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks
    .filter((t) => !isExcluded(t?.info?.title || ""))
    .sort((a, b) => scoreTrack(b) - scoreTrack(a));
}

/**
 * Picks the best track from a list, skipping duplicates and hard-excluded
 * entries.  Falls back to the best variant if no clean track is found.
 *
 * @param {Array}    tracks   — raw tracks from Lavalink
 * @param {Function} isDup    — (track) => boolean — caller-supplied dedup check
 * @param {string}   [source] — label for the returned object
 * @returns {{ track, source } | null}
 */
function pickBest(tracks, isDup, source = "ytmsearch") {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  const candidates = filterAndSort(tracks);
  let variantFallback = null;

  for (const t of candidates) {
    if (typeof isDup === "function" && isDup(t)) continue;
    if (!isVariant(t.info?.title || "")) {
      return { track: t, source };
    }
    if (!variantFallback) variantFallback = t;
  }

  return variantFallback ? { track: variantFallback, source } : null;
}

module.exports = {
  isExcluded,
  isVariant,
  scoreTrack,
  filterAndSort,
  pickBest,
  // Expose lists for external use / testing
  EXCLUDE_TERMS,
  EXCLUDE_PATTERNS,
  VARIANT_WORDS,
};
