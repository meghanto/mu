import { ChatInputCommandInteraction, Message } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";

@injectable()
export default class RemoveDuplicatesCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("remove-duplicates")
    .setDescription(
      "remove duplicate songs from upcoming queue (keeps first occurrence)",
    );

  public aliases = ["dedupe", "dedup", "rmd"];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const player = await this.playerManager.get(interaction.guild!.id);

    if (player.isQueueEmpty()) {
      await interaction.reply({
        content: "⚠️ Queue is empty, nothing to deduplicate",
        ephemeral: true,
      });
      return;
    }

    const removed = await player.removeDuplicates();

    if (removed === 0) {
      await interaction.reply({
        content: "✨ No duplicates found",
        ephemeral: true,
      });
    } else {
      const message =
        removed === 1
          ? "🗑️ Removed 1 duplicate song"
          : `🗑️ Removed ${removed} duplicate songs`;

      await interaction.reply({
        content: message,
        ephemeral: true,
      });
    }
  }

  public async executePrefix(message: Message): Promise<void> {
    const player = await this.playerManager.get(message.guild!.id);

    if (player.isQueueEmpty()) {
      await message.reply("⚠️ Queue is empty, nothing to deduplicate");
      return;
    }

    const removed = await player.removeDuplicates();

    if (removed === 0) {
      await message.reply("✨ No duplicates found");
    } else {
      const replyMessage =
        removed === 1
          ? "🗑️ Removed 1 duplicate song"
          : `🗑️ Removed ${removed} duplicate songs`;

      await message.reply(replyMessage);
    }
  }
}
