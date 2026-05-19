require("dotenv").config();

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  if (reason?.message?.includes("WebSocket was closed before the connection was established")) return;
  console.error("❌ Unhandled rejection:", reason?.message ?? reason);
});

const http = require("http");
const { WebSocket } = require("ws");
const { createClient } = require("./client");
const { initDB } = require("./database");

const PORT = Number(process.env.PORT) || 3000;
const server = http.createServer((req, res) => {
  if (req.url === "/test-lavalink") {
    const start = Date.now();
    const ws = new WebSocket(
      `ws${process.env.LAVALINK_SECURE === "true" ? "s" : ""}://${process.env.LAVALINK_HOST || "localhost"}:${Number(process.env.LAVALINK_PORT) || 2333}/v4/websocket`,
      {
        headers: { Authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass", "User-Id": process.env.CLIENT_ID || "0", "Client-Name": "MusicBot" },
        handshakeTimeout: 10000,
      }
    );
    ws.on("open", () => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`OK (${Date.now() - start}ms)`);
      ws.close();
    });
    ws.on("error", (err) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`ERROR: ${err.message}`);
    });
    ws.on("unexpected-response", (_, r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(`UNEXPECTED: ${r.statusCode} — ${body.slice(0, 200)}`);
      });
    });
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running");
});
server.listen(PORT, () => console.log(`[HTTP] Health check on port ${PORT}`));

async function main() {
  await initDB();
  const client = createClient();
  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(console.error);
