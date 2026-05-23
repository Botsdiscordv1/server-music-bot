require("dotenv").config();

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled rejection:", reason?.message ?? reason);
});

const http = require("http");
const { initDB } = require("./database");
const { app: musicApi, startApi } = require("./api/server");
const { getGoogleTTSUrl } = require("./utils/ttsService");

const PORT = Number(process.env.PORT) || 3000;
const API_PORT = Number(process.env.API_PORT) || 3001;

// HTTP server — health check + TTS proxy + API (for Render, all on one port)
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;

  // Forward all /api/* requests to the Express music API
  if (pathname.startsWith("/api")) {
    musicApi(req, res);
    return;
  }

  // Health check
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Android backend running");
});

server.listen(PORT, () => console.log(`[HTTP] Server running on port ${PORT}`));

async function main() {
  await initDB();

  if (process.env.RENDER) {
    // On Render, everything shares the same port via the HTTP server above
    console.log(`[API] Music API mounted on port ${PORT} (Render)`);
  } else {
    // Locally, start Express on its own port
    await startApi(API_PORT);
  }

  // TTS keepalive — prevents cold starts on Render's Edge-TTS service
  const ttsProvider = (process.env.TTS_PROVIDER || "google").toLowerCase();
  if (ttsProvider === "edge" || ttsProvider === "kokoro") {
    const edgeApiUrl = process.env.EDGE_API_URL || process.env.KOKORO_API_URL;
    if (edgeApiUrl) {
      const warmUrl = `${edgeApiUrl.replace(/\/+$/, "")}/tts.mp3?text=keep+warm&voice=${process.env.EDGE_VOICE || "es-MX-DaliaNeural"}&lang=${process.env.EDGE_LANG || "es"}`;
      setInterval(() => { fetch(warmUrl).catch(() => {}); }, 4 * 60 * 1000);
      console.log("[TTS] Keepalive started (every 4 min) to prevent cold starts");
    }
  }
}

main().catch(console.error);
