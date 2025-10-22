import { ChatInputCommandInteraction, Message } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { TYPES } from "../types.js";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("pause and disconnect Muse");

  public requiresVC = true;

  public readonly aliases = ["dc", "leave"];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message): Promise<void> {
    await this.execute(createMockInteraction(message));
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    const player = await this.playerManager.get(interaction.guild!.id);

    if (!player.voiceConnection) {
      throw new Error("not connected");
    }

    await player.disconnect();

    await interaction.reply({
      content: "👋 Disconnected from voice channel",
      ephemeral: true,
    });
  }
}
