import { ChatInputCommandInteraction, Message } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { TYPES } from "../types.js";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import { STATUS } from "../services/player.js";
import Command from "./index.js";
import { getRandomResponse } from "../utils/random-response.js";
import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("stop")
    .setDescription(
      "stop playback, disconnect, and clear all songs in the queue",
    );

  public readonly aliases = ["st"];

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

    if (!player.voiceConnection) {
      throw new Error("not connected");
    }

    if (player.status !== STATUS.PLAYING) {
      throw new Error("not currently playing");
    }

    await player.stop();
    await interaction.reply("u betcha, stopped");
  }
}
