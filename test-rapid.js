const { WebSocket } = require("ws");

async function tryConnect() {
  return new Promise((resolve) => {
    const ws = new WebSocket(
      "wss://proyectosbotsantigravity-evqo.onrender.com:443/v4/websocket",
      {
        headers: {
          Authorization: "Rocky",
          "User-Id": "123456",
          "Client-Name": "MusicBot",
        },
        handshakeTimeout: 5000,
      }
    );
    let done = false;
    const finish = (status, msg) => {
      if (done) return;
      done = true;
      resolve({ status, msg });
    };
    ws.on("open", () => finish("OK", "connected"));
    ws.on("error", (err) => finish("ERR", err.message));
    ws.on("unexpected-response", (req, res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => finish("UNEXPECTED", `${res.statusCode}: ${body.slice(0, 100)}`));
    });
  });
}

(async () => {
  for (let i = 0; i < 10; i++) {
    const result = await tryConnect();
    console.log(`Attempt ${i + 1}: ${result.status} — ${result.msg}`);
    await new Promise((r) => setTimeout(r, 200));
  }
})();
