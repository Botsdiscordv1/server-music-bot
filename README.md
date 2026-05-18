# 🎵 Discord Music Bot

Bot de música para Discord con metadatos de Spotify y letras de LRCLib.

## Stack
- **discord.js** v14
- **lavalink-client** (Lavalink v4)
- **Spotify Web API** — metadatos de canciones
- **LRCLib** — letras sincronizadas (sin API key)
- **MongoDB** — playlists y configuración

---

## ⚡ Setup rápido

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
```bash
cp .env.example .env
# Edita .env con tus credenciales
```

### 3. Configurar Lavalink
```bash
# Descarga Lavalink.jar desde:
# https://github.com/lavalink-devs/Lavalink/releases/latest

# Coloca el archivo en /lavalink/Lavalink.jar
# La config ya está en lavalink/application.yml

# Inicia Lavalink (requiere Java 17+):
cd lavalink
java -jar Lavalink.jar
```

### 4. Desplegar comandos slash
```bash
# Para desarrollo (guild específico, instantáneo):
GUILD_ID=tu_guild_id npm run deploy

# Para producción (global, hasta 1h):
npm run deploy
```

### 5. Iniciar el bot
```bash
# Producción
npm start

# Desarrollo con auto-reload
npm run dev
```

---

## 📋 Comandos

| Comando | Descripción |
|---------|-------------|
| `/play <query>` | Reproduce una canción, URL de Spotify o YouTube |
| `/skip [to]` | Salta la canción actual o va a una posición |
| `/stop` | Detiene la reproducción y limpia la cola |
| `/pause` / `/resume` | Pausa o reanuda |
| `/volume [level]` | Ajusta el volumen (1-150) |
| `/loop <mode>` | Repite: off / track / queue |
| `/shuffle` | Mezcla la cola |
| `/queue [page]` | Muestra la cola paginada |
| `/nowplaying` | Info de la canción actual |
| `/lyrics [song] [artist]` | Letras de la canción actual o una específica |
| `/recommend` | Recomendaciones de Spotify basadas en la canción actual |
| `/filter <effect>` | Filtros de audio: bassboost, nightcore, 8d, karaoke, etc. |
| `/ping` | Latencia del bot |
| `/help` | Lista de comandos |

---

## 🔑 Obtener credenciales

### Discord Bot
1. Ve a https://discord.com/developers/applications
2. New Application → Bot → copia el token
3. Activa los **Privileged Gateway Intents**: Server Members, Message Content
4. Genera invite URL con permisos: `bot` + `applications.commands`

### Spotify Web API
1. Ve a https://developer.spotify.com/dashboard
2. Create App → copia `Client ID` y `Client Secret`
3. No necesitas redirect URI (usamos Client Credentials)

### LRCLib
- Sin registro. Sin API key. Funciona directo ✅

### MongoDB
- Local: `mongodb://localhost:27017/musicbot`
- Atlas (gratis): https://www.mongodb.com/atlas

---

## 📁 Estructura del proyecto

```
src/
├── index.js              ← entrada
├── client.js             ← Discord + Lavalink setup
├── database.js           ← MongoDB schemas
├── deploy-commands.js    ← despliega slash commands
├── commands/
│   ├── music/
│   │   ├── play.js
│   │   ├── skip.js / stop.js / pause.js / resume.js
│   │   ├── queue.js / nowplaying.js
│   │   ├── lyrics.js     ← LRCLib
│   │   ├── recommend.js  ← Spotify recommendations
│   │   ├── volume.js / loop.js / shuffle.js
│   │   └── filters.js
│   └── util/
│       ├── ping.js
│       └── help.js
├── events/
│   ├── discord/          ← ready, interactionCreate, voiceStateUpdate
│   └── lavalink/         ← trackStart, trackEnd, nodeEvents
├── services/
│   ├── spotify.js        ← Spotify Web API wrapper
│   └── lrclib.js         ← LRCLib wrapper
└── utils/
    ├── embeds.js          ← embeds reutilizables
    └── checks.js          ← validaciones (voice channel, DJ role, etc.)
lavalink/
└── application.yml        ← config de Lavalink + LavaSrc plugin
```
