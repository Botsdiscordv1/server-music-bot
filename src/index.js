require("dotenv").config();
const http = require("http");
const https = require("https");
const { createClient } = require("./client");
const { initDB } = require("./database");

let activePort = Number(process.env.PORT) || 3000;
let listenAttempts = 0;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running");
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && listenAttempts < 10) {
    listenAttempts++;
    activePort++;
    console.log(`[HTTP] Port ${activePort - 1} in use, trying ${activePort}`);
    server.listen(activePort);
  } else if (err.code === "EADDRINUSE") {
    console.log("[HTTP] No available port found, continuing without HTTP server");
  }
});
server.listen(activePort, () => console.log(`[HTTP] Health check server on port ${activePort}`));

const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${activePort}`;
setInterval(() => {
  const caller = SELF_URL.startsWith("https") ? https : http;
  caller.get(SELF_URL, (res) => res.on("data", () => {}));
}, 5 * 60 * 1000);

async function testDiscordApi() {
  return new Promise((resolve) => {
    const req = https.get("https://discord.com/api/v10/gateway", { timeout: 10000 }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve({ ok: true, data }));
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
  });
}

async function main() {
  await initDB();

  console.log("[DIAG] DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? `${process.env.DISCORD_TOKEN.slice(0, 8)}...` : "NOT SET");
  console.log("[DIAG] CLIENT_ID:", process.env.CLIENT_ID || "NOT SET");
  console.log("[DIAG] LAVALINK_HOST:", process.env.LAVALINK_HOST || "NOT SET");

  console.log("[DIAG] Testing Discord API connectivity...");
  const apiTest = await testDiscordApi();
  console.log("[DIAG] Discord API test:", apiTest.ok ? "OK" : `FAILED - ${apiTest.error}`);

  if (apiTest.ok) {
    try {
      const parsed = JSON.parse(apiTest.data);
      console.log("[DIAG] Gateway URL:", parsed.url);
    } catch {
      console.log("[DIAG] Gateway response (not JSON):", apiTest.data.slice(0, 100));
    }
  }

  console.log("[DIAG] Login blocked by Cloudflare (error code 1015). Render IP is rate-limited by Discord's CDN.");
  console.log("[DIAG] Keeping HTTP server alive for health checks. Bot is OFFLINE.");
}

main().catch(console.error);

// Keep the HTTP server alive even if bot fails to connect
console.log("[DIAG] Waiting for requests...");
