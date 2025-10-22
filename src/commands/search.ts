import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  Message,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import Command from "./index.js";
import GetSongs from "../services/get-songs.js";
import YoutubeAPI from "../services/youtube-api.js";
import PlayerManager from "../managers/player.js";
import { QueuedSong, SongMetadata } from "../services/player.js";

@injectable()
export default class SearchCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("search")
    .setDescription("search YouTube without queuing; select results to add")
    .addStringOption((o) =>
      o.setName("query").setDescription("search query").setRequired(true),
    );

  public readonly aliases = ["find"];

  private readonly getSongs: GetSongs;
  private readonly youtubeAPI: YoutubeAPI;
  private readonly playerManager: PlayerManager;

  constructor(
    @inject(TYPES.Services.GetSongs) getSongs: GetSongs,
    @inject(TYPES.Services.YoutubeAPI) youtubeAPI: YoutubeAPI,
    @inject(TYPES.Managers.Player) playerManager: PlayerManager,
  ) {
    this.getSongs = getSongs;
    this.youtubeAPI = youtubeAPI;
    this.playerManager = playerManager;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const query = interaction.options.getString("query", true);
    const results = await this.youtubeAPI.searchMany(query, 10, false);

    if (results.length === 0) {
      await interaction.reply({
        content: "No results found.",
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Results for: ${query}`)
      .setDescription(results.map((s, i) => `${i + 1}. ${s.title}`).join("\n"));

    const select = new StringSelectMenuBuilder()
      .setCustomId("search-select")
      .setPlaceholder("Select one or more results")
      .setMinValues(1)
      .setMaxValues(Math.min(10, results.length))
      .addOptions(
        results
          .slice(0, 10)
          .map((s, i) => ({ label: s.title.slice(0, 100), value: String(i) })),
      );

    const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      select,
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("search-insert-now")
        .setLabel("Insert Next")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("search-add-end")
        .setLabel("Add to End")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("search-insert-at")
        .setLabel("Insert at…")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({ embeds: [embed], components: [row1, row2] });

    const replyMessage = await interaction.fetchReply();

    const selection = await replyMessage
      .awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: 60_000,
        filter: (i: StringSelectMenuInteraction) =>
          i.customId === "search-select" && i.user.id === interaction.user.id,
      })
      .catch(() => undefined);

    if (!selection) {
      await interaction.editReply({ content: "Timed out.", components: [] });
      return;
    }

    const chosen = selection.values.map(
      (v: string) => results[parseInt(v, 10)],
    );
    await selection.deferUpdate();

    // Wait for action button
    const action = await replyMessage
      .awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 60_000,
        filter: (i: ButtonInteraction) =>
          i.user.id === interaction.user.id &&
          ["search-insert-now", "search-add-end", "search-insert-at"].includes(
            i.customId,
          ),
      })
      .catch(() => undefined);

    if (!action) {
      await interaction.editReply({ content: "Timed out.", components: [] });
      return;
    }

    const player = await this.playerManager.get(interaction.guild!.id);
    const queued: QueuedSong[] = chosen.map((s: SongMetadata) => ({
      ...s,
      addedInChannelId: interaction.channel!.id,
      requestedBy: interaction.user.id,
    }));

    if (action.customId === "search-add-end") {
      await player.addMany(queued);
      await action.update({
        content: `Queued ${queued.length} song(s).`,
        components: [],
      });
      return;
    }

    if (action.customId === "search-insert-now") {
      for (const q of queued) {
        await player.add(q, { immediate: true });
      }

      await action.update({
        content: `Inserted next ${queued.length} song(s).`,
        components: [],
      });
      return;
    }

    // Insert at… prompt (simple text follow-up)
    await action.update({
      content: "Reply with the absolute position to insert at (within 15s).",
      components: [],
    });
    const reply = await interaction
      .channel!.awaitMessages({
        max: 1,
        time: 15_000,
        filter: (m: Message) => m.author.id === interaction.user.id,
      })
      .catch(() => undefined);

    const content = reply?.first()?.content?.trim();
    const at = content ? parseInt(content, 10) : NaN;
    if (!content || Number.isNaN(at) || at < 1) {
      await interaction.followUp({
        content: "Invalid position. Cancelled.",
        ephemeral: true,
      });
      return;
    }

    for (let i = 0; i < queued.length; i++) {
      await player.add(queued[i], { insertAt: at + i });
    }

    await interaction.followUp({
      content: `Inserted ${queued.length} song(s) at position ${at}.`,
      ephemeral: true,
    });
  }

  // No-op helper removed; using youtubeAPI.searchMany

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const query = args.join(" ").trim();
    if (!query) {
      await message.channel.send("Usage: !search <query>");
      return;
    }

    const mockInteraction = createMockInteraction(message, {
      options: {
        getString: (name: string) => (name === "query" ? query : null),
      },
    });
    await this.execute(mockInteraction);
  }
}
