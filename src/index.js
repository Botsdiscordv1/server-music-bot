require("dotenv").config();
const http = require("http");
const { createClient } = require("./client");
const { initDB } = require("./database");

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running");
}).listen(PORT, () => console.log(`[HTTP] Health check server on port ${PORT}`));

async function main() {
  await initDB();
  const client = createClient();
  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(console.error);
