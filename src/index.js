require("dotenv").config();

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  if (reason?.message?.includes("WebSocket was closed before the connection was established")) return;
  console.error("❌ Unhandled rejection:", reason?.message ?? reason);
});

const LAVALINK_HOST = process.env.LAVALINK_HOST || "localhost";
const LAVALINK_PORT = Number(process.env.LAVALINK_PORT) || 2333;
const LAVALINK_SECURE = process.env.LAVALINK_SECURE === "true";
const LAVALINK_PROTO = LAVALINK_SECURE ? "https" : "http";
const LAVALINK_WSPROTO = LAVALINK_SECURE ? "wss" : "ws";
const LAVALINK_AUTH = process.env.LAVALINK_PASSWORD || "youshallnotpass";

const http = require("http");
const { WebSocket } = require("ws");
const { createClient } = require("./client");
const { initDB } = require("./database");
const { getGoogleTTSUrl } = require("./utils/ttsService");
const { app: musicApi, startApi } = require("./api/server");

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
const API_PORT = Number(process.env.API_PORT) || 3001;
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;

  // Music API (Express) en el mismo puerto — necesario para Render
  if (pathname.startsWith("/api") && !(pathname === "/api/tts" && req.method === "GET")) {
    musicApi(req, res);
    return;
  }

  if (pathname === "/api/tts") {
    const text = urlObj.searchParams.get("text");
    if (!text) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing text parameter");
      return;
    }

    const fallbackUrl = getGoogleTTSUrl(text);
    const kokoroApiUrl = process.env.KOKORO_API_URL;

    if (!kokoroApiUrl) {
      console.warn("[Proxy TTS] KOKORO_API_URL is not set. Redirecting to Google TTS fallback.");
      res.writeHead(302, { Location: fallbackUrl });
      res.end();
      return;
    }

    const voice = urlObj.searchParams.get("voice") || process.env.KOKORO_VOICE || "ef_dora";
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const apiUrl = kokoroApiUrl.endsWith("/") ? kokoroApiUrl.slice(0, -1) : kokoroApiUrl;
    const targetUrl = `${apiUrl}/v1/audio/speech`;

    fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "kokoro", input: text, voice, response_format: "wav" }),
      signal: controller.signal,
    })
    .then((response) => {
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`Kokoro returned status ${response.status}`);
      res.writeHead(200, { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=31536000" });
      const { Readable } = require("stream");
      Readable.fromWeb(response.body).pipe(res);
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      console.error(`[Proxy TTS] Kokoro API failed (${err.message}). Redirecting to Google TTS.`);
      res.writeHead(302, { Location: fallbackUrl });
      res.end();
    });
    return;
  }

  if (req.url === "/test-lavalink") {
    const t = [];
    const theDns = require("dns");
    async function run() {
      t.push(`Host: ${LAVALINK_HOST}:${LAVALINK_PORT} (${LAVALINK_PROTO})`);
      t.push("\n=== DNS ===");
      try { const addrs = await theDns.promises.resolve4(LAVALINK_HOST); t.push(addrs.join(", ")); } catch (e) { t.push(`ERROR: ${e.message}`); }
      t.push("\n=== REST ===");
      try { const r = await fetch(`${LAVALINK_PROTO}://${LAVALINK_HOST}:${LAVALINK_PORT}/v4/info`, { headers: { Authorization: LAVALINK_AUTH }, signal: AbortSignal.timeout(10000) }); t.push(`HTTP ${r.status}`); } catch (e) { t.push(`ERROR: ${e.message}`); }
      t.push("\n=== WS ===");
      t.push(await testWS(`${LAVALINK_WSPROTO}://${LAVALINK_HOST}:${LAVALINK_PORT}/v4/websocket`, { Authorization: LAVALINK_AUTH, "User-Id": process.env.CLIENT_ID || "0", "Client-Name": "MusicBot" }));
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
  if (process.env.RENDER) {
    console.log(`[API] Music API mounted on port ${PORT} (Render)`);
  } else {
    await startApi(API_PORT);
  }
  const client = createClient();
  await client.login(process.env.DISCORD_TOKEN);

  const ttsProvider = (process.env.TTS_PROVIDER || "google").toLowerCase();
  if (ttsProvider === "edge" || ttsProvider === "kokoro") {
    const edgeApiUrl = process.env.EDGE_API_URL || process.env.KOKORO_API_URL;
    if (edgeApiUrl) {
      const warmUrl = `${edgeApiUrl.replace(/\/+$/, "")}/tts.mp3?text=keep+warm&voice=${process.env.EDGE_VOICE || "es-MX-DaliaNeural"}&lang=${process.env.EDGE_LANG || "es"}`;
      setInterval(() => { fetch(warmUrl).catch(() => {}); }, 4 * 60 * 1000);
      console.log("[TTS] Keepalive iniciado cada 4 minutos para evitar cold starts en Render");
    }
  }
}

main().catch(console.error);


