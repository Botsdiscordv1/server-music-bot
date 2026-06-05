# Backend 2.0 — Changelog para el Cliente Android

## v2.0 — InnerTube Cliente Propio

### Cambio grande
El backend reemplazó la librería `youtube-music-api` (daba 403 constante) por un **InnerTube cliente propio** en Node.js, implementado desde cero. El archivo `ytmusic.js` fue eliminado.

### Impacto en el cliente
La API responde igual en formato, pero con MUCHA más velocidad y confiabilidad.

---

### Búsqueda (<1s, sin 403)
- Las llamadas a `GET /api/search?source=ytmsearch` ahora usan el mismo endpoint InnerTube que YouTube Music web.
- Resultados idénticos a la app oficial, 20 items por query.
- **Ya no hay 403**. Si por algún motivo InnerTube falla, cae automáticamente a Lavalink (~3s).
- Rate limit: 10 búsquedas/segundo (suficiente para autocomplete).

### Streaming (CDN directo, sin cookies)
- `GET /api/stream` ahora intenta primero InnerTube `/player` (~1s).
- Obtiene URLs directas del CDN de YouTube (`googlevideo.com`) sin cookies.
- Prioriza itag 251 (Opus 160kbps) — mejor calidad, menor consumo.
- Cache de 6h por video (no se re-resuelve cada vez).

**Flujo actual:**
1. InnerTube `/player` → ~1s ✅
2. yt-dlp → ~3s (fallback)
3. play-dl → (si no está en Render)
4. Invidious `iv.melmac.space` → (fallback final)
5. Tu `InnertubeClient` local → (último recurso)

### Streaming directo (opcional, más rápido)
Nuevo parámetro `?direct=true` en `/api/stream` para saltarse el proxy y recibir la URL del CDN directa:

```
GET /api/stream?id=xxx&direct=true
→ { "url": "https://rr2...googlevideo.com/..." }
```

**Ahorro:** ~1-1.5s (elimina el hop del proxy).

**Consideraciones:**
- Las URLs de `googlevideo.com` incluyen `ip=` con la IP del servidor (Render). Pueden funcionar o dar 403 Forbidden desde otra IP.
- **Flujo recomendado:**
  1. Intentar `direct=true` → si funciona, reproducción inmediata
  2. Si da 403 → llamar sin `direct` (usa proxy, siempre funciona)
  3. Si proxy falla → usar `InnertubeClient` local
- El cliente (ExoPlayer/Media3) debe configurar User-Agent de Android oficial para evitar cortes.

### Geo-blocking
Cuando un video está bloqueado por región, el backend responde:
```json
HTTP 403
{ "error": "Video blocked in this region", "blocked": true, "videoId": "..." }
```
Tu app debe usar su `InnertubeClient` local al recibir `blocked: true`, sin mostrar error al usuario.

### Resolvedores limpiados
- **Cobalt** — eliminado (todas las instancias muertas).
- **Invidious** — reducido a instancias que funcionan.

### Otros cambios
| Feature | Detalle |
|---|---|
| `videoId` en search | Ahora incluido siempre en `GET /api/search` |
| Títulos limpios | Se eliminan `(Official Video)`, `[HD]`, `[4K]`, `(Full Audio)`, etc. |
| Autocomplete | `GET /api/search/suggestions?q=...` |
| Rate limiter | 10 search/s, 3 player/s a InnerTube |
| Refresh automático | Config de InnerTube renovada cada 30min |
| Cookie jar | Cookies de sesión capturadas del homepage de YouTube |

### Cómo debe responder el cliente cuando un stream falla

```
HTTP 200 { "url": "..." }           → Usar URL directamente
HTTP 403 { "blocked": true }        → Usar InnertubeClient local
HTTP 404 { "error": "..." }         → Reintentar o usar InnertubeClient local
Error de red / timeout              → Usar InnertubeClient local
```

### Resumen de endpoints
| Endpoint | Cambio |
|---|---|
| `GET /api/search` | InnerTube cliente propio. <1s. Sin 403. |
| `GET /api/search/suggestions` | Autocomplete. Cache 60s. |
| `GET /api/stream` | InnerTube directo como primer resolvedor. 403 si bloqueado. Cache 6h. |
| `POST /api/metadata/enrich` | Usa InnerTube para buscar tracks (antes youtube-music-api). |
