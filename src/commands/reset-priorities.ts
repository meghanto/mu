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
    // Create a mock ChatInputCommandInteraction
    const mockInteraction: ChatInputCommandInteraction = {
      guild: message.guild,
      channel: message.channel,
      member: message.member,
      options: {},
      deferReply: async () => {
        await message.channel.send("Thinking...");
      },
      editReply: async (
        options: string | MessagePayload | InteractionReplyOptions,
      ) => {
        if (typeof options === "string") {
          await message.channel.send(options);
        } else if ("content" in options || "embeds" in options) {
          await message.channel.send(
            options.content ?? { embeds: options.embeds },
          );
        }
      },
      reply: async (
        options: string | MessagePayload | InteractionReplyOptions,
      ) => {
        if (typeof options === "string") {
          await message.reply(options);
        } else if ("content" in options || "embeds" in options) {
          await message.reply(options.content ?? { embeds: options.embeds });
        }
      },
    } as unknown as ChatInputCommandInteraction;

    await this.execute(mockInteraction);
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
