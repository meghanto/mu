import { ChatInputCommandInteraction, Message } from "discord.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { parsePositionArgument } from "../utils/parse-position-argument.js";
import Player from "../services/player.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("remove")
    .setDescription("remove songs from the queue")
    .addStringOption((option) =>
      option
        .setName("position")
        .setDescription(
          "position of song to remove (e.g., 1, next, last, current-1)",
        )
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("range")
        .setDescription("number of songs to remove [default: 1]")
        .setRequired(false)
        .setMinValue(1),
    );

  public readonly aliases = ["rm"];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const positionArg = args[0];
    const rangeArg = args[1];

    if (!positionArg) {
      await message.channel.send("Please provide a position to remove.");
      return;
    }

    const mockInteraction = createMockInteraction(message, {
      options: {
        getString: (name: string) => {
          if (name === "position") {
            return positionArg.toLowerCase();
          }
          return null;
        },
        getInteger: (name: string) => {
          if (name === "range") {
            if (rangeArg) {
              const range = parseInt(rangeArg, 10);
              return Number.isNaN(range) ? null : range;
            }
            return null;
          }
          return null;
        },
      },
    });
    await this.execute(mockInteraction);
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const player = await this.playerManager.get(interaction.guild!.id);

    const positionArg = interaction.options.getString("position")!;
    const range = interaction.options.getInteger("range") ?? 1;

    try {
      // Parse position using the same convention as other commands
      const absolutePosition = parsePositionArgument(positionArg.toLowerCase(), player);

      // Convert absolute position (1-based) to queue-relative position (1-based after current)
      // removeFromQueue expects queue-relative position (1 = first song after current)
      const queueRelativePosition = absolutePosition - player.queuePosition;

      // Prevent removing current song (queue-relative position would be 0 or negative if at/before current)
      if (queueRelativePosition < 1) {
        throw new Error("Cannot remove the currently playing song or songs from the past.");
      }

      await player.removeFromQueue(queueRelativePosition, range);

      const message =
        range === 1
          ? `🗑️ Removed song at position ${absolutePosition}`
          : `🗑️ Removed ${range} songs starting from position ${absolutePosition}`;

      await interaction.reply({
        content: message,
        ephemeral: true,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await interaction.reply({
        content: `❌ ${errorMessage}`,
        ephemeral: true,
      });
    }
  }
}
