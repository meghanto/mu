import { ChatInputCommandInteraction, Message, GuildMember } from "discord.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { TYPES } from "../types.js";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import {
  getMemberVoiceChannel,
  getMostPopularVoiceChannel,
} from "../utils/channels.js";
import Command from "./index.js";
import { getRandomResponse } from "../utils/random-response.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("join")
    .setDescription("join your voice channel");

  public aliases = ["j"];

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

    if (player.voiceConnection) {
      await interaction.reply(`👍 ${getRandomResponse()}`);
      return;
    }

    // Get target voice channel
    let targetVoiceChannel;
    try {
      [targetVoiceChannel] =
        getMemberVoiceChannel(interaction.member as GuildMember) ??
        getMostPopularVoiceChannel(interaction.guild!);
    } catch {
      throw new Error(
        "no voice channel to join - you must be in a voice channel",
      );
    }

    if (!targetVoiceChannel) {
      throw new Error(
        "no voice channel to join - you must be in a voice channel",
      );
    }

    await player.connect(targetVoiceChannel);
    await interaction.reply(`👍 ${getRandomResponse()}`);
  }
}
