const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const NIGHTLY_URL = "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp";
const YTDLP_DIR = path.join(__dirname, "..", "node_modules", "@distube", "yt-dlp", "bin");
const IS_WIN = process.platform === "win32";
const YTDLP_PATH = path.join(YTDLP_DIR, IS_WIN ? "yt-dlp.exe" : "yt-dlp");

if (IS_WIN) {
  console.log("[nightly] Skipping on Windows");
  process.exit(0);
}

if (!fs.existsSync(YTDLP_DIR)) {
  console.log(`[nightly] Directory not found: ${YTDLP_DIR}`);
  process.exit(0);
}

console.log(`[nightly] Downloading yt-dlp nightly -> ${YTDLP_PATH}`);
const file = fs.createWriteStream(YTDLP_PATH);

https.get(NIGHTLY_URL, (res) => {
  if (res.statusCode === 302 || res.statusCode === 301) {
    https.get(res.headers.location, (res2) => {
      res2.pipe(file);
      file.on("finish", () => {
        file.close();
        fs.chmodSync(YTDLP_PATH, "755");
        console.log("[nightly] Download complete");
      });
    });
    return;
  }
  res.pipe(file);
  file.on("finish", () => {
    file.close();
    fs.chmodSync(YTDLP_PATH, "755");
    console.log("[nightly] Download complete");
  });
}).on("error", (err) => {
  fs.unlinkSync(YTDLP_PATH);
  console.error(`[nightly] Download failed: ${err.message}`);
});
