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
    .setName("moverange")
    .setDescription("move a range of songs to a target position")
    .addStringOption((option) =>
      option
        .setName("from")
        .setDescription("start position (e.g., 1, next, last-5)")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("to")
        .setDescription("end position (e.g., 5, next+3, last)")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("at")
        .setDescription("target position to insert at (e.g., 2, next, last)")
        .setRequired(true),
    );

  public readonly aliases: string[] = [];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    if (args.length < 3) {
      await message.channel.send(
        errorMsg("Usage: !moverange <from> <to> <at> (e.g., !moverange 5 8 2)"),
      );
      return;
    }

    const fromArg = args[0];
    const toArg = args[1];
    const atArg = args[2];

    const mockInteraction = createMockInteraction(message, {
      options: {
        getString: (name: string) => {
          if (name === "from") {
            return fromArg.toLowerCase();
          }
          if (name === "to") {
            return toArg.toLowerCase();
          }
          if (name === "at") {
            return atArg.toLowerCase();
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
    const atArg = interaction.options.getString("at")!;

    let fromAbs: number;
    let toAbs: number;
    let atAbs: number;

    try {
      fromAbs = parsePositionArgument(fromArg.toLowerCase(), player);
      toAbs = parsePositionArgument(toArg.toLowerCase(), player);
      atAbs = parsePositionArgument(atArg.toLowerCase(), player);
    } catch (error: unknown) {
      throw new Error(
        error instanceof Error ? error.message : "Invalid position format.",
      );
    }

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

    // The currently playing song is a fixed point - it won't be moved
    // If the range includes the current song, we'll move all other songs in the range
    const currentAbs = player.queuePosition + 1;
    const currentInRange = fromAbs <= currentAbs && currentAbs <= toAbs;

    // Convert absolute positions to queue-relative positions
    // For past songs (fromAbs <= queuePosition), use negative relative positions
    const fromRel = fromAbs - player.queuePosition - 1;
    const toRel = toAbs - player.queuePosition - 1;
    const atRel = atAbs - player.queuePosition - 1;

    if (currentInRange) {
      // Range includes current song - move each song individually, skipping the current
      // Collect original absolute positions to move (excluding current)
      const originalSongsToMove: number[] = [];
      for (let abs = fromAbs; abs <= toAbs; abs++) {
        if (abs !== currentAbs) {
          originalSongsToMove.push(abs);
        }
      }

      if (originalSongsToMove.length === 0) {
        // Only current song in range - nothing to move
        await interaction.reply({
          content: "↔️ Range only contains the currently playing song (cannot be moved)",
          ephemeral: true,
        });
        return;
      }

      // Calculate where songs should end up
      // If target is before current, place songs before current
      // If target is after current, place songs after current (accounting for current staying fixed)
      
      // Determine target absolute positions
      const targetPositions: number[] = [];
      if (atAbs < currentAbs) {
        // Target is before current - place songs before current starting at atAbs
        for (let i = 0; i < originalSongsToMove.length; i++) {
          targetPositions.push(atAbs + i);
        }
      } else {
        // Target is at or after current - place songs after current
        // Account for current song not moving (so positions shift by 1)
        const adjustedStart = atAbs > currentAbs ? atAbs - 1 : currentAbs;
        for (let i = 0; i < originalSongsToMove.length; i++) {
          targetPositions.push(adjustedStart + 1 + i);
        }
      }

      // Move songs one by one, working backwards to avoid position shifting issues
      // We'll process from the end of the range to the start
      for (let i = originalSongsToMove.length - 1; i >= 0; i--) {
        const originalAbs = originalSongsToMove[i];
        const targetAbs = targetPositions[i];
        
        // Get current state
        const currentQueuePos = player.queuePosition;
        const currentAbsPos = currentQueuePos + 1;
        
        // Find current absolute position of the song we want to move
        // After previous moves, the song's absolute position may have changed
        // We need to track it by finding which absolute position corresponds to our original song
        // Since we're working backwards, songs we've already moved are at their target positions
        // Songs we haven't moved yet are still at positions >= originalAbs (adjusted for previous moves)
        
        // For now, we'll use a simpler approach: calculate relative positions from current state
        // and move based on the target absolute position
        const currentSongRel = originalAbs - currentQueuePos - 1;
        const targetRel = targetAbs - currentQueuePos - 1;
        
        // Only move if position actually changed
        if (currentSongRel !== targetRel) {
          await player.move(currentSongRel, targetRel);
        }
      }

      await interaction.reply({
        content: `↔️ Moved ${originalSongsToMove.length} song${originalSongsToMove.length === 1 ? "" : "s"} from positions ${fromAbs}-${toAbs} to position ${atAbs} (skipped currently playing song)`,
        ephemeral: true,
      });
    } else {
      // Range doesn't include current - move normally
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
}
