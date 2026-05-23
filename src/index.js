require("dotenv").config();
const { initDB } = require("./database");
const { app: musicApi } = require("./api/server");

// Usar el puerto de Render o 3000 por defecto
const PORT = process.env.PORT || 3000;

async function main() {
  console.log("🚀 Starting Backend...");

  // 1. Inicializar Base de Datos
  try {
    await initDB();
    console.log("✅ Database initialized");
  } catch (err) {
    console.error("❌ Database initialization failed:", err.message);
    // No salimos, intentamos seguir para que el health check pueda responder error si es necesario
  }

  // 2. Iniciar Servidor Express (Maneja todo: API + Health Check)
  musicApi.listen(PORT, () => {
    console.log(`[SERVER] Running on port ${PORT}`);
  });

  // 3. TTS Keepalive (Opcional, si está configurado)
  const ttsProvider = (process.env.TTS_PROVIDER || "google").toLowerCase();
  if (ttsProvider === "edge" || ttsProvider === "kokoro") {
    const edgeApiUrl = process.env.EDGE_API_URL || process.env.KOKORO_API_URL;
    if (edgeApiUrl) {
      const warmUrl = `${edgeApiUrl.replace(/\/+$/, "")}/tts.mp3?text=keep+warm&voice=${process.env.EDGE_VOICE || "es-MX-DaliaNeural"}&lang=${process.env.EDGE_LANG || "es"}`;
      setInterval(() => {
        fetch(warmUrl).catch(() => {});
      }, 4 * 60 * 1000);
      console.log("[TTS] Keepalive enabled");
    }
  }
}

process.on("uncaughtException", (err) => console.error("❌ Uncaught:", err.message));
process.on("unhandledRejection", (reason) => console.error("❌ Unhandled:", reason?.message || reason));

main().catch(console.error);
