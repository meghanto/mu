import { ChatInputCommandInteraction, Message } from "discord.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import errorMsg from "../utils/error-msg.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("moverange")
    .setDescription("move a range of songs to a target position")
    .addIntegerOption((option) =>
      option
        .setName("from")
        .setDescription("start position (absolute, 1-based)")
        .setRequired(true)
        .setMinValue(1),
    )
    .addIntegerOption((option) =>
      option
        .setName("to")
        .setDescription("end position (absolute, 1-based)")
        .setRequired(true)
        .setMinValue(1),
    )
    .addIntegerOption((option) =>
      option
        .setName("at")
        .setDescription("target position to insert at (absolute, 1-based)")
        .setRequired(true)
        .setMinValue(1),
    );

  public readonly aliases: string[] = [];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    if (args.length < 2) {
      await message.channel.send(
        errorMsg("Usage: !moverange <from-to> <at> (e.g., !moverange 5-8 2)"),
      );
      return;
    }

    const rangeArg = args[0];
    const atArg = args[1];

    const match = /^(\d+)-(\d+)$/.exec(rangeArg);
    if (!match) {
      await message.channel.send(
        errorMsg("Range must be in the form from-to (e.g., 5-8)."),
      );
      return;
    }

    const fromAbs = parseInt(match[1], 10);
    const toAbs = parseInt(match[2], 10);
    const atAbs = parseInt(atArg, 10);

    if ([fromAbs, toAbs, atAbs].some((n) => Number.isNaN(n) || n < 1)) {
      await message.channel.send(
        errorMsg("Positions must be positive numbers."),
      );
      return;
    }

    if (toAbs < fromAbs) {
      await message.channel.send(
        errorMsg(
          "End position must be greater than or equal to start position.",
        ),
      );
      return;
    }

    const mockInteraction = createMockInteraction(message, {
      options: {
        getInteger: (name: string) => {
          if (name === "from") {
            return fromAbs;
          }

          if (name === "to") {
            return toAbs;
          }

          if (name === "at") {
            return atAbs;
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

    const fromAbs = interaction.options.getInteger("from")!;
    const toAbs = interaction.options.getInteger("to")!;
    const atAbs = interaction.options.getInteger("at")!;

    const queueLength = player.getFullQueueLength();

    if (
      fromAbs > queueLength ||
      toAbs > queueLength ||
      atAbs > queueLength + 1
    ) {
      throw new Error("Position is out of bounds.");
    }

    if (toAbs < fromAbs) {
      throw new Error(
        "End position must be greater than or equal to start position.",
      );
    }

    // Prevent moving currently playing song
    const currentAbs = player.queuePosition + 1;
    if (fromAbs <= currentAbs && currentAbs <= toAbs) {
      throw new Error(
        "Cannot move a range that includes the currently playing song.",
      );
    }

    // Convert to queue-relative (0-based after current song)
    const fromRel = fromAbs - player.queuePosition - 1;
    const toRel = toAbs - player.queuePosition - 1;
    const atRel = atAbs - player.queuePosition - 1;

    if (fromRel <= 0) {
      throw new Error(
        "Can only move songs that are in the queue (after the current song).",
      );
    }

    const count = toRel - fromRel + 1;

    // If atRel falls within the block, it's effectively a no-op
    if (atRel >= fromRel && atRel <= toRel + 1) {
      await interaction.reply({
        content: "↔️ Range already at target region",
        ephemeral: true,
      });
      return;
    }

    if (atRel <= fromRel) {
      // Moving earlier: move each element in order, shifting target forward to preserve order
      for (let i = 0; i < count; i++) {
        await player.move(fromRel + i, atRel + i);
      }
    } else {
      // Moving later: compute the start index after removals
      const targetStart = atRel - count;
      for (let i = 0; i < count; i++) {
        await player.move(fromRel, targetStart + i);
      }
    }

    await interaction.reply({
      content: `↔️ Moved songs ${fromAbs}-${toAbs} to position ${atAbs}`,
      ephemeral: true,
    });
  }
}
