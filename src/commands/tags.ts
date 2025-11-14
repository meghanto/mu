import { ChatInputCommandInteraction, EmbedBuilder, Message } from "discord.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { QueuedSong } from "../services/player.js";
import { listTags, readUserTags } from "../utils/user-tags.js";

@injectable()
export default class TagsCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("tags")
    .setDescription("show or play your tags")
    .addSubcommand((sc) => sc.setName("show").setDescription("show your tags"))
    .addSubcommand((sc) =>
      sc
        .setName("play")
        .setDescription("play songs from a tag")
        .addStringOption((o) =>
          o.setName("name").setDescription("tag name").setRequired(true),
        )
        .addBooleanOption((o) =>
          o.setName("now").setDescription("insert next").setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName("at")
            .setDescription("insert at absolute position")
            .setRequired(false),
        ),
    );

  public readonly aliases = ["insert", "i"] as string[];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const guildId = interaction.guild!.id;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand(false) ?? "show";

    if (sub === "play") {
      const name = interaction.options.getString("name", true).toLowerCase();
      const insertNow = interaction.options.getBoolean("now") ?? false;
      const atArg = interaction.options.getString("at") ?? undefined;
      const tags = await readUserTags(userId);
      const songs = tags[name] ?? [];
      if (songs.length === 0) {
        await interaction.reply({
          content: `No songs found for tag "${name}".`,
          ephemeral: true,
        });
        return;
      }

      const player = await this.playerManager.get(guildId);
      const queued: QueuedSong[] = songs.map((s) => ({
        ...s,
        addedInChannelId: interaction.channel!.id,
        requestedBy: interaction.user.id,
      }));
      if (atArg) {
        const at = parseInt(atArg, 10);
        if (Number.isNaN(at) || at < 1) {
          await interaction.reply({
            content: '"at" must be a positive number.',
            ephemeral: true,
          });
          return;
        }

        for (let i = 0; i < queued.length; i++) {
          await player.add(queued[i], { insertAt: at + i });
        }

        await interaction.reply({
          content: `Inserted ${songs.length} song(s) from tag "${name}" at position ${at}.`,
        });
      } else if (insertNow) {
        for (let i = 0; i < queued.length; i++) {
          await player.add(queued[i], { immediate: true });
        }

        await interaction.reply({
          content: `Inserted next ${songs.length} song(s) from tag "${name}".`,
        });
      } else {
        await player.addMany(queued);
        await interaction.reply({
          content: `Queued ${songs.length} song(s) from tag "${name}".`,
        });
      }

      return;
    }

    // Show
    const tags = await readUserTags(userId);
    const entries = listTags(tags);
    if (entries.length === 0) {
      await interaction.reply({
        content: "You have no tags yet.",
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Your Tags")
      .setDescription(
        entries.map((e) => `• ${e.tag} — ${e.count} song(s)`).join("\n"),
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  public async executePrefix(
    message: Message,
    args: string[],
    prefix: string,
  ): Promise<void> {
    const commandName = message.content
      .slice(prefix.length)
      .trim()
      .split(/ +/)[0]
      ?.toLowerCase();
    const sub = args[0]?.toLowerCase() ?? "show";

    if (sub === "play" || commandName === "insert" || commandName === "i") {
      let insertNow = commandName === "insert" || commandName === "i";
      let atArg: string | undefined;
      const nameAndFlags = args.slice(sub === "play" ? 1 : 0);

      let name: string | undefined;
      const rest: string[] = [];
      for (const a of nameAndFlags) {
        if (a === "--now") {
          insertNow = true;
        } else if (a.startsWith("--at=")) {
          atArg = a.substring(5);
        } else if (!name) {
          name = a;
        } else {
          rest.push(a);
        }
      }

      if (!name) {
        await message.channel.send(
          "Usage: !tags play <tag-name> [--now] [--at=position]",
        );
        return;
      }

      const mockInteraction = createMockInteraction(message, {
        options: {
          getSubcommand: () => "play",
          getString: (n: string) => {
            if (n === "name") {
              return name!;
            }

            if (n === "at") {
              return atArg ?? null;
            }

            return null;
          },
          getBoolean: (n: string) => (n === "now" ? insertNow : null),
        },
      });
      await this.execute(mockInteraction);
      return;
    }

    // Default to show
    const mockInteraction = createMockInteraction(message, {
      options: {
        getSubcommand: () => "show",
      },
    });
    await this.execute(mockInteraction);
  }
}
