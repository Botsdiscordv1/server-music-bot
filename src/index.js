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

function testWS(url, headers) {
  return new Promise((resolve) => {
    const start = Date.now();
    const ws = new WebSocket(url, headers ? { headers, handshakeTimeout: 10000 } : { handshakeTimeout: 10000 });
    const timeout = setTimeout(() => { ws.close(); resolve("TIMEOUT (15s)"); }, 15000);
    ws.on("open", () => { clearTimeout(timeout); resolve(`OK (${Date.now() - start}ms)`); ws.close(); });
    ws.on("error", (err) => { clearTimeout(timeout); resolve(`ERROR: ${err.message}`); });
    ws.on("unexpected-response", (_, r) => {
      clearTimeout(timeout);
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => resolve(`UNEXPECTED: ${r.statusCode} — ${body.slice(0, 100)}`));
    });
  });
}

const PORT = Number(process.env.PORT) || 3000;
const server = http.createServer((req, res) => {
  if (req.url === "/test-lavalink") {
    const tests = [];
    async function run() {
      tests.push("=== TEST 1: Lavalink REST ===");
      try {
        const r = await fetch(`https://${process.env.LAVALINK_HOST || "localhost"}/v4/info`, { headers: { Authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass" }, signal: AbortSignal.timeout(10000) });
        tests.push(`HTTP ${r.status} ${r.ok ? "OK" : "FAIL"}`);
      } catch (e) { tests.push(`ERROR: ${e.message}`); }

      tests.push("\n=== TEST 2: WebSocket to Lavalink ===");
      tests.push(await testWS(`ws${process.env.LAVALINK_SECURE === "true" ? "s" : ""}://${process.env.LAVALINK_HOST || "localhost"}:${Number(process.env.LAVALINK_PORT) || 2333}/v4/websocket`, { Authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass", "User-Id": process.env.CLIENT_ID || "0", "Client-Name": "MusicBot" }));

      tests.push("\n=== TEST 3: WebSocket public echo ===");
      tests.push(await testWS("wss://ws.postman-echo.com/raw"));

      tests.push("\n=== TEST 4: HTTPS google.com ===");
      try {
        const r = await fetch("https://google.com", { signal: AbortSignal.timeout(10000) });
        tests.push(`HTTP ${r.status} ${r.ok ? "OK" : "FAIL"}`);
      } catch (e) { tests.push(`ERROR: ${e.message}`); }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(tests.join("\n"));
    }
    run().catch(e => { res.writeHead(500); res.end(e.message); });
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
