const http = require("http");
const https = require("https");

const BACKEND = process.env.BACKEND || "proyectosbosantigravity-evqo.onrender.com";
const PORT = Number(process.env.PORT) || 8080;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const opts = {
    hostname: BACKEND,
    port: 443,
    path: url.pathname + url.search,
    method: req.method,
    headers: { ...req.headers, host: BACKEND },
  };
  const proxy = https.request(opts, (backendRes) => {
    res.writeHead(backendRes.statusCode, backendRes.headers);
    backendRes.pipe(res);
  });
  proxy.on("error", () => { try { res.writeHead(502).end("Proxy error"); } catch {} });
  req.pipe(proxy);
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const opts = {
    hostname: BACKEND,
    port: 443,
    path: url.pathname + url.search,
    method: "GET",
    headers: { ...req.headers, host: BACKEND },
  };
  const backendReq = https.request(opts);
  backendReq.on("upgrade", (_, backendSocket) => {
    const accept = require("crypto")
      .createHash("sha1")
      .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-5AB5DC11B735")
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n"
    );
    socket.pipe(backendSocket);
    backendSocket.pipe(socket);
    socket.on("error", () => backendSocket.destroy());
    backendSocket.on("error", () => socket.destroy());
  });
  backendReq.on("error", () => socket.destroy());
  backendReq.end();
});

server.listen(PORT, () => console.log(`Proxy listening on ${PORT}, backend=${BACKEND}`));
