import { ChatInputCommandInteraction, Message } from "discord.js";
import { createMockInteraction } from "../utils/mock-interaction.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import { SongMetadata, QueuedSong } from "../services/player.js";
import fs from "fs/promises";
import path from "path";
import { TYPES } from "../types.js";
import PlayerManager from "../managers/player.js";
import Command from "./index.js";
import { buildQueueEmbed } from "../utils/build-embed.js";
import { getGuildSettings } from "../utils/get-guild-settings.js";

const PLAYLISTS_DIR = path.join("data", "playlists");

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("queue")
    .setDescription("show the current queue")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("show")
        .setDescription("show the current queue")
        .addStringOption((option) =>
          option
            .setName("page")
            .setDescription(
              "position or keyword: number, top, next, current, last [default: current]",
            )
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName("page-size")
            .setDescription(
              "how many items to display per page [default: 10, max: 30]",
            )
            .setMinValue(1)
            .setMaxValue(30)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("save")
        .setDescription("saves the current queue as a playlist")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("name of the playlist")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("load")
        .setDescription("loads a saved playlist")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("name of the playlist to load")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("lists all saved playlists"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("deletes a saved playlist")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("name of the playlist to delete")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("export")
        .setDescription("exports a saved playlist as a JSON file")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("name of the playlist to export")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("import")
        .setDescription("imports a playlist from a JSON file")
        .addAttachmentOption((option) =>
          option
            .setName("file")
            .setDescription("the JSON file containing the playlist")
            .setRequired(true),
        ),
    );

  public readonly aliases = ["q"];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "show":
        await this.executeShow(interaction);
        break;
      case "save":
        await this.executeSave(interaction);
        break;
      case "load":
        await this.executeLoad(interaction);
        break;
      case "list":
        await this.executeList(interaction);
        break;
      case "delete":
        await this.executeDelete(interaction);
        break;
      case "export":
        await this.executeExport(interaction);
        break;
      case "import":
        await this.executeImport(interaction);
        break;
      default:
        throw new Error(`Unknown subcommand: ${subcommand}`);
    }
  }

  public async executePrefix(message: Message, args: string[]) {
    let subcommand = args[0];
    let restArgs = args.slice(1);

    if (subcommand === 'import') {
      await message.reply({
        content: "The `import` command is only supported via slash commands.",
      });
      return;
    }

    const validSubcommands = [
      "show",
      "save",
      "load",
      "list",
      "delete",
      "export",
    ];
    if (!validSubcommands.includes(subcommand)) {
      subcommand = "show";
      restArgs = args;
    }

    const mockInteraction = createMockInteraction(message, {
      options: {
        getSubcommand: () => subcommand,
        getInteger: (name: string) => {
          if (subcommand === "show" && name === "page-size") {
            return restArgs[1] ? parseInt(restArgs[1], 10) : null;
          }

          return null;
        },
        getString: (name: string) => {
          if (subcommand === "show" && name === "page") {
            return restArgs[0] ?? "current";
          }

          if (name === "name") {
            if (["save", "load", "delete", "export"].includes(subcommand)) {
              return restArgs.join(" ");
            }
          }

          return null;
        },
        getAttachment: (_name: string) => {
          // Prefix commands do not support file attachments directly
          return null;
        },
      },
    });

    await this.execute(mockInteraction);
  }

  private async executeShow(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    const player = await this.playerManager.get(guildId);

    const pageSizeFromOptions = interaction.options.getInteger("page-size");
    const guildSettings = await getGuildSettings(guildId);
    const pageSize = pageSizeFromOptions ?? guildSettings.defaultQueuePageSize;

    let page: number;
    const pageOption = interaction.options.getString("page");

    if (!pageOption || pageOption === "current") {
      // Show page containing currently playing song
      page = Math.floor(player.queuePosition / pageSize) + 1;
    } else if (pageOption === "top") {
      // Always show first page (position 1)
      page = 1;
    } else if (pageOption === "next") {
      // Show page containing next song (current + 1)
      const nextPosition = player.queuePosition + 1;
      page = Math.floor(nextPosition / pageSize) + 1;
    } else if (pageOption === "last") {
      // Show page containing last song in full queue
      const totalSongs = player.getFullQueue().length;
      page = totalSongs > 0 ? Math.ceil(totalSongs / pageSize) : 1;
    } else {
      // Parse as absolute position (1-based) in full queue and convert to page
      const absolutePosition = parseInt(pageOption, 10);
      if (isNaN(absolutePosition) || absolutePosition < 1) {
        // Invalid position, default to current page
        page = Math.floor(player.queuePosition / pageSize) + 1;
      } else {
        // Convert absolute position (1-based) to page
        page = Math.floor((absolutePosition - 1) / pageSize) + 1;
      }
    }

    const embed = buildQueueEmbed(player, page, pageSize);

    const message = await interaction.reply({ embeds: [embed], fetchReply: true });

    await message.react('◀️');
    await message.react('▶️');

    const collector = message.createReactionCollector({
      filter: (reaction, user) => (reaction.emoji.name === '◀️' || reaction.emoji.name === '▶️') && user.id === interaction.user.id,
      time: 60000,
    });

    collector.on('collect', async (reaction) => {
      if (reaction.emoji.name === '◀️') {
        page--;
      } else {
        page++;
      }

      const maxQueuePage = Math.ceil(player.getFullQueue().length / pageSize);

      if (page < 1) {
        page = 1;
      } else if (page > maxQueuePage) {
        page = maxQueuePage;
      }

      const newEmbed = buildQueueEmbed(player, page, pageSize);

      await message.edit({ embeds: [newEmbed] });

      if (message.channel.isTextBased() && 'permissionsFor' in message.channel && message.channel.permissionsFor(message.client.user!)?.has('ManageMessages')) {
        reaction.users.remove(interaction.user.id).catch(error => {
          console.error('Failed to remove reaction:', error);
        });
      } else {
        console.warn('Missing MANAGE_MESSAGES permission to remove user reactions.');
      }
    });

    collector.on('end', async () => {
      console.log('collector ended');
      await message.reactions.removeAll().catch(error => {
        console.error('Failed to remove reactions:', error);
      });
    });
  }

  private async executeSave(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    const playlistName = interaction.options.getString("name")!;

    // Sanitize playlist name for filesystem
    const sanitizedPlaylistName = playlistName.replace(/[^a-z0-9_\-]/gi, "_");

    const player = await this.playerManager.get(guildId);
    const queue = player.getQueue();

    if (queue.length === 0) {
      await interaction.reply({
        content: "Queue is empty, nothing to save.",
        ephemeral: true,
      });
      return;
    }

    const filePath = path.join(
      PLAYLISTS_DIR,
      `${guildId}-${sanitizedPlaylistName}.json`,
    );

    try {
      await fs.access(filePath); // Check if file exists
      await interaction.reply({
        content: `Playlist "${playlistName}" already exists. Please choose a different name.`,
        ephemeral: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist, so we can write it
        const playlistData = {
          name: playlistName,
          songs: queue.map((queuedSong) => {
            // Convert QueuedSong back to SongMetadata by removing Discord-specific fields
            const { addedInChannelId, requestedBy, ...songMetadata } =
              queuedSong;
            return songMetadata;
          }),
        };

        await fs.writeFile(filePath, JSON.stringify(playlistData, null, 2));

        await interaction.reply({
          content: `Queue saved as "${playlistName}".`,
        });
      } else {
        console.error(error);
        await interaction.reply({
          content: "An error occurred while saving the playlist.",
          ephemeral: true,
        });
      }
    }
  }

  private async executeLoad(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    const playlistName = interaction.options.getString("name")!;

    const sanitizedPlaylistName = playlistName.replace(/[^a-z0-9_\\-]/gi, "_");

    const filePath = path.join(
      PLAYLISTS_DIR,
      `${guildId}-${sanitizedPlaylistName}.json`,
    );

    try {
      const fileContent = await fs.readFile(filePath, "utf-8");
      const playlistData = JSON.parse(fileContent) as {
        songs?: SongMetadata[];
        name?: string;
      };

      const player = await this.playerManager.get(guildId);

      const songs: QueuedSong[] = (playlistData.songs ?? []).map(
        (song: SongMetadata) => ({
          ...song,
          addedInChannelId: interaction.channel!.id,
          requestedBy: interaction.user.id,
        }),
      );

      await player.addMany(songs);

      await interaction.reply({
        content: `Playlist "${playlistName}" loaded and added to the queue.`,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await interaction.reply({
          content: `Playlist "${playlistName}" not found.`,
          ephemeral: true,
        });
      } else {
        console.error(error);
        await interaction.reply({
          content: "An error occurred while loading the playlist.",
          ephemeral: true,
        });
      }
    }
  }

  private async executeList(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;

    try {
      const files = await fs.readdir(PLAYLISTS_DIR);

      const guildPlaylists = files.filter(
        (file) => file.startsWith(`${guildId}-`) && file.endsWith(".json"),
      );

      if (guildPlaylists.length === 0) {
        await interaction.reply({
          content: "No saved playlists found for this server.",
          ephemeral: true,
        });
        return;
      }

      const playlistNames = await Promise.all(
        guildPlaylists.map(async (file) => {
          const filePath = path.join(PLAYLISTS_DIR, file);
          const fileContent = await fs.readFile(filePath, "utf-8");
          const playlistData = JSON.parse(fileContent) as { name?: string };
          return playlistData.name ?? "Unknown";
        }),
      );

      await interaction.reply({
        content: `**Saved Playlists:**\n- ${playlistNames.join("\n- ")}`,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await interaction.reply({
          content: "No saved playlists found for this server.",
          ephemeral: true,
        });
      } else {
        console.error(error);
        await interaction.reply({
          content: "An error occurred while listing playlists.",
          ephemeral: true,
        });
      }
    }
  }

  private async executeDelete(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    const playlistName = interaction.options.getString("name")!;

    const sanitizedPlaylistName = playlistName.replace(/[^a-z0-9_\\-]/gi, "_");

    const filePath = path.join(
      PLAYLISTS_DIR,
      `${guildId}-${sanitizedPlaylistName}.json`,
    );

    try {
      await fs.unlink(filePath);
      await interaction.reply({
        content: `Playlist "${playlistName}" deleted.`,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await interaction.reply({
          content: `Playlist "${playlistName}" not found.`,
          ephemeral: true,
        });
      } else {
        console.error(error);
        await interaction.reply({
          content: "An error occurred while deleting the playlist.",
          ephemeral: true,
        });
      }
    }
  }

  private async executeExport(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    const playlistName = interaction.options.getString("name")!;

    const sanitizedPlaylistName = playlistName.replace(/[^a-z0-9_\\-]/gi, "_");

    const filePath = path.join(
      PLAYLISTS_DIR,
      `${guildId}-${sanitizedPlaylistName}.json`,
    );

    try {
      const fileContent = await fs.readFile(filePath, "utf-8");
      const playlistData = JSON.parse(fileContent) as {
        songs?: SongMetadata[];
        name?: string;
      };

      const fileBuffer = Buffer.from(JSON.stringify(playlistData, null, 2));

      await interaction.reply({
        files: [
          {
            attachment: fileBuffer,
            name: `${sanitizedPlaylistName}.json`,
          },
        ],
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await interaction.reply({
          content: `Playlist "${playlistName}" not found.`,
          ephemeral: true,
        });
      } else {
        console.error(error);
        await interaction.reply({
          content: "An error occurred while exporting the playlist.",
          ephemeral: true,
        });
      }
    }
  }

  private async executeImport(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    const attachment = interaction.options.getAttachment("file");

    if (!attachment) {
      await interaction.reply({
        content: "Please attach a JSON file to import.",
        ephemeral: true,
      });
      return;
    }

    if (!attachment.name?.endsWith(".json")) {
      await interaction.reply({
        content: "The attached file must be a JSON file.",
        ephemeral: true,
      });
      return;
    }

    try {
      const response = await fetch(attachment.url);
      const playlistData = (await response.json()) as {
        songs?: unknown[];
        name?: string;
      };

      if (!playlistData.songs || !Array.isArray(playlistData.songs)) {
        await interaction.reply({
          content: "Invalid playlist file format. Missing 'songs' array.",
          ephemeral: true,
        });
        return;
      }

      const player = await this.playerManager.get(guildId);

      const songs: QueuedSong[] = playlistData.songs.map(
        (song: SongMetadata) => ({
          ...song,
          addedInChannelId: interaction.channel!.id,
          requestedBy: interaction.user.id,
        }),
      );

      await player.addMany(songs);

      await interaction.reply({
        content: `Playlist "${playlistData.name ?? "imported playlist"}" loaded and added to the queue.`,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content:
          "An error occurred while importing the playlist. Please ensure it's a valid JSON file.",
        ephemeral: true,
      });
    }
  }
}
