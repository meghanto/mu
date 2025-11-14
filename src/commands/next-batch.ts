import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Message,
} from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { TYPES } from "../types.js";
import errorMsg from "../utils/error-msg.js";
import { getGuildSettings } from "../utils/get-guild-settings.js";

@injectable()
export default class NextBatchCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("next-batch")
    .setDescription(
      "Adds the next batch of songs from a stored playlist to the queue.",
    )
    .addIntegerOption((option) =>
      option
        .setName("count")
        .setDescription("Number of songs to add (defaults to playlist limit).")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("playlist")
        .setDescription("The ID or title of the stored playlist to add from.")
        .setAutocomplete(true)
        .setRequired(false),
    );

  public readonly aliases = ["nb"];
  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async handleAutocompleteInteraction(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focusedValue = interaction.options.getFocused(true);
    if (focusedValue.name === "playlist") {
      const player = await this.playerManager.get(interaction.guild!.id);
      const storedPlaylists = player.getStoredPlaylistTitles(); // Need to implement this in Player

      const choices = storedPlaylists
        .filter((p) =>
          p.title.toLowerCase().includes(focusedValue.value.toLowerCase()),
        )
        .map((p) => ({ name: p.title, value: p.id }));

      await interaction.respond(choices.slice(0, 25)); // Discord limits to 25 choices
    }
  }

  private async handleCommand(
    interaction: ChatInputCommandInteraction | Message,
    count?: number,
    playlistIdArg?: string,
  ): Promise<void> {
    const guildId = interaction.guild!.id;
    const player = await this.playerManager.get(guildId);

    const settings = await getGuildSettings(guildId);
    const { playlistLimit } = settings;

    const songsToAddCount = count ?? playlistLimit;

    if (songsToAddCount < 1) {
      throw new Error("Count must be at least 1.");
    }

    let targetPlaylistId: string | undefined;

    if (playlistIdArg) {
      targetPlaylistId = playlistIdArg;
    } else {
      // If no playlistId is provided, try to infer
      const storedPlaylists = player.getStoredPlaylistIds(); // Need to implement this in Player
      if (storedPlaylists.length === 0) {
        await (interaction instanceof Message
          ? interaction.channel.send(
              errorMsg(
                "No playlist stored or it has expired. Play a playlist first.",
              ),
            )
          : interaction.reply({
              content: errorMsg(
                "No playlist stored or it has expired. Play a playlist first.",
              ),
              ephemeral: true,
            }));
        return;
      }

      if (storedPlaylists.length === 1) {
        targetPlaylistId = storedPlaylists[0];
      } else {
        await (interaction instanceof Message
          ? interaction.channel.send(
              errorMsg(
                "Multiple playlists stored. Please specify which one using its ID or title (e.g., `]next-batch <count> <playlist_id>`).",
              ),
            )
          : interaction.reply({
              content: errorMsg(
                'Multiple playlists stored. Please specify which one using the "playlist" option.',
              ),
              ephemeral: true,
            }));
        return;
      }
    }

    const storedPlaylist = player.getStoredPlaylist(targetPlaylistId); // Use targetPlaylistId

    if (!storedPlaylist) {
      await (interaction instanceof Message
        ? interaction.channel.send(
            errorMsg("Specified playlist not found or it has expired."),
          )
        : interaction.reply({
            content: errorMsg(
              "Specified playlist not found or it has expired.",
            ),
            ephemeral: true,
          }));
      return;
    }

    try {
      const addedSongs = await player.addNextBatch(
        targetPlaylistId,
        songsToAddCount,
      );

      if (addedSongs.length === 0) {
        await (interaction instanceof Message
          ? interaction.channel.send(
              errorMsg("No more songs to add from this playlist."),
            )
          : interaction.reply({
              content: errorMsg("No more songs to add from this playlist."),
              ephemeral: true,
            }));
        return;
      }

      const remainingSongs =
        storedPlaylist.songs.length - storedPlaylist.addedCount;

      let replyMsg = `Added ${addedSongs.length} songs from **${storedPlaylist.songs[0].playlist?.title ?? "playlist"}** to the queue.`;
      if (remainingSongs > 0) {
        replyMsg += ` ${remainingSongs} songs remaining.`;
      } else {
        replyMsg += " All songs from the playlist have been added.";
      }

      await (interaction instanceof Message
        ? interaction.channel.send(replyMsg)
        : interaction.reply(replyMsg));
    } catch (e: unknown) {
      await (interaction instanceof Message
        ? interaction.channel.send(errorMsg((e as Error).message))
        : interaction.reply({
            content: errorMsg((e as Error).message),
            ephemeral: true,
          }));
    }
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const count = interaction.options.getInteger("count") ?? undefined;
    const playlistId = interaction.options.getString("playlist") ?? undefined;
    await this.handleCommand(interaction, count, playlistId);
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const count = args.length > 0 ? parseInt(args[0], 10) : undefined;
    const playlistId = args.length > 1 ? args[1] : undefined; // Playlist ID is the second argument

    if (count !== undefined && isNaN(count)) {
      await message.channel.send(errorMsg("Invalid count. Must be a number."));
      return;
    }

    await this.handleCommand(message, count, playlistId);
  }
}
