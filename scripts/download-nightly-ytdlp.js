const fs = require("fs");
const path = require("path");

const NIGHTLY_URL = "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp";
const YTDLP_DIR = path.join(__dirname, "..", "node_modules", "@distube", "yt-dlp", "bin");
const IS_WIN = process.platform === "win32";
const YTDLP_PATH = path.join(YTDLP_DIR, IS_WIN ? "yt-dlp.exe" : "yt-dlp");

if (IS_WIN) {
  console.log("[nightly] Skipping on Windows");
  process.exit(0);
}

if (!fs.existsSync(YTDLP_DIR)) {
  console.log(`[nightly] Directory not found: ${YTDLP_DIR}, skipping`);
  process.exit(0);
}

(async () => {
  console.log(`[nightly] Downloading yt-dlp nightly -> ${YTDLP_PATH}`);
  try {
    const axios = require("axios");
    const res = await axios.get(NIGHTLY_URL, {
      responseType: "stream",
      timeout: 30000,
      maxRedirects: 5,
    });
    const writer = fs.createWriteStream(YTDLP_PATH);
    res.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
    fs.chmodSync(YTDLP_PATH, "755");
    const size = fs.statSync(YTDLP_PATH).size;
    console.log(`[nightly] Download complete (${(size / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.error(`[nightly] Download failed: ${err.message}`);
    if (fs.existsSync(YTDLP_PATH)) fs.unlinkSync(YTDLP_PATH);
    process.exit(0);
  }
})();
