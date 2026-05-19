require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

const PROFILE_COMMANDS = ["play", "skip", "stop", "lyrics", "filter", "farm"];

const allCommands = [];
const foldersPath = path.join(__dirname, "commands");

for (const folder of fs.readdirSync(foldersPath)) {
  const commandsPath = path.join(foldersPath, folder);
  for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js") && !f.startsWith("_"))) {
    const command = require(path.join(commandsPath, file));
    if (Array.isArray(command)) {
      for (const cmd of command) {
        if ("data" in cmd && "execute" in cmd) {
          allCommands.push(cmd.data.toJSON());
        }
      }
    } else if ("data" in command && "execute" in command) {
      allCommands.push(command.data.toJSON());
    }
  }
}

const globalCommands = allCommands.filter((c) => PROFILE_COMMANDS.includes(c.name));
const guildCommands = allCommands.filter((c) => !PROFILE_COMMANDS.includes(c.name));

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    // Clear old global commands
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    console.log("🧹 Cleared old global commands");

    // Deploy profile commands globally
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: globalCommands });
    console.log(`✅ ${globalCommands.length} commands deployed globally (profile): ${globalCommands.map(c => c.name).join(", ")}`);

    const guildId = process.env.GUILD_ID;
    if (guildId && guildCommands.length) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: guildCommands });
      console.log(`✅ ${guildCommands.length} guild commands deployed to ${guildId}`);
    }

    console.log("🎉 Hybrid deploy complete");
  } catch (err) {
    console.error("❌ Deploy error:", err);
  }
})();
