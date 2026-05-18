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

async function main() {
  await initDB();
  const client = createClient();
  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(console.error);
