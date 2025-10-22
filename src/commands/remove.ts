import { ChatInputCommandInteraction, Message } from "discord.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { SlashCommandBuilder } from "@discordjs/builders";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("remove")
    .setDescription("remove songs from the queue by absolute position")
    .addIntegerOption((option) =>
      option
        .setName("position")
        .setDescription(
          "absolute position of song to remove (cannot remove currently playing)",
        )
        .setRequired(true)
        .setMinValue(1),
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

    // Support syntax: !remove from-to (e.g., !remove 5-8)
    let position: number | undefined;
    let range: number | undefined;

    const dashedRangeMatch = /^(\d+)-(\d+)$/.exec(positionArg);
    if (dashedRangeMatch) {
      const from = parseInt(dashedRangeMatch[1], 10);
      const to = parseInt(dashedRangeMatch[2], 10);

      if (Number.isNaN(from) || Number.isNaN(to) || from < 1 || to < 1) {
        await message.channel.send("Positions must be positive numbers.");
        return;
      }

      if (to < from) {
        await message.channel.send(
          "The end position must be greater than or equal to the start position.",
        );
        return;
      }

      position = from;
      range = to - from + 1;
    } else {
      position = parseInt(positionArg, 10);
      range = rangeArg ? parseInt(rangeArg, 10) : undefined;

      if (Number.isNaN(position) || position < 1) {
        await message.channel.send("Position must be a positive number.");
        return;
      }

      if (rangeArg && (Number.isNaN(range!) || range! < 1)) {
        await message.channel.send("Range must be a positive number.");
        return;
      }
    }

    const mockInteraction = createMockInteraction(message, {
      options: {
        getInteger: (name: string) => {
          if (name === "position") {
            return position!;
          }

          if (name === "range") {
            return range! ?? null;
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

    const position = interaction.options.getInteger("position")!;
    const range = interaction.options.getInteger("range") ?? 1;

    try {
      await player.removeFromQueue(position, range);

      const message =
        range === 1
          ? `🗑️ Removed song at position ${position}`
          : `🗑️ Removed ${range} songs starting from position ${position}`;

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
