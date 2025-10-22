import { ChatInputCommandInteraction, Message } from "discord.js";
import { TYPES } from "../types.js";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { getRandomResponse } from "../utils/random-response.js";
import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("volume")
    .setDescription("set current player volume level")
    .addIntegerOption((option) =>
      option
        .setName("level")
        .setDescription("volume percentage (0 is muted, 100 is max & default)")
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true),
    );

  public readonly aliases = ["vol"];
  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const levelArg = args[0];

    if (!levelArg) {
      await message.channel.send("Please provide a volume level (0-100).");
      return;
    }

    const level = parseInt(levelArg, 10);

    if (isNaN(level) || level < 0 || level > 100) {
      await message.channel.send(
        "Volume level must be a number between 0 and 100.",
      );
      return;
    }

    const mockInteraction = createMockInteraction(message, {
      options: {
        getInteger: (name: string) => (name === "level" ? level : null),
      },
    });

    await this.execute(mockInteraction);
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const player = await this.playerManager.get(interaction.guild!.id);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      throw new Error("nothing is playing");
    }

    const level = interaction.options.getInteger("level") ?? 100;
    player.setVolume(level);
    await interaction.reply({
      content: `🔊 Volume set to ${level}%`,
      ephemeral: true,
    });
  }
}
