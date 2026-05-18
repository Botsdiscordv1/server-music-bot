require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

const commands = [];
const foldersPath = path.join(__dirname, "commands");

for (const folder of fs.readdirSync(foldersPath)) {
  const commandsPath = path.join(foldersPath, folder);
  for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js") && !f.startsWith("_"))) {
    const command = require(path.join(commandsPath, file));
    
    // Handle array of commands
    if (Array.isArray(command)) {
      for (const cmd of command) {
        if ("data" in cmd && "execute" in cmd) {
          commands.push(cmd.data.toJSON());
        }
      }
    } else if ("data" in command && "execute" in command) {
      commands.push(command.data.toJSON());
    }
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Deploying ${commands.length} slash commands...`);

    // For development: deploy to a specific guild (instant)
    // For production: deploy globally (up to 1hr to propagate)
    if (process.env.GUILD_ID) {
      // First, delete any existing global commands to avoid duplicates
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
      console.log("🧹 Cleared global commands to prevent duplicates");
      
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Deployed to guild ${process.env.GUILD_ID}`);
    } else {
      // Clear any leftover guild commands from previous guild-specific deploys
      try {
        const guilds = await rest.get("/users/@me/guilds");
        for (const guild of guilds) {
          await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id), { body: [] });
        }
        if (guilds.length) console.log(`🧹 Cleared guild commands from ${guilds.length} server(s)`);
      } catch {}

      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log("✅ Deployed globally");
    }
  } catch (err) {
    console.error("❌ Deploy error:", err);
  }
})();
