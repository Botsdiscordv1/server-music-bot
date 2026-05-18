const http = require("http");
const net = require("net");

const LAVALINK_PORT = 2333;

function pipe(a, b) {
  a.on("data", (d) => b.write(d));
  a.on("end", () => b.end());
  a.on("error", () => { try { b.destroy(); } catch {} });
  b.on("error", () => { try { a.destroy(); } catch {} });
}

const server = http.createServer((req, res) => {
  const opts = {
    hostname: "localhost",
    port: LAVALINK_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };
  const preq = http.request(opts, (pres) => {
    res.writeHead(pres.statusCode, pres.headers);
    pres.pipe(res);
  });
  preq.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(preq);
});

server.on("upgrade", (req, socket, head) => {
  // Render blocks WebSocket on /v4/websocket, so lavalink-client connects to /
  // Rewrite to Lavalink's actual WebSocket path
  const targetPath = "/v4/websocket";
  const psock = net.connect(LAVALINK_PORT, "localhost", () => {
    const lines = [
      `GET ${targetPath} HTTP/1.1`,
      `Host: localhost:${LAVALINK_PORT}`,
      `Connection: Upgrade`,
      `Upgrade: websocket`,
    ];
    for (const [k, v] of Object.entries(req.headers)) {
      if (!["host", "connection", "upgrade"].includes(k.toLowerCase())) {
        lines.push(`${k}: ${v}`);
      }
    }
    lines.push("", "");
    psock.write(lines.join("\r\n"));
    psock.write(head);
    pipe(socket, psock);
  });
  psock.on("error", () => socket.destroy());
});

server.listen(10000, () => console.log("✅ Proxy listening on port 10000"));
