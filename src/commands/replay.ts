import {
  ChatInputCommandInteraction,
  Message,
  InteractionReplyOptions,
  MessagePayload,
} from "discord.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { TYPES } from "../types.js";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { SlashCommandBuilder } from "@discordjs/builders";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("replay")
    .setDescription("replay the current song");

  public requiresVC = true;

  public readonly aliases = ["re"];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message): Promise<void> {
    const mockInteraction = {
      guild: message.guild,
      channel: message.channel,
      member: message.member,
      options: {},
      deferReply: async () => {
        await message.channel.send("Replaying...");
      },
      editReply: async (
        options: string | MessagePayload | InteractionReplyOptions,
      ) => {
        if (
          typeof options === "object" &&
          "content" in options &&
          options.content
        ) {
          await message.channel.send(options.content);
        }
      },
    } as unknown as ChatInputCommandInteraction;

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

    if (currentSong.isLive) {
      throw new Error("can't replay a livestream");
    }

    await Promise.all([player.seek(0), interaction.deferReply()]);

    await interaction.editReply("👍 replayed the current song");
  }
}
