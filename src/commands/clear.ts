import { inject, injectable } from "inversify";
import {
  ChatInputCommandInteraction,
  Message,
  InteractionReplyOptions,
  MessagePayload,
} from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";

import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("clear")
    .setDescription("clears all songs in queue except currently playing song");

  public readonly aliases = ["cl"];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message): Promise<void> {
    await this.execute(createMockInteraction(message));
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    const player = await this.playerManager.get(interaction.guild!.id);
    await player.clear();

    await interaction.reply({
      content: "🗑️ Queue cleared (current song kept)",
      ephemeral: true,
    });
  }
}
