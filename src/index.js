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
    const t = [];
    const dns = require("dns");
    const host = process.env.LAVALINK_HOST || "localhost";
    async function run() {
      t.push(`Host: ${host}:${Number(process.env.LAVALINK_PORT) || 2333} secure=${process.env.LAVALINK_SECURE}`);
      t.push("\n=== DNS ===");
      try { const addrs = await dns.promises.resolve4(host); t.push(addrs.join(", ")); } catch (e) { t.push(`ERROR: ${e.message}`); }
      t.push("\n=== REST ===");
      try { const r = await fetch(`https://${host}/v4/info`, { headers: { Authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass" }, signal: AbortSignal.timeout(10000) }); t.push(`HTTP ${r.status} ${r.statusText}`); } catch (e) { t.push(`ERROR: ${e.message}`); }
      t.push("\n=== WS ===");
      t.push(await testWS(`ws${process.env.LAVALINK_SECURE === "true" ? "s" : ""}://${host}:${Number(process.env.LAVALINK_PORT) || 2333}/v4/websocket`, { Authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass", "User-Id": process.env.CLIENT_ID || "0", "Client-Name": "MusicBot" }));
      t.push("\n=== RAW HTTPS (no WebSocket) ===");
      try { const r = await fetch(`https://${host}/v4/websocket`, { headers: { Authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass" }, signal: AbortSignal.timeout(10000) }); t.push(`HTTP ${r.status} ${r.statusText}`); } catch (e) { t.push(`ERROR: ${e.message}`); }
      t.push("\n=== WS port 80 (no TLS) ===");
      t.push(await testWS(`ws://${host}:80/v4/websocket`, { Authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass", "User-Id": process.env.CLIENT_ID || "0", "Client-Name": "MusicBot" }));
      t.push("\n=== WS direct IP (bypass DNS) ===");
      try { const addrs = await dns.promises.resolve4(host); t.push(await testWS(`wss://${addrs[0]}:443/v4/websocket`, { Authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass", "User-Id": process.env.CLIENT_ID || "0", "Client-Name": "MusicBot", Host: host })); } catch (e) { t.push(`ERROR: ${e.message}`); }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(t.join("\n"));
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
