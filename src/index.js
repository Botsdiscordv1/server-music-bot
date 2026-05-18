require("dotenv").config();
const http = require("http");
const https = require("https");
const { createClient } = require("./client");
const { initDB } = require("./database");

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running");
}).listen(PORT, () => console.log(`[HTTP] Health check server on port ${PORT}`));

const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
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
