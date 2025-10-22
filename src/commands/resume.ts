import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import Command from "./index.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import { STATUS } from "../services/player.js";
import { buildPlayingMessageEmbed } from "../utils/build-embed.js";
import {
  getMemberVoiceChannel,
  getMostPopularVoiceChannel,
} from "../utils/channels.js";
import { ChatInputCommandInteraction, GuildMember, Message } from "discord.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("resume")
    .setDescription("resume playback");

  public readonly aliases = ["res"];
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

    if (player.status === STATUS.PLAYING) {
      throw new Error("already playing, give me a song name");
    }

    // Must be resuming play
    if (!player.getCurrent()) {
      throw new Error("nothing to play");
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

    try {
      await player.play();
    } catch (error: unknown) {
      // If play fails and skips forward, getCurrent() might be null
      // Check if there's still a current song after the error
      if (!player.getCurrent()) {
        throw new Error(
          "failed to play - queue may be empty or all songs unavailable",
        );
      }
      // If there is a current song, rethrow the original error
      throw error;
    }

    await interaction.reply({
      content: "the stop-and-go light is now green",
      embeds: [buildPlayingMessageEmbed(player)],
    });
  }
}
