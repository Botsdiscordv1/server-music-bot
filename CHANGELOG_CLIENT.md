# Backend 2.0 — Cambios para el Cliente Android

## Busqueda ultra rápida (< 1s)
El backend ahora usa **InnerTube directo** en vez de Lavalink para las búsquedas de música (`source=ytmsearch`). Los resultados llegan en <1 segundo. Lavalink se consulta en segundo plano solo para enriquecer la caché.

**Impacto en el cliente:** La respuesta de `/api/search` es casi instantánea. No necesitas mostrar pantallas de carga largas.

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

## Streaming prioriza Opus (itag 251)
El servidor ahora pide primero **itag 251 (Opus 160kbps)** al resolver streams. Si no está disponible, cae a WebM audio y luego a cualquier formato.

**Impacto en el cliente:** Mejor calidad de audio y menor consumo de datos. El cliente no necesita cambios, el servidor maneja la selección.

## Resumen de endpoints
| Endpoint | Cambio |
|---|---|
| `GET /api/search` | Respuesta <1s. Nuevo campo `videoId`. Títulos limpios. |
| `GET /api/search/suggestions` | **NUEVO.** Autocomplete. |
| `GET /api/stream` | Prioriza Opus. Sin cambios en la interfaz. |
