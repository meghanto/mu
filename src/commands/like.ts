import { ChatInputCommandInteraction, Message } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import fs from "fs/promises";
import path from "path";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { SongMetadata } from "../services/player.js";
import { parsePositionArgument } from "../utils/parse-position-argument.js";
import { createMockInteraction } from "../utils/mock-interaction.js";

const FAVORITES_DIR = path.join("data", "favorites");

@injectable()
export default class LikeCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("like")
    .setDescription(
      "saves the current song or a song from the queue as a favorite",
    )
    .addStringOption((option) =>
      option
        .setName("position")
        .setDescription(
          "position of the song in the queue (e.g., 1, current, next, +3)",
        )
        .setRequired(false),
    );

  public aliases = ["fav", ".f"];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const player = await this.playerManager.get(interaction.guild!.id);
    const userId = interaction.user.id;

    const positionArg = interaction.options.getString("position") ?? "current";

    let song: SongMetadata | null = null;

    try {
      const position = parsePositionArgument(positionArg, player);
      song = player.getSongAt(position);
    } catch (error) {
      await interaction.reply({
        content: (error as Error).message,
        ephemeral: true,
      });
      return;
    }

    if (!song) {
      await interaction.reply({
        content: "No song found at that position.",
        ephemeral: true,
      });
      return;
    }

    const userFavoritesPath = path.join(FAVORITES_DIR, `${userId}.json`);

    try {
      await fs.mkdir(FAVORITES_DIR, { recursive: true });

      let favorites: SongMetadata[] = [];
      try {
        const fileContent = await fs.readFile(userFavoritesPath, "utf-8");
        favorites = JSON.parse(fileContent) as SongMetadata[];
      } catch (readError) {
        // File doesn't exist or is empty, start with empty favorites
      }

      if (favorites.some((fav) => fav.url === song!.url)) {
        await interaction.reply({
          content: `"${song.title}" is already in your favorites.`,
          ephemeral: true,
        });
        return;
      }

      favorites.push(song);
      await fs.writeFile(userFavoritesPath, JSON.stringify(favorites, null, 2));

      await interaction.reply({
        content: `Added "${song.title}" to your favorites!`,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: "An error occurred while saving your favorite song.",
        ephemeral: true,
      });
    }
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const positionArg = args[0] ?? "current";

    const mockInteraction = createMockInteraction(message, {
      options: {
        getString: (name: string) => (name === "position" ? positionArg : null),
      },
    });
    await this.execute(mockInteraction);
  }
}
