import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  GuildMember,
  Message,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable, optional } from "inversify";
import { TYPES } from "../types.js";
import Command from "./index.js";
import PlayerManager from "../managers/player.js";
import SpotifyAPI from "../services/spotify-api.js";
import GetSongs from "../services/get-songs.js";
import { QueuedSong, STATUS } from "../services/player.js";
import debug from "../utils/debug.js";
import { getGuildSettings } from "../utils/get-guild-settings.js";
import { buildPlayingMessageEmbed } from "../utils/build-embed.js";
import {
  getMemberVoiceChannel,
  getMostPopularVoiceChannel,
} from "../utils/channels.js";
import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class AlbumSearchCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("albumsearch")
    .setDescription("search Spotify albums and enqueue tracks from a selection")
    .addStringOption((o) =>
      o.setName("query").setDescription("album name/artist").setRequired(true),
    );

  public readonly aliases = ["asearch"];

  private readonly playerManager: PlayerManager;
  private readonly getSongs: GetSongs;
  private readonly spotify?: SpotifyAPI;

  constructor(
    @inject(TYPES.Managers.Player) playerManager: PlayerManager,
    @inject(TYPES.Services.GetSongs) getSongs: GetSongs,
    @inject(TYPES.Services.SpotifyAPI) @optional() spotify?: SpotifyAPI,
  ) {
    this.playerManager = playerManager;
    this.getSongs = getSongs;
    this.spotify = spotify;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!this.spotify) {
      await interaction.reply({
        content: "Spotify is not enabled!",
        ephemeral: true,
      });
      return;
    }

    const query = interaction.options.getString("query", true);
    const results = await this.searchAlbums(query);
    if (results.length === 0) {
      await interaction.reply({ content: "No albums found.", ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Albums: ${query}`)
      .setDescription(
        results.map((a, i) => `${i + 1}. ${a.name} — ${a.artist}`).join("\n"),
      );

    const select = new StringSelectMenuBuilder()
      .setCustomId("albumsearch-select")
      .setPlaceholder("Select an album")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        results.slice(0, 10).map((a, i) => ({
          label: `${a.name} — ${a.artist}`.slice(0, 100),
          value: String(i),
        })),
      );

    const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      select,
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("album-insert-now")
        .setLabel("Insert Next")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("album-add-end")
        .setLabel("Add to End")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("album-insert-at")
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
          i.customId === "albumsearch-select" &&
          i.user.id === interaction.user.id,
      })
      .catch(() => undefined);

    if (!selection) {
      await interaction.editReply({ content: "Timed out.", components: [] });
      return;
    }

    const idx = parseInt(selection.values[0], 10);
    await selection.deferUpdate();
    const album = results[idx];

    const action = await replyMessage
      .awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 60_000,
        filter: (i: ButtonInteraction) =>
          i.user.id === interaction.user.id &&
          ["album-insert-now", "album-add-end", "album-insert-at"].includes(
            i.customId,
          ),
      })
      .catch(() => undefined);

    if (!action) {
      await interaction.editReply({ content: "Timed out.", components: [] });
      return;
    }

    const settings = await getGuildSettings(interaction.guild!.id);
    let songs: QueuedSong[] = [];
    let extraMsg = "";

    try {
      const [albumSongs, extra] = await this.getSongs.getSongs(
        album.url,
        settings.playlistLimit,
        false,
      );

      if (albumSongs.length === 0) {
        await action.update({
          content: "No playable tracks were found for that album.",
          components: [],
        });
        return;
      }

      extraMsg = extra;
      songs = albumSongs.map((song) => ({
        ...song,
        priority: song.priority ?? 1.0,
        addedInChannelId: interaction.channel!.id,
        requestedBy: interaction.user.id,
      }));
    } catch (error) {
      debug(`Failed to load album tracks: ${String(error)}`);
      await action.update({
        content: "Failed to load tracks from that album.",
        components: [],
      });
      return;
    }

    const player = await this.playerManager.get(interaction.guild!.id);
    const wasPlayingSong = player.getCurrent() !== null;

    let targetVoiceChannel;
    try {
      [targetVoiceChannel] =
        getMemberVoiceChannel(interaction.member as GuildMember) ??
        getMostPopularVoiceChannel(interaction.guild!);
    } catch {
      targetVoiceChannel = undefined;
    }

    if (!targetVoiceChannel) {
      await action.update({
        content: "no voice channel to join - you must be in a voice channel",
        components: [],
      });
      return;
    }

    if (action.customId === "album-add-end") {
      await player.addMany(songs);
      await action.update({
        content: `Queued ${songs.length} track(s) from album.${
          extraMsg ? ` (${extraMsg})` : ""
        }`,
        components: [],
      });
    } else if (action.customId === "album-insert-now") {
      for (const song of songs) {
        await player.add(song, { immediate: true });
      }

      await action.update({
        content: `Inserted next ${songs.length} track(s) from album.${
          extraMsg ? ` (${extraMsg})` : ""
        }`,
        components: [],
      });
    } else {
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
        .catch((error) => {
          debug('awaitMessages failed', error);
          return undefined;
        });
      const content = reply?.first()?.content?.trim();
      const at = content ? parseInt(content, 10) : NaN;
      if (!content || Number.isNaN(at) || at < 1) {
        await interaction.followUp({
          content: "Invalid position. Cancelled.",
          ephemeral: true,
        });
        return;
      }

      for (let i = 0; i < songs.length; i++) {
        await player.add(songs[i], { insertAt: at + i });
      }

      await interaction.followUp({
        content: `Inserted ${songs.length} track(s) at position ${at}.${
          extraMsg ? ` (${extraMsg})` : ""
        }`,
        ephemeral: true,
      });
    }

    const hasActiveTrack = player.getCurrent() !== null;

    if (player.voiceConnection === null) {
      await player.connect(targetVoiceChannel);
      await player.play();
      if (wasPlayingSong) {
        await interaction.followUp({
          embeds: [buildPlayingMessageEmbed(player)],
        });
      }
    } else if (
      player.status === STATUS.IDLE ||
      player.status === STATUS.PAUSED ||
      !hasActiveTrack
    ) {
      await player.play();
    }
  }

  private async searchAlbums(
    query: string,
  ): Promise<Array<{ name: string; artist: string; url: string }>> {
    // Spotify Web API search needs to be added to SpotifyAPI; quick local implementation here is out-of-scope.
    // For now, treat plain text as Spotify search URL via open.spotify.com search deep-link is not ideal.
    // Minimal viable: return empty to avoid runtime break if Spotify not configured.
    try {
      // Type guard for Spotify API with search capability
      const api = this.spotify as unknown as {
        spotify?: {
          searchAlbums?: (
            query: string,
            options: { limit: number },
          ) => Promise<{
            body: {
              albums: {
                items: Array<{
                  name: string;
                  artists: Array<{ name: string }>;
                  external_urls: { spotify: string };
                }>;
              };
            };
          }>;
        };
      };

      if (api?.spotify?.searchAlbums) {
        const { body } = await api.spotify.searchAlbums(query, { limit: 10 });
        return body.albums.items.map((a) => ({
          name: a.name,
          artist: a.artists[0]?.name ?? "Unknown",
          url: a.external_urls.spotify,
        }));
      }
    } catch (error: unknown) {
      debug(`Failed to search albums: ${String(error)}`);
    }

    return [];
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const query = args.join(" ").trim();
    if (!query) {
      await message.channel.send("Usage: !albumsearch <query>");
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
