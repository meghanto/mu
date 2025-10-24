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
import { parseTime, prettyTime } from "../utils/time.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import durationStringToSeconds from "../utils/duration-string-to-seconds.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("seek")
    .setDescription("seek to a position from beginning of song")
    .addStringOption((option) =>
      option
        .setName("time")
        .setDescription(
          "an interval expression or number of seconds (1m, 30s, 100)",
        )
        .setRequired(true),
    );

  public readonly aliases = ["se"];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const timeArg = args[0];
    if (!timeArg) {
      await message.channel.send(
        "Please provide a time to seek to (e.g., 1m30s, 90).",
      );
      return;
    }

    const mockInteraction = createMockInteraction(message, {
      options: {
        getString: (name: string) => {
          if (name === "time") {
            return timeArg;
          }

          return null;
        },
      },
      reply: {
        deferReply: async () => {
          await message.channel.send("Seeking...");
        },
        editReply: async (options: string | MessagePayload | InteractionReplyOptions) => {
          if (typeof options === "object" && "content" in options && options.content) {
            return message.channel.send(options.content);
          }
          return message.channel.send(options as string);
        },
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

    if (currentSong.isLive) {
      throw new Error("can't seek in a livestream");
    }

    const time = interaction.options.getString("time")!;

    let seekTime = 0;

    if (time.includes(":")) {
      seekTime = parseTime(time);
    } else {
      seekTime = durationStringToSeconds(time);
    }

    if (seekTime > currentSong.length) {
      throw new Error("can't seek past the end of the song");
    }

    await Promise.all([player.seek(seekTime), interaction.deferReply()]);

    await interaction.editReply(
      `👍 seeked to ${prettyTime(player.getPosition())}`,
    );
  }
}
