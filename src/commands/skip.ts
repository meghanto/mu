import { ChatInputCommandInteraction, Message } from "discord.js";
import { TYPES } from "../types.js";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { buildPlayingMessageEmbed } from "../utils/build-embed.js";
import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("skip")
    .setDescription("skip the next songs")
    .addIntegerOption((option) =>
      option
        .setName("number")
        .setDescription("number of songs to skip [default: 1]")
        .setRequired(false),
    );

  public readonly aliases = ["s", "next"];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const numToSkip = parseInt(args[0], 10) || 1;

    const mockInteraction = createMockInteraction(message, {
      options: {
        getInteger: (name: string) => (name === "number" ? numToSkip : null),
      },
    });

    await this.execute(mockInteraction);
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const numToSkip = interaction.options.getInteger("number") ?? 1;

    if (numToSkip < 1) {
      throw new Error("invalid number of songs to skip");
    }

    const player = await this.playerManager.get(interaction.guild!.id);

    await player.forward(numToSkip);
    await interaction.reply({
      content: "keep 'er movin'",
      embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [],
    });
  }
}
