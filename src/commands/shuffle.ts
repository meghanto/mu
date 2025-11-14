import {
  ChatInputCommandInteraction,
  Message,
  InteractionReplyOptions,
  MessagePayload,
} from "discord.js";
import { TYPES } from "../types.js";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { SlashCommandBuilder } from "@discordjs/builders";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("shuffle the current queue")
    .addBooleanOption((option) =>
      option
        .setName("upcoming")
        .setDescription(
          "shuffle only upcoming songs (excluding current and previous)",
        )
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName("weighted")
        .setDescription(
          "use priority-weighted shuffle (songs with higher priority play sooner)",
        )
        .setRequired(false),
    );

  public requiresVC = true;

  public readonly aliases = ["sh", "shu"]; // 'shu' = shuffle upcoming

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(
    message: Message,
    args: string[],
    prefix: string,
  ): Promise<void> {
    // Check if 'shu' alias was used (auto-enables --upcoming)
    const commandName = message.content
      .slice(prefix.length)
      .trim()
      .split(/ +/)[0]
      ?.toLowerCase();
    let upcoming = commandName === "shu";
    let weighted = false;

    // Optional positional range: "from-to"
    let rangeFrom: number | undefined;
    let rangeTo: number | undefined;

    const filteredArgs: string[] = [];
    for (const arg of args) {
      const m = /^(\d+)-(\d+)$/.exec(arg);
      if (m) {
        rangeFrom = parseInt(m[1], 10);
        rangeTo = parseInt(m[2], 10);
        continue;
      }

      if (arg === "--upcoming") {
        upcoming = true;
      } else if (arg === "--weighted" || arg === "-w") {
        weighted = true;
      } else {
        filteredArgs.push(arg);
      }
    }

    if (rangeFrom !== undefined && rangeTo !== undefined) {
      if (
        Number.isNaN(rangeFrom) ||
        Number.isNaN(rangeTo) ||
        rangeFrom < 1 ||
        rangeTo < 1
      ) {
        await message.channel.send("Positions must be positive numbers.");
        return;
      }

      if (rangeTo < rangeFrom) {
        await message.channel.send(
          "The end position must be greater than or equal to the start position.",
        );
        return;
      }
    }

    // Create a mock ChatInputCommandInteraction
    const mockInteraction: ChatInputCommandInteraction = {
      guild: message.guild,
      channel: message.channel,
      member: message.member,
      options: {
        getBoolean: (name: string) => {
          if (name === "upcoming") {
            return upcoming;
          }

          if (name === "weighted") {
            return weighted;
          }

          return null;
        },
        getInteger: (name: string) => {
          if (name === "from") {
            return rangeFrom ?? null;
          }

          if (name === "to") {
            return rangeTo ?? null;
          }

          return null;
        },
      },
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
    const upcomingOnly = interaction.options.getBoolean("upcoming") ?? false;
    const weighted = interaction.options.getBoolean("weighted") ?? false;
    const rangeFrom = interaction.options.getInteger("from");
    const rangeTo = interaction.options.getInteger("to");

    if (player.isQueueEmpty()) {
      throw new Error("not enough songs to shuffle");
    }

    if (rangeFrom && rangeTo) {
      await player.shuffleRange(rangeFrom, rangeTo, weighted);
    } else {
      await player.shuffle(upcomingOnly, weighted);
    }

    const scope =
      rangeFrom && rangeTo
        ? `positions ${rangeFrom}-${rangeTo}`
        : upcomingOnly
          ? "upcoming songs"
          : "entire queue";
    const mode = weighted
      ? "⚖️ Priority-weighted shuffle"
      : "🔀 Random shuffle";

    await interaction.reply({
      content: `${mode}: shuffled ${scope}`,
      ephemeral: true,
    });
  }
}
