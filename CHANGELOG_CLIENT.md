# Backend 2.0 — Cambios para el Cliente Android

## InnerTube cliente propio (reemplaza youtube-music-api)
El backend ahora implementa su propio cliente InnerTube en Node.js, eliminando la dependencia de la librería `youtube-music-api` (que daba 403 constante) y el archivo `ytmusic.js`.

**Qué cambió:**
- **Búsqueda**: Usa el mismo endpoint InnerTube que YouTube Music web. Resultados idénticos a la app oficial, 20 items por query.
- **Streaming**: Resuelve streams directamente desde InnerTube `/player` endpoint. Obtiene URLs directas de los CDN de YouTube sin necesidad de cookies, priorizando itag 251 (Opus 160kbps).
- **Sin 403**: Al usar WEB_REMUX client (mismo que music.youtube.com), YouTube no bloquea las peticiones.
- **Config se refresca** cada 30 minutos en background con cookies de sesión.
- **Rate limiter**: 10 búsquedas/segundo, 3 player requests/segundo. Cache de player por 6 horas.

**Qué cambió:**
- **Búsqueda**: Usa el mismo endpoint InnerTube que YouTube Music web. Resultados idénticos a la app oficial.
- **Streaming**: Resuelve streams directamente desde InnerTube `/player` endpoint. Obtiene URLs directas de los CDN de YouTube sin necesidad de cookies.
- **Sin 403**: Al usar WEB_REMUX client (mismo que music.youtube.com), YouTube no bloquea las peticiones.
- **Config se refresca** cada 30 minutos en background.

**Flujo de búsqueda ahora:**
1. InnerTube cliente propio → ~1s (funciona siempre, sin 403)
2. Lavalink → ~3s (fallback)
3. Tu `InnertubeClient` local (fallback final)

**Flujo de streaming ahora:**
1. InnerTube `/player` → ~1s (NUEVO, resuelve la mayoría de videos)
2. yt-dlp → ~3-5s (fallback)
3. play-dl → (fallback)
4. Invidious `iv.melmac.space` → (fallback)
5. Tu `InnertubeClient` local → (fallback final)

## Geo-blocking detectado
Cuando un video está bloqueado por región, el backend responde con:
```json
HTTP 403
{ "error": "Video blocked in this region", "blocked": true, "videoId": "..." }
```
El cliente debe usar su `InnertubeClient` local cuando recibe `blocked: true`, sin mostrar error al usuario.

## Streaming — Resolvedores limpiados
Se eliminaron resolvedores muertos:
- **Cobalt** — todas las instancias caídas (404/400), eliminado
- **Invidious** — limpiado, solo instancias que funcionan

## Nuevo campo: `videoId`
Cada track en `/api/search` ahora incluye `videoId` explícito.

```json
{
  "title": "Believer",
  "videoId": "W0DM5lcj6I0",
  "uri": "https://www.youtube.com/watch?v=W0DM5lcj6I0"
}
```

## Títulos limpios
El servidor limpia automáticamente `(Official Video)`, `[HD]`, `[4K]`, `(Full Audio)`, `(Visualizer)`, `(Audio Only)`, `- Topic`.

## Autocomplete (sugerencias)
```
GET /api/search/suggestions?q=imagin
```
Cache de 60s. Llama mientras el usuario escribe.

## Resumen de endpoints
| Endpoint | Cambio |
|---|---|
| `GET /api/search` | Respuesta <1s. InnerTube cliente propio. Sin 403. |
| `GET /api/search/suggestions` | **NUEVO.** Autocomplete. |
| `GET /api/stream` | InnerTube directo como primer resolvedor. 403 si bloqueado. |
