import {
  ChatInputCommandInteraction,
  Message,
  InteractionReplyOptions,
  MessagePayload,
} from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";

import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("reset-priorities")
    .setDescription("reset all song priorities in the queue to 1.0 (default)");

  public readonly aliases = ["rp", "resetp"];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message): Promise<void> {
    await this.execute(createMockInteraction(message));
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const player = await this.playerManager.get(interaction.guild!.id);

    if (player.isQueueEmpty()) {
      throw new Error("queue is empty");
    }

    const count = await player.resetPriorities();

    await interaction.reply({
      content: `⚖️ Reset priorities for ${count} song${count === 1 ? "" : "s"} to 1.0`,
      ephemeral: true,
    });
  }
}
