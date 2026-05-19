const { WebSocket } = require("ws");

const ws = new WebSocket(
  "wss://proyectosbotsantigravity-evqo.onrender.com:443/v4/websocket",
  {
    headers: {
      Authorization: "Rocky",
      "User-Id": "123456",
      "Client-Name": "test/1.0",
    },
    handshakeTimeout: 10000,
  }
);

ws.on("open", () => {
  console.log("✅ WebSocket connected!");
  ws.close();
});
ws.on("error", (err) => {
  console.log("❌ Error:", err.message);
});
ws.on("unexpected-response", (req, res) => {
  let body = "";
  res.on("data", (chunk) => (body += chunk));
  res.on("end", () => {
    console.log(`❌ Unexpected response: ${res.statusCode} — ${body.slice(0, 200)}`);
  });
});
