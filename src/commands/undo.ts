import { ChatInputCommandInteraction, Message } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";

@injectable()
export default class UndoCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("undo")
    .setDescription(
      "undo the last queue modification (shuffle, clear, move, remove, etc.)",
    );

  public aliases = ["u"];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const player = await this.playerManager.get(interaction.guild!.id);

    if (!player.canUndo()) {
      await interaction.reply({
        content: "⚠️ Nothing to undo",
        ephemeral: true,
      });
      return;
    }

    const success = await player.undo();

    if (success) {
      await interaction.reply({
        content: "↩️ Undone last queue modification",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "❌ Failed to undo",
        ephemeral: true,
      });
    }
  }

  public async executePrefix(message: Message): Promise<void> {
    const player = await this.playerManager.get(message.guild!.id);

    if (!player.canUndo()) {
      await message.reply("⚠️ Nothing to undo");
      return;
    }

    const success = await player.undo();

    if (success) {
      await message.reply("↩️ Undone last queue modification");
    } else {
      await message.reply("❌ Failed to undo");
    }
  }
}

