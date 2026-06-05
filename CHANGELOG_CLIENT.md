# Backend 2.0 — Cambios para el Cliente Android

## Búsqueda ultra rápida (< 1s)
El backend ahora usa **InnerTube directo** en vez de Lavalink para las búsquedas de música (`source=ytmsearch`). Los resultados llegan en <1 segundo. Lavalink se consulta en segundo plano solo para enriquecer la caché.

**Impacto en el cliente:** La respuesta de `/api/search` es casi instantánea. No necesitas mostrar pantallas de carga largas.

## Estabilidad de búsqueda
InnerTube da 403 intermitentemente (YouTube bloquea ciertos API keys). El backend ahora:
- **No reintenta** en 403 — falla inmediatamente a Lavalink (que siempre funciona, ~3s)
- Refresca la configuración InnerTube en background cada 15 minutos
- La búsqueda **nunca se cuelga** — si InnerTube falla, Lavalink responde

**Impacto en el cliente:** Las búsquedas siempre responden. Si notas lentitud ocasional (~3s en vez de <1s), es el fallback a Lavalink actuando. Tu `InnertubeClient` local puede usarse como fallback adicional si el backend tarda.

## Streaming — Resolvedores limpiados
Se eliminaron resolvedores muertos que añadían latencia:
- **Cobalt** — las 4 instancias estaban caídas (404/400), quitado completamente
- **Invidious** — limpiado a solo instancias que funcionan: `iv.melmac.space` como principal

**Flujo actual:** yt-dlp (primario) → play-dl (fallback) → Invidious (fallback final) → tu `InnertubeClient` local

**Impacto en el cliente:** Los streams fallan menos y más rápido. Si el backend no puede resolver un stream, tu `InnertubeClient` local (en `YoutubeStreamResolver`) es el respaldo final, como ya está implementado.

## Nuevo campo: `videoId`
Cada track en `/api/search` ahora incluye `videoId` (el ID de YouTube de 11 caracteres). Antes solo venía en la `uri`. Ahora lo tienes explícito.

```json
{
  "title": "Believer",
  "videoId": "W0DM5lcj6I0",
  "uri": "https://www.youtube.com/watch?v=W0DM5lcj6I0"
}
```

**Impacto en el cliente:** Usa `videoId` directamente para el streaming optimizado. No necesitas parsear la `uri`.

## Títulos limpios desde la primera respuesta
El servidor limpia automáticamente:
- `(Official Video)`, `(Official Audio)`, `(Lyric Video)`
- `[HD]`, `[4K]`, `[HQ]`
- `(Full Audio)`, `(Visualizer)`, `(Audio Only)`
- `- Topic` en autores

**Impacto en el cliente:** Los títulos llegan limpios. Si implementaste `LyricsRefiner` del lado del cliente, puedes desactivarlo o dejarlo como respaldo.

## Nuevo endpoint: Sugerencias (Autocomplete)
```
GET /api/search/suggestions?q=imagin
```
```json
{
  "query": "imagin",
  "suggestions": ["imagine dragons", "imagination", "imagining"]
}
```

**Impacto en el cliente:** Puedes llamar a este endpoint mientras el usuario escribe, en vez de usar el autocomplete de Google directo o el de YouTube. Cache de 60s.

## Streaming prioriza Opus
El servidor ahora pide primero `bestaudio[ext=webm]` (Opus) al resolver streams. Si no está disponible, cae a `bestaudio[ext=m4a]` (AAC) y luego a cualquier formato.

**Impacto en el cliente:** Mejor calidad de audio y menor consumo de datos. El cliente no necesita cambios, el servidor maneja la selección. Si tu `InnertubeClient` local resuelve streams, también prioriza Opus/WebM.

## Resumen de endpoints
| Endpoint | Cambio |
|---|---|
| `GET /api/search` | Respuesta <1s (~3s si fallback a Lavalink). Nuevo campo `videoId`. Títulos limpios. |
| `GET /api/search/suggestions` | **NUEVO.** Autocomplete. |
| `GET /api/stream` | Prioriza Opus. Sin cambios en la interfaz. Resolvedores muertos eliminados. |
