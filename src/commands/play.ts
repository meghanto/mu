import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Message,
} from "discord.js";
import { URL } from "url";
import {
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "@discordjs/builders";
import { inject, injectable, optional } from "inversify";
import Spotify from "spotify-web-api-node";
import Command from "./index.js";
import { TYPES } from "../types.js";
import Config from "../services/config.js";
import ThirdParty from "../services/third-party.js";
import getYouTubeAndSpotifySuggestionsFor from "../utils/get-youtube-and-spotify-suggestions-for.js";
import KeyValueCacheProvider from "../services/key-value-cache.js";
import { ONE_HOUR_IN_SECONDS } from "../utils/constants.js";
import AddQueryToQueue from "../services/add-query-to-queue.js";
import { parsePositionArgument } from "../utils/parse-position-argument.js";
import PlayerManager from "../managers/player.js";
import errorMsg from "../utils/error-msg.js";
import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class implements Command {
  public readonly slashCommand: Partial<
    SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder
  > &
    Pick<SlashCommandBuilder, "toJSON">;

  public requiresVC = true;

  private readonly spotify?: Spotify;
  private readonly cache: KeyValueCacheProvider;
  private readonly addQueryToQueue: AddQueryToQueue;
  private readonly playerManager: PlayerManager;

  constructor(
    @inject(TYPES.ThirdParty) @optional() thirdParty: ThirdParty,
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider,
    @inject(TYPES.Services.AddQueryToQueue) addQueryToQueue: AddQueryToQueue,
    @inject(TYPES.Managers.Player) playerManager: PlayerManager,
  ) {
    this.spotify = thirdParty?.spotify;
    this.cache = cache;
    this.addQueryToQueue = addQueryToQueue;
    this.playerManager = playerManager;

    const queryDescription =
      thirdParty === undefined
        ? "YouTube URL or search query"
        : "YouTube URL, Spotify URL, or search query";

    this.slashCommand = new SlashCommandBuilder()
      .setName("play")
      .setDescription("play a song")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription(queryDescription)
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName("immediate")
          .setDescription("add track to the front of the queue"),
      )
      .addBooleanOption((option) =>
        option
          .setName("shuffle")
          .setDescription("shuffle the input if you're adding multiple tracks"),
      )
      .addBooleanOption((option) =>
        option
          .setName("split")
          .setDescription("if a track has chapters, split it"),
      )
      .addBooleanOption((option) =>
        option
          .setName("skip")
          .setDescription("skip the currently playing track"),
      )
      .addStringOption((option) =>
        option
          .setName("at")
          .setDescription(
            "position to add the song to (e.g., 1, top, current, next, +3)",
          )
          .setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName("priority")
          .setDescription(
            "priority for weighted shuffle (default: 1.0, higher = more important)",
          )
          .setMinValue(0.01)
          .setRequired(false),
      );
  }

  public readonly aliases = ["p", "insert", "i", "pa", "playat"];

  public async executePrefix(
    message: Message,
    args: string[],
    prefix: string,
  ): Promise<void> {
    console.log(
      "play.executePrefix called with args:",
      args,
      "prefix:",
      prefix,
    );
    let query = "";
    let immediate = false;
    let shuffle = false;
    let skip = false;
    let at: string | undefined; // New variable for 'at' option
    let priority: number | undefined; // New variable for 'priority' option

    const filteredArgs: string[] = [];
    for (const arg of args) {
      if (arg === "--now") {
        immediate = true;
      } else if (arg === "--shuffle") {
        shuffle = true;
      } else if (arg === "--skip") {
        skip = true;
      } else if (arg.startsWith("--at=")) {
        at = arg.substring(5);
      } else if (arg.startsWith("--priority=") || arg.startsWith("-p=")) {
        const priorityValue = parseFloat(arg.split("=")[1]);
        if (!isNaN(priorityValue) && priorityValue > 0) {
          priority = priorityValue;
        }
      } else {
        filteredArgs.push(arg);
      }
    }

    console.log(
      "play.executePrefix - after flag parsing: immediate=",
      immediate,
      "shuffle=",
      shuffle,
      "skip=",
      skip,
      "at=",
      at,
      "filteredArgs:",
      filteredArgs,
    );

    query = filteredArgs.join(" ");
    console.log(
      "play.executePrefix - query after joining filteredArgs:",
      query,
    );

    // Check if the command used was 'insert' or 'i'
    const commandName = message.content
      .slice(prefix.length)
      .trim()
      .split(/ +/)[0]
      ?.toLowerCase();
    console.log(
      "play.executePrefix - commandName for alias check:",
      commandName,
    );
    if (commandName === "insert" || commandName === "i") {
      immediate = true;
      console.log("play.executePrefix - alias detected, immediate set to true");
    }

    // Handle 'pa' and 'playat' aliases for position
    if (["pa", "playat"].includes(commandName)) {
      if (filteredArgs.length < 2) {
        await message.channel.send(
          errorMsg("Please provide a position and a query."),
        );
        return;
      }

      at = filteredArgs[0];
      query = filteredArgs.slice(1).join(" ");
    }

    if (!query) {
      console.log("play.executePrefix - No query provided");
      await message.channel.send(errorMsg("Please provide a query to play."));
      return;
    }

    console.log(
      "play.executePrefix - Creating mock interaction with query:",
      query,
      "immediate:",
      immediate,
      "shuffle:",
      shuffle,
      "skip:",
      skip,
      "at:",
      at,
      "priority:",
      priority,
    );
    const mockInteraction = createMockInteraction(message, {
      options: {
        getString: (name: string) => {
          if (name === "query") {
            return query;
          }

          if (name === "at") {
            return at ?? null;
          }

          return null;
        },
        getBoolean: (name: string) => {
          if (name === "immediate") {
            return immediate;
          }

          if (name === "shuffle") {
            return shuffle;
          }

          if (name === "skip") {
            return skip;
          }

          if (name === "split") {
            return false;
          }

          return null;
        },
        getNumber: (name: string) => {
          if (name === "priority") {
            return priority ?? null;
          }

          return null;
        },
      },
    });
    console.log(
      "play.executePrefix - Calling this.execute with mockInteraction",
    );
    await this.execute(mockInteraction);
    console.log("play.executePrefix - this.execute call finished");
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const query = interaction.options.getString("query")!;
    const atOption = interaction.options.getString("at");

    let insertAt: number | undefined;
    if (atOption) {
      const player = await this.playerManager.get(interaction.guild!.id);
      try {
        insertAt = parsePositionArgument(atOption, player);
      } catch (error) {
        await interaction.reply({
          content: (error as Error).message,
          ephemeral: true,
        });
        return;
      }
    }

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: query.trim(),
      addToFrontOfQueue: interaction.options.getBoolean("immediate") ?? false,
      shuffleAdditions: interaction.options.getBoolean("shuffle") ?? false,
      shouldSplitChapters: interaction.options.getBoolean("split") ?? false,
      skipCurrentTrack: interaction.options.getBoolean("skip") ?? false,
      insertAtPosition: insertAt,
      priority: interaction.options.getNumber("priority") ?? undefined,
    });
  }

  public async handleAutocompleteInteraction(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const query = interaction.options.getString("query")?.trim();

    if (!query || query.length === 0) {
      await interaction.respond([]);
      return;
    }

    try {
      // Don't return suggestions for URLs
      // eslint-disable-next-line no-new
      new URL(query);
      await interaction.respond([]);
      return;
    } catch {
      // Not a URL, continue with search suggestions
    }

    const suggestions = await this.cache.wrap(
      getYouTubeAndSpotifySuggestionsFor,
      query,
      this.spotify,
      10,
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
        key: `autocomplete:${query}`,
      },
    );

    await interaction.respond(suggestions);
  }
}
