import {
  ChatInputCommandInteraction,
  Message,
  InteractionReplyOptions,
  MessagePayload,
} from "discord.js";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import errorMsg from "../utils/error-msg.js";
import { parsePositionArgument } from "../utils/parse-position-argument.js";
import Player from "../services/player.js";

import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("move")
    .setDescription("move songs within the queue")
    .addStringOption((option) =>
      option
        .setName("from")
        .setDescription(
          "position of the song to move (e.g., 1, current, next-1)",
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("to")
        .setDescription(
          "position to move the song to (e.g., 1, top, next+2, last-1)",
        )
        .setRequired(true),
    );

  public readonly aliases = ["m"];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    if (args.length < 2) {
      await message.channel.send(
        errorMsg('Please provide both "from" and "to" positions.'),
      );
      return;
    }

    const mockInteraction = createMockInteraction(message, {
      options: {
        getString: (name: string) => {
          if (name === "from") {
            return args[0].toLowerCase();
          }

          if (name === "to") {
            return args[1].toLowerCase();
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

    const fromArg = interaction.options.getString("from")!;
    const toArg = interaction.options.getString("to")!;

    let from: number;
    let to: number;

    try {
      from = parsePositionArgument(fromArg.toLowerCase(), player);
      to = parsePositionArgument(toArg.toLowerCase(), player);
    } catch (e: unknown) {
      throw new Error((e as Error).message); // Re-throw for slash command error handling
    }

    // Validate that positions are within the visible queue (after current song)
    if (from <= player.queuePosition) {
      throw new Error(
        "Can only move songs that are in the queue (after the current song).",
      );
    }

    // Convert absolute positions to queue-relative positions
    const queueRelativeFrom = from - player.queuePosition - 1;
    const queueRelativeTo = to - player.queuePosition - 1;

    const { title } = await player.move(queueRelativeFrom, queueRelativeTo);

    await interaction.reply({
      content: `↔️ Moved **${title}** to position **${to}**`,
      ephemeral: true,
    });
  }
}
