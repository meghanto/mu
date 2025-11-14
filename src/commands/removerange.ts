import { ChatInputCommandInteraction, Message } from "discord.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import errorMsg from "../utils/error-msg.js";
import { parsePositionArgument } from "../utils/parse-position-argument.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("removerange")
    .setDescription("remove a range of songs from the queue")
    .addStringOption((option) =>
      option
        .setName("from")
        .setDescription(
          "start position (e.g., 1, next, last-5)",
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("to")
        .setDescription(
          "end position (e.g., 5, next+3, last)",
        )
        .setRequired(true),
    );

  public readonly aliases: string[] = [];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    if (args.length < 2) {
      await message.channel.send(
        errorMsg("Usage: !removerange <from> <to> (e.g., !removerange 5 8)"),
      );
      return;
    }

    const fromArg = args[0];
    const toArg = args[1];

    const mockInteraction = createMockInteraction(message, {
      options: {
        getString: (name: string) => {
          if (name === "from") {
            return fromArg.toLowerCase();
          }
          if (name === "to") {
            return toArg.toLowerCase();
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

    let fromAbs: number;
    let toAbs: number;

    try {
      fromAbs = parsePositionArgument(fromArg.toLowerCase(), player);
      toAbs = parsePositionArgument(toArg.toLowerCase(), player);
    } catch (error: unknown) {
      throw new Error(
        error instanceof Error ? error.message : "Invalid position format.",
      );
    }

    const queueLength = player.getFullQueueLength();

    if (fromAbs > queueLength || toAbs > queueLength) {
      throw new Error("Position is out of bounds.");
    }

    if (toAbs < fromAbs) {
      throw new Error(
        "End position must be greater than or equal to start position.",
      );
    }

    // Prevent removing currently playing song
    const currentAbs = player.queuePosition + 1;
    if (fromAbs <= currentAbs && currentAbs <= toAbs) {
      throw new Error(
        "Cannot remove a range that includes the currently playing song.",
      );
    }

    // Convert to queue-relative positions (1-based after current song)
    const fromRel = fromAbs - player.queuePosition;
    const toRel = toAbs - player.queuePosition;

    // Prevent removing past songs (queue-relative position would be <= 0)
    if (fromRel < 1) {
      throw new Error(
        "Can only remove songs that are in the queue (after the current song).",
      );
    }

    const count = toRel - fromRel + 1;

    await player.removeFromQueue(fromRel, count);

    await interaction.reply({
      content: `🗑️ Removed ${count} song${count === 1 ? "" : "s"} from positions ${fromAbs}-${toAbs}`,
      ephemeral: true,
    });
  }
}

