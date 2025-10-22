import {
  ChatInputCommandInteraction,
  Message,
  InteractionReplyOptions,
  MessagePayload,
} from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { TYPES } from "../types.js";
import { inject, injectable } from "inversify";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { prettyTime } from "../utils/time.js";
import durationStringToSeconds from "../utils/duration-string-to-seconds.js";

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("fseek")
    .setDescription("seek forward in the current song")
    .addStringOption((option) =>
      option
        .setName("time")
        .setDescription(
          "an interval expression or number of seconds (1m, 30s, 100)",
        )
        .setRequired(true),
    );

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const timeArg = args[0];

    if (!timeArg) {
      await message.channel.send(
        "Please provide a time to seek forward (e.g., 1m, 30s, 100).",
      );
      return;
    }

    const mockInteraction = {
      options: {
        getString: (name: string) => {
          if (name === "time") {
            return timeArg;
          }

          return null;
        },
      },
      guild: message.guild,
      channel: message.channel,
      user: message.author,
      deferReply: async () => {
        await message.channel.send("Seeking...");
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
      throw new Error("can't seek in a livestream");
    }

    const seekValue = interaction.options.getString("time");

    if (!seekValue) {
      throw new Error("missing seek value");
    }

    const seekTime = durationStringToSeconds(seekValue);

    if (seekTime + player.getPosition() > currentSong.length) {
      throw new Error("can't seek past the end of the song");
    }

    await Promise.all([player.forwardSeek(seekTime), interaction.deferReply()]);

    await interaction.editReply(
      `👍 seeked to ${prettyTime(player.getPosition())}`,
    );
  }
}
