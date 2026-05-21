const { SlashCommandBuilder } = require("discord.js");
const { requirePlayer } = require("../../utils/checks");
const { getLyrics, getCurrentLine } = require("../../services/lrclib");
const { errorEmbed } = require("../../utils/embeds");

const UPDATE_INTERVAL = 0.5;
const LRC_OFFSET = 0.05;
const MAX_DURATION = 10 * 60 * 1000;

function getPosition(p) {
    return p.position;
}

async function startKaraoke(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    const current = player?.queue?.current;

    if (!current) {
        return interaction.editReply({ embeds: [errorEmbed("No hay ninguna canción reproduciéndose.")] });
    }

    const trackName = current.info.title;
    const artistName = (current.info.author || "").replace(/\s*-\s*Topic$/, "");

    let lyrics = player._lyricsCache?.found && player._lyricsCache?.synced?.length
        ? player._lyricsCache
        : await getLyrics(trackName, artistName);

    if (!lyrics.synced && trackName) {
      const cleanTrack = trackName.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").replace(/-\s*(Topic|Lyrics|Official|Video|Audio|HD|HQ)/gi, "").replace(/\(\s*Topic\s*\)/gi, "").replace(/\s+/g, " ").trim();
      if (cleanTrack !== trackName) {
        lyrics = await getLyrics(cleanTrack, artistName);
      }
    }

    if (!lyrics.synced) {
      lyrics = await getLyrics(trackName);
    }

    if (!lyrics.found || !lyrics.synced) {
        return interaction.editReply({
            embeds: [errorEmbed(
                lyrics.found
                    ? `**${trackName}** no tiene letras sincronizadas, solo texto plano. Usa \`/lyrics\` para verlas.`
                    : `No se encontraron letras para **${trackName}**.`
            )],
        });
    }

    const lines = lyrics.synced;
    const initialPosition = getPosition(player);
    const initialEmbed = buildKaraokeEmbed(lines, initialPosition, trackName, artistName, current);
    await interaction.editReply({ embeds: [initialEmbed] });
    const message = await interaction.fetchReply();

    let lastLineIndex = -1;

    const interval = setInterval(async () => {
        try {
            const activePlayer = client.lavalink.getPlayer(interaction.guildId);
            if (!activePlayer || !activePlayer.queue.current) {
                clearInterval(interval);
                await message.edit({
                    embeds: [{ color: 0x5865f2, description: "🎤 Karaoke terminado." }],
                }).catch(() => { });
                return;
            }

            if (activePlayer.paused) {
                return;
            }

            if (activePlayer.queue.current.info.title !== trackName) {
                clearInterval(interval);
                await message.edit({
                    embeds: [{ color: 0x5865f2, description: "🎤 La canción cambió — karaoke terminado." }],
                }).catch(() => { });
                return;
            }

            const position = getPosition(activePlayer) + LRC_OFFSET;
            const { index } = getCurrentLine(lines, position);

            if (index !== lastLineIndex) {
                lastLineIndex = index;
                const embed = buildKaraokeEmbed(lines, position, trackName, artistName, current);
                await message.edit({ embeds: [embed] }).catch(() => clearInterval(interval));
            }

        } catch {
            clearInterval(interval);
        }
    }, UPDATE_INTERVAL);

    setTimeout(() => clearInterval(interval), MAX_DURATION);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("karaoke")
        .setDescription("Muestra las letras sincronizadas de la canción actual en tiempo real."),

    async execute(interaction, client) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
        await startKaraoke(interaction, client);
    },

    startKaraoke,
};

function buildKaraokeEmbed(lines, positionMs, trackName, artistName, track) {
    const { index } = getCurrentLine(lines, positionMs);

    const start = Math.max(0, index - 2);
    const end = Math.min(lines.length - 1, index + 2);

    const display = [];
    for (let i = start; i <= end; i++) {
        if (i === index) {
            display.push(`**➤ ${lines[i].text}**`);
        } else {
            display.push(`\`  ${lines[i].text}\``);
        }
    }

    const thumbnail = track.info.artworkUrl || null;
    const pos = formatTime(positionMs);
    const dur = formatTime(track.info.duration);

    return {
        color: 0x1db954,
        author: { name: "🎤 Karaoke — Letras en tiempo real" },
        title: `${trackName} — ${artistName}`,
        description: display.join("\n\n") || "*(instrumental)*",
        thumbnail: thumbnail ? { url: thumbnail } : undefined,
        footer: { text: `${pos} / ${dur}  •  Powered by LRCLib` },
    };
}

function formatTime(ms) {
    if (!ms || ms < 0) return "0:00";
    const totalSec = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}