# Backend 2.0 — Changelog para el Cliente Android

## v2.0 — InnerTube Cliente Propio

### Cambio grande
El backend reemplazó la librería `youtube-music-api` por un **InnerTube cliente propio**. `ytmusic.js` eliminado.

### Latencia al reproducir (~5s → ~1s posible)

**Flujo actual (lento):**
```
1. /api/stream?refresh=true   (descarta caché, InnerTube ~1s)
2. /api/lyrics                 (espera ~1s)
3. /api/artist/info            (espera ~1s)
4. /api/metadata/enrich        (espera ~2s)
5. /api/proxy/audio            (proxy ~1.5s)
                              Total: ~5-6s
```

**Flujo óptimo:**
```
1. /api/stream?id=xxx&direct=true      ← sin refresh, usa caché 6h
2. EMPEZAR A REPRODUCIR INMEDIATAMENTE ← con la URL del CDN
3. (en background) /api/lyrics, /api/artist/info, /api/metadata/enrich
                                        Total: ~1-2s
```

### Reglas para el cliente

**Streaming:**
```
1. Intentar /api/stream?id=xxx&direct=true        → CDN directo (~0s si cache)
2. Si 403 (IP locked) → /api/stream?id=xxx         → proxy (~1.5s)
3. Si proxy falla      → InnertubeClient local     → siempre funciona
```

**No usar `refresh=true`** en reproducción normal. Solo usarlo si el usuario fuerza "refrescar" o si la URL dio error 403/404.

**No bloquear playback** esperando lyrics, artist info o enrich. Esos deben cargarse en segundo plano mientras la música ya suena.

### Endpoints

| Endpoint | Tiempo | Cache |
|---|---|---|
| `GET /api/search` | ~1s | 60s |
| `GET /api/stream` | ~1s (InnerTube) / ~0s (cache) | 6h |
| `GET /api/search/suggestions` | <500ms | 60s |
| `GET /api/lyrics` | ~1s | — |
| `GET /api/artist/info` | ~2s | — |
| `POST /api/metadata/enrich` | ~2-3s | — |
| `POST /api/warm` | ~2-3s (pre-resuelve 6 tracks) | — |

### Consideraciones técnicas
- **`?direct=true`** devuelve URL de `googlevideo.com`. El cliente (ExoPlayer/Media3) debe usar User-Agent de Android oficial para evitar cortes.
- **IP binding**: las URLs generadas por el backend tienen `ip=...` de Render. Si YouTube las rechaza desde otra IP, caer al proxy o al InnertubeClient local.
- **Cache de stream**: 6h. Una vez resuelto, `GET /api/stream` sin `refresh` devuelve la misma URL instantáneamente.
- **Rate limiter**: 10 search/s, 3 player requests/s a InnerTube.
