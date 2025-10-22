import { ChatInputCommandInteraction, Message } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { parsePositionArgument } from "../utils/parse-position-argument.js";
import {
  addSongToTag,
  isValidTagName,
  readUserTags,
  writeUserTags,
} from "../utils/user-tags.js";
import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class TagCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("tag")
    .setDescription("tag a song under a given tag name")
    .addStringOption((option) =>
      option.setName("name").setDescription("tag name").setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("position")
        .setDescription(
          "position in the queue (e.g., current, next, 5, last-1)",
        )
        .setRequired(false),
    );

  public readonly aliases = [] as string[];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const player = await this.playerManager.get(interaction.guild!.id);
    const userId = interaction.user.id;

    const tagName = interaction.options.getString("name", true);
    const positionArg = interaction.options.getString("position") ?? "current";

    if (!isValidTagName(tagName)) {
      await interaction.reply({
        content:
          "Invalid tag name. Use letters, numbers, _ or -, max 32 chars.",
        ephemeral: true,
      });
      return;
    }

    let song = null;
    try {
      const pos = parsePositionArgument(positionArg, player);
      song = player.getSongAt(pos);
    } catch (e) {
      await interaction.reply({
        content: (e as Error).message,
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

    const tags = await readUserTags(userId);
    const { added } = addSongToTag(tags, tagName, song);
    await writeUserTags(userId, tags);

    await interaction.reply({
      content: added
        ? `🏷️ Added "${song.title}" to tag "${tagName}"`
        : `"${song.title}" is already tagged under "${tagName}"`,
    });
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const tagName = args[0];
    const positionArg = args[1] ?? "current";

    if (!tagName) {
      await message.channel.send("Usage: !tag <tag-name> [position]");
      return;
    }

    const mockInteraction = createMockInteraction(message, {
      options: {
        getString: (name: string) => {
          if (name === "name") {
            return tagName;
          }

          if (name === "position") {
            return positionArg;
          }

          return null;
        },
      },
    });
    await this.execute(mockInteraction);
  }
}
