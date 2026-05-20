const TTS_PRONUNCIATION = [
  [/\b6ix9ine\b/gi, "six nine"],
  [/\b6ix\b/gi, "six"],
  [/\b9ine\b/gi, "nine"],
  [/\b21 savage\b/gi, "twenty one savage"],
  [/\b24k\s?goldn\b/gi, "twenty four karat golden"],
  [/\b2pac\b/gi, "two pac"],
  [/\b50 cent\b/gi, "fifty cent"],
  [/\b6lack\b/gi, "black"],
  [/\$ap\b/gi, "money ap"],
  [/\bXXXTentacion\b/gi, "triple ex tentacion"],
  [/\bHalsey\b/gi, "halsey"],
  [/\bB[oó]y Hars[hi]ss\b/gi, "boy harshish"],
  [/\bMitski\b/gi, "mitski"],
  [/\bGrimes\b/gi, "grimes"],
  [/\bKacey\s+Musgraves\b/gi, "kacey musgraves"],
  [/\bJoji\b/gi, "joji"],
  [/\bRina\s+Sawayama\b/gi, "rina sawayama"],
  [/\bJPEGMafia\b/gi, "jpeg mafia"],
  [/\bDeath\s+Grips\b/gi, "death grips"],
  [/\bTyler,\s*the\s+Creator\b/gi, "tyler the creator"],
  [/\bChildish\s+Gambino\b/gi, "childish gambino"],
  [/\bMgmt\b/gi, "em gee em tee"],
];

/**
 * Clean text and apply custom pronunciation rules.
 * @param {string} text - The input text.
 * @returns {string} Cleaned and corrected text.
 */
function fixTTS(text) {
  if (!text) return "";
  
  // 1. Reemplazar el símbolo '#' por la palabra 'número ' para que suene natural
  let t = text.replace(/#/g, "número ");

  // 2. Eliminar emojis usando la propiedad Unicode 'Extended_Pictographic' (Node 10+)
  t = t.replace(/\p{Extended_Pictographic}/gu, "");

  // 3. Eliminar caracteres de formato Markdown e iconos comunes
  t = t.replace(/[*_`~[\]()🎙️…–—]/g, "");

  // 4. Limpiar espacios múltiples redundantes
  t = t.replace(/\s+/g, " ").trim();

  // 5. Aplicar reglas de pronunciación personalizadas (e.g. 6ix9ine -> six nine)
  for (const [pattern, replacement] of TTS_PRONUNCIATION) {
    t = t.replace(pattern, replacement);
  }

  return t;
}

/**
 * Generate Google Translate TTS URL as a direct fallback or default.
 * @param {string} text - The corrected text.
 * @returns {string} Google Translate TTS URL.
 */
function getGoogleTTSUrl(text) {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es&q=${encodeURIComponent(text.slice(0, 200))}`;
}

/**
 * Get TTS audio URL depending on provider.
 * @param {string} rawText - The input text to convert.
 * @returns {string} The URL of the TTS stream.
 */
function getTTSUrl(rawText) {
  const provider = (process.env.TTS_PROVIDER || "google").toLowerCase();
  const text = fixTTS(rawText);

  if (provider === "kokoro" || provider === "edge") {
    const edgeApiUrl = process.env.EDGE_API_URL || process.env.KOKORO_API_URL;
    const botUrl = process.env.BOT_PUBLIC_URL;
    const voice = process.env.EDGE_VOICE || process.env.KOKORO_VOICE || "es-MX-DaliaNeural";
    const lang = process.env.EDGE_LANG || process.env.KOKORO_LANG || "es";

    if (edgeApiUrl) {
      const cleanEdgeUrl = edgeApiUrl.endsWith("/") ? edgeApiUrl.slice(0, -1) : edgeApiUrl;
      
      // Si el bot corre localmente (localhost), Lavalink externo no puede conectarse a él.
      // En este caso, mandamos a Lavalink directamente al endpoint GET público de tu Render.
      const isLocalBot = !botUrl || botUrl.includes("localhost") || botUrl.includes("127.0.0.1");
      
      if (isLocalBot) {
        console.log(`[TTS] Bot local detectado. Dirigiendo a Lavalink directamente a Edge-TTS en Render: ${cleanEdgeUrl}`);
        return `${cleanEdgeUrl}/tts.mp3?text=${encodeURIComponent(text)}&voice=${voice}&lang=${lang}`;
      }

      // Si el bot está alojado públicamente (ej. en Render), usamos el proxy local que tiene fallback automático a Google
      const cleanBotUrl = botUrl.endsWith("/") ? botUrl.slice(0, -1) : botUrl;
      return `${cleanBotUrl}/api/tts?text=${encodeURIComponent(text)}`;
    } else {
      console.warn("[TTS] Edge-TTS está seleccionado, pero EDGE_API_URL no está definido en el .env. Usando Google Translate.");
      return getGoogleTTSUrl(text);
    }
  }

  // Default: Google Translate TTS
  return getGoogleTTSUrl(text);
}

/**
 * Search and queue a TTS track.
 * @param {object} player - The Lavalink player instance.
 * @param {string} text - The text to speak.
 * @returns {Promise<object|null>} The queued TTS track, or null if failed.
 */
async function queueTTS(player, text) {
  const provider = (process.env.TTS_PROVIDER || "google").toLowerCase();
  const isEdgeOrKokoro = provider === "kokoro" || provider === "edge";
  
  console.log(`[TTS] Proveedor activo: ${isEdgeOrKokoro ? "Render (Edge-TTS)" : "Google Translate"}`);

  try {
    const url = getTTSUrl(text);
    console.log(`[TTS] Intentando cargar audio desde: ${url}`);
    
    const startTime = Date.now();
    const result = await player.search({ query: url }, { username: "DJ", id: "dj" });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (result?.tracks?.length) {
      console.log(`[TTS] ¡Éxito! Audio TTS cargado correctamente desde Render en ${duration}s.`);
      const ttsTrack = result.tracks[0];
      ttsTrack._djIntro = true;
      return ttsTrack;
    }

    console.warn(`[TTS] La búsqueda de pista en Lavalink no devolvió resultados en ${duration}s (posible timeout o error en Render).`);

    // Si falló (ej. retornó vacío) y usamos Kokoro/Edge, hacemos el fallback a Google
    if (isEdgeOrKokoro) {
      console.warn("[TTS] Activando fallback automático: Cargando audio a través de Google TTS...");
      const fallbackUrl = getGoogleTTSUrl(text);
      const fallbackResult = await player.search({ query: fallbackUrl }, { username: "DJ", id: "dj" });
      if (fallbackResult?.tracks?.length) {
        console.log("[TTS] ¡Éxito en Fallback! Audio TTS cargado usando Google Translate.");
        const ttsTrack = fallbackResult.tracks[0];
        ttsTrack._djIntro = true;
        return ttsTrack;
      }
      console.error("[TTS] Fallo crítico: Google Translate tampoco pudo resolver la pista.");
    }
  } catch (err) {
    console.error("[TTS] Error durante la carga de Render TTS:", err.message);
    
    // Si hubo un error de red o timeout, reintentamos con Google
    if (isEdgeOrKokoro) {
      try {
        console.warn("[TTS] Activando fallback automático por excepción de red: Conectando a Google Translate...");
        const fallbackUrl = getGoogleTTSUrl(text);
        const fallbackResult = await player.search({ query: fallbackUrl }, { username: "DJ", id: "dj" });
        if (fallbackResult?.tracks?.length) {
          console.log("[TTS] ¡Éxito en Fallback! Audio TTS cargado usando Google Translate tras error en Render.");
          const ttsTrack = fallbackResult.tracks[0];
          ttsTrack._djIntro = true;
          return ttsTrack;
        }
      } catch (fallbackErr) {
        console.error("[TTS] Fallo crítico en el fallback de Google Translate:", fallbackErr.message);
      }
    }
  }
  return null;
}

module.exports = {
  TTS_PRONUNCIATION,
  fixTTS,
  getTTSUrl,
  getGoogleTTSUrl,
  queueTTS,
};
