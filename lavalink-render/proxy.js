const net = require("net");

const LAVALINK_INTERNAL_PORT = 2334;

function pipe(a, b) {
  a.on("data", (d) => b.write(d));
  a.on("end", () => b.end());
  a.on("error", () => { try { b.destroy(); } catch {} });
  b.on("error", () => { try { a.destroy(); } catch {} });
}

const server = net.createServer((client) => {
  const backend = net.connect(LAVALINK_INTERNAL_PORT, "localhost", () => {
    pipe(client, backend);
    pipe(backend, client);
  });
  backend.on("error", () => client.destroy());
  client.on("error", () => backend.destroy());
});

const PORT = Number(process.env.PROXY_PORT) || 2333;
server.listen(PORT, () => console.log(`✅ TCP proxy listening on port ${PORT} → ${LAVALINK_INTERNAL_PORT}`));
