require("dotenv").config();
const http = require("http");
const https = require("https");
const dns = require("dns");
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
    const url = JSON.parse(apiTest.data).url;
    console.log("[DIAG] Gateway URL:", url);
  }

  const client = createClient();

  client.on("error", (err) => console.error("[CLIENT ERROR]", err));

  const loginTimeout = setTimeout(() => {
    console.error("[DIAG] Login timed out after 20 seconds");
    process.exit(1);
  }, 20000);

  try {
    await client.login(process.env.DISCORD_TOKEN);
    clearTimeout(loginTimeout);
    console.log("[DIAG] Login successful, waiting for ready event...");
  } catch (err) {
    clearTimeout(loginTimeout);
    console.error("[DIAG] Login failed:", err.message, err.code, err.status);
    process.exit(1);
  }
}

main().catch(console.error);
