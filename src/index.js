require("dotenv").config();

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  if (reason?.message?.includes("WebSocket was closed before the connection was established")) return;
  console.error("❌ Unhandled rejection:", reason?.message ?? reason);
});

const LAVALINK_HOST = process.env.LAVALINK_HOST || "localhost";
const dns = require("dns");
const originalLookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  if (hostname === LAVALINK_HOST) {
    const resolver = new dns.Resolver();
    resolver.setServers(["8.8.8.8"]);
    resolver.resolve4(hostname, (err, addresses) => {
      if (err || !addresses?.length) return originalLookup(hostname, options, callback);
      const family = options?.family === 6 ? 6 : 4;
      callback(null, addresses[0], family);
    });
    return { cancel() {} };
  }
  return originalLookup(hostname, options, callback);
};

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
    const theDns = require("dns");
    async function run() {
      t.push(`Host: ${LAVALINK_HOST}:${Number(process.env.LAVALINK_PORT) || 2333} secure=${process.env.LAVALINK_SECURE}`);
      t.push("\n=== System DNS ===");
      try { const addrs = await theDns.promises.resolve4(LAVALINK_HOST); t.push(addrs.join(", ")); } catch (e) { t.push(`ERROR: ${e.message}`); }
      t.push("\n=== Google DNS (8.8.8.8) ===");
      try { const r = new theDns.promises.Resolver(); r.setServers(["8.8.8.8"]); const cf = await r.resolve4(LAVALINK_HOST); t.push(cf.join(", ")); } catch (e) { t.push(`ERROR: ${e.message}`); }
      t.push("\n=== REST ===");
      try { const r = await fetch(`https://${LAVALINK_HOST}/v4/info`, { headers: { Authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass" }, signal: AbortSignal.timeout(10000) }); t.push(`HTTP ${r.status}`); } catch (e) { t.push(`ERROR: ${e.message}`); }
      t.push("\n=== WS ===");
      t.push(await testWS(`ws${process.env.LAVALINK_SECURE === "true" ? "s" : ""}://${LAVALINK_HOST}:${Number(process.env.LAVALINK_PORT) || 2333}/v4/websocket`, { Authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass", "User-Id": process.env.CLIENT_ID || "0", "Client-Name": "MusicBot" }));
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
