const { Client, GatewayIntentBits, Collection } = require("discord.js");
const { LavalinkManager } = require("lavalink-client");
const fs = require("fs");
const path = require("path");

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [],
    rest: { retries: 3, timeout: 15000 },
  });

  client.commands = new Collection();

  client.lavalink = new LavalinkManager({
    nodes: [
      {
        id: "main",
        host: process.env.LAVALINK_HOST || "localhost",
        port: Number(process.env.LAVALINK_PORT) || 2333,
        authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass",
        secure: process.env.LAVALINK_SECURE === "true",
        retryDelay: 5000,
        maxRetry: -1,
      },
    ],
    sendToShard: (guildId, payload) => {
      const guild = client.guilds.cache.get(guildId);
      if (guild) guild.shard.send(payload);
    },
    client: {
      id: process.env.CLIENT_ID,
      username: "MusicBot",
    },
    playerOptions: {
      applyVolumeAsFilter: false,
      clientBasedPositionUpdateInterval: 5000,
      defaultSearchPlatform: "ytmsearch",
      volumeDecrementer: 0.75,
      onDisconnect: {
        destroyPlayer: false,
        autoReconnect: true,
      },
      maxHistoryPerGuild: 50,
    },
    autoSkip: true,
  });

  // ── Forward Discord voice events to Lavalink ──────────────────────────
  client.ws.on("VOICE_SERVER_UPDATE", (data) => {
    client.lavalink.sendRawData({ t: "VOICE_SERVER_UPDATE", d: data });
  });
  client.ws.on("VOICE_STATE_UPDATE", (data) => {
    client.lavalink.sendRawData({ t: "VOICE_STATE_UPDATE", d: data });
  });

  // ── Load commands ─────────────────────────────────────────────────────
  loadCommands(client);

  // ── Load events ───────────────────────────────────────────────────────
  loadEvents(client);

  return client;
}

function loadCommands(client) {
  const foldersPath = path.join(__dirname, "commands");
  const commandFolders = fs.readdirSync(foldersPath);

  for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs
      .readdirSync(commandsPath)
      .filter((f) => f.endsWith(".js"));

    for (const file of commandFiles) {
      const command = require(path.join(commandsPath, file));
      
      // Handle array of commands (playlist.js, history.js, stats.js)
      if (Array.isArray(command)) {
        for (const cmd of command) {
          if ("data" in cmd && "execute" in cmd) {
            client.commands.set(cmd.data.name, cmd);
            console.log(`✅ Loaded command: /${cmd.data.name}`);
          }
        }
      } else if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        console.log(`✅ Loaded command: /${command.data.name}`);
      }
    }
  }
}

function loadEvents(client) {
  // Discord events
  const discordEventsPath = path.join(__dirname, "events", "discord");
  for (const file of fs.readdirSync(discordEventsPath).filter((f) => f.endsWith(".js"))) {
    const event = require(path.join(discordEventsPath, file));
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
    console.log(`✅ Loaded Discord event: ${event.name}`);
  }

  // Lavalink events
  const lavalinkEventsPath = path.join(__dirname, "events", "lavalink");
  const nodeEvents = ["connect", "disconnect", "error", "reconnect"];
  const managerEvents = ["trackStart", "trackEnd", "trackStuck", "trackError", "queueEnd"];

  for (const file of fs.readdirSync(lavalinkEventsPath).filter((f) => f.endsWith(".js"))) {
    const event = require(path.join(lavalinkEventsPath, file));
    if (nodeEvents.includes(event.name)) {
      client.lavalink.nodeManager.on(event.name, (...args) =>
        event.execute(...args, client)
      );
    } else if (managerEvents.includes(event.name)) {
      client.lavalink.on(event.name, (...args) =>
        event.execute(...args, client)
      );
    }
    const label = event.name === "error" ? "error-handler" : event.name;
    console.log(`✅ Loaded Lavalink event: ${label}`);
  }
}

module.exports = { createClient };
