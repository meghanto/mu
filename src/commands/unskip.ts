import { ChatInputCommandInteraction, Message } from "discord.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { TYPES } from "../types.js";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { buildPlayingMessageEmbed } from "../utils/build-embed.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("unskip")
    .setDescription("go back in the queue by one song");

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

    try {
      await player.back();
      await interaction.reply({
        content: "back 'er up'",
        embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [],
      });
    } catch (_: unknown) {
      throw new Error("no song to go back to");
    }
  }
}
