import { VoiceChannel, Snowflake } from "discord.js";
import { Readable } from "stream";
import hasha from "hasha";
import { spawn } from "child_process";
import { WriteStream } from "fs-capacitor";
import ffmpeg from "fluent-ffmpeg";
import shuffle from "array-shuffle";
import {
  AudioPlayer,
  AudioPlayerState,
  AudioPlayerStatus,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  DiscordGatewayAdapterCreator,
  joinVoiceChannel,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import FileCacheProvider from "./file-cache.js";
import Config from "./config.js";
import debug from "../utils/debug.js";
import { getGuildSettings } from "../utils/get-guild-settings.js";
import { buildPlayingMessageEmbed } from "../utils/build-embed.js";
import { Setting } from "@prisma/client";
import path from "path";
import fs from "fs";

import { ONE_MINUTE_IN_SECONDS } from "../utils/constants.js"; // Add this import
import { prisma } from "../utils/db.js";
import { formatError } from "../utils/format-error.js";

export enum MediaSource {
  Youtube,
  HLS,
}

export interface QueuedPlaylist {
  title: string;
  source: string;
}

export interface SongMetadata {
  title: string;
  artist: string;
  url: string; // For YT, it's the video ID (not the full URI)
  length: number;
  offset: number;
  playlist: QueuedPlaylist | null;
  isLive: boolean;
  thumbnailUrl: string | null;
  source: MediaSource;
  priority?: number; // Priority for weighted shuffle (default: 1.0, must be > 0)
}
export interface QueuedSong extends SongMetadata {
  addedInChannelId: Snowflake;
  requestedBy: string;
}

export interface FullPlaylist {
  songs: SongMetadata[];
  addedCount: number;
  timestamp: number; // Unix timestamp for expiration
}

export enum STATUS {
  PLAYING,
  PAUSED,
  IDLE,
}

export interface PlayerEvents {
  statusChange: (oldStatus: STATUS, newStatus: STATUS) => void;
}

interface QueueSnapshot {
  queue: QueuedSong[];
  queuePosition: number;
  loopCurrentSong: boolean;
  loopCurrentQueue: boolean;
}

interface VideoFormat {
  url: string;
  itag: string | number;
  codecs?: string;
  container?: string;
  audioSampleRate?: string;
  averageBitrate?: number;
  bitrate?: string | number;
  isLive?: boolean;
  loudnessDb?: number;
  httpHeaders?: Record<string, string>;
}

interface YtDlpFormat {
  url?: string;
  format_id?: string;
  acodec?: string;
  vcodec?: string;
  ext?: string;
  asr?: number;
  abr?: number;
  tbr?: number;
  loudness_db?: number;
  http_headers?: Record<string, string>;
}

interface YtDlpResponse {
  formats?: YtDlpFormat[];
  is_live?: boolean;
  duration?: number;
}

const QUEUE_SAVE_DEBOUNCE_MS = 500;
export const DEFAULT_VOLUME = 100;

export default class Player {
  public voiceConnection: VoiceConnection | null = null;
  public status = STATUS.PAUSED;
  public guildId: string;
  public loopCurrentSong = false;
  public loopCurrentQueue = false;
  private currentChannel: VoiceChannel | undefined;
  private queue: QueuedSong[] = [];
  public queuePosition = 0;
  private audioPlayer: AudioPlayer | null = null;
  private audioResource: AudioResource | null = null;
  private volume?: number;
  private defaultVolume: number = DEFAULT_VOLUME;
  private nowPlaying: QueuedSong | null = null;
  private playPositionInterval: NodeJS.Timeout | undefined;
  private lastSongURL = "";

  private positionInSeconds = 0;
  private readonly fileCache: FileCacheProvider;
  private readonly config: Config;
  private disconnectTimer: NodeJS.Timeout | null = null;

  private readonly channelToSpeakingUsers: Map<string, Set<string>> = new Map();
  private fullPlaylists: Map<string, FullPlaylist> = new Map(); // New property
  private queueLock: Promise<void> = Promise.resolve();
  private queueSaveTimer: NodeJS.Timeout | undefined;
  private queueStateDirty = false;
  private static readonly UNDO_STACK_LIMIT = 20;
  private undoStack: QueueSnapshot[] = [];
  private static hasLoggedMissingQueueState = false;

  private constructor(fileCache: FileCacheProvider, guildId: string, config: Config) {
    this.fileCache = fileCache;
    this.guildId = guildId;
    this.config = config;
  }

  static async create(
    fileCache: FileCacheProvider,
    guildId: string,
    config: Config,
  ): Promise<Player> {
    const player = new Player(fileCache, guildId, config);
    await player.loadQueueState();
    return player;
  }

  private enqueueOperation<T>(
    operation: () => Promise<T> | T,
    { recordUndo = false }: { recordUndo?: boolean } = {},
  ): Promise<T> {
    const next = this.queueLock.then(async () => {
      if (recordUndo) {
        this.pushUndoSnapshot();
      }

      return operation();
    });

    this.queueLock = next.then(() => undefined).catch(() => undefined);

    return next;
  }

  private getQueueStateDelegate() {
    const delegate = (
      prisma as typeof prisma & {
        queueState?: typeof prisma.queueState;
      }
    ).queueState;

    if (!delegate && !Player.hasLoggedMissingQueueState) {
      Player.hasLoggedMissingQueueState = true;
      debug(
        "QueueState model is missing from the Prisma client. Run `npx prisma generate` in the runtime environment to enable queue persistence.",
      );
    }

    return delegate ?? null;
  }

  private markQueueStateDirty(): void {
    this.queueStateDirty = true;

    if (this.queueSaveTimer) {
      clearTimeout(this.queueSaveTimer);
    }

    this.queueSaveTimer = setTimeout(() => {
      void this.flushQueueState();
    }, QUEUE_SAVE_DEBOUNCE_MS);
  }

  private async flushQueueState(): Promise<void> {
    await this.enqueueOperation(async () => {
      if (!this.queueStateDirty) {
        return;
      }

      if (this.queueSaveTimer) {
        clearTimeout(this.queueSaveTimer);
        this.queueSaveTimer = undefined;
      }

      this.queueStateDirty = false;
      await this.persistQueueContents();
    });
  }

  private pushUndoSnapshot(): void {
    const snapshot: QueueSnapshot = {
      queue: this.queue.map((song) => ({
        ...song,
        playlist: song.playlist ? { ...song.playlist } : null,
      })),
      queuePosition: this.queuePosition,
      loopCurrentSong: this.loopCurrentSong,
      loopCurrentQueue: this.loopCurrentQueue,
    };

    this.undoStack.push(snapshot);

    if (this.undoStack.length > Player.UNDO_STACK_LIMIT) {
      this.undoStack.shift();
    }
  }

  private clampQueuePosition(): void {
    if (this.queue.length === 0) {
      this.queuePosition = 0;
      return;
    }

    if (this.queuePosition < 0) {
      this.queuePosition = 0;
      return;
    }

    if (this.queuePosition >= this.queue.length) {
      this.queuePosition = this.queue.length - 1;
    }
  }

  // Save queue contents (called via debounce)
  private async persistQueueContents(): Promise<void> {
    const queueState = this.getQueueStateDelegate();
    if (!queueState) {
      return;
    }

    try {
      await queueState.upsert({
        where: { guildId: this.guildId },
        create: {
          guildId: this.guildId,
          queue: JSON.stringify(this.queue),
          queuePosition: this.queuePosition,
          loopCurrentSong: this.loopCurrentSong,
          loopCurrentQueue: this.loopCurrentQueue,
        },
        update: {
          queue: JSON.stringify(this.queue),
          queuePosition: this.queuePosition,
          loopCurrentSong: this.loopCurrentSong,
          loopCurrentQueue: this.loopCurrentQueue,
        },
      });
      debug(`Saved queue contents for guild ${this.guildId}`);
    } catch (error: unknown) {
      debug(`Failed to save queue contents: ${formatError(error)}`);
    }
  }

  async saveFullState(): Promise<void> {
    const queueState = this.getQueueStateDelegate();
    if (!queueState) {
      return;
    }

    await this.enqueueOperation(async () => {
      if (this.queueSaveTimer) {
        clearTimeout(this.queueSaveTimer);
        this.queueSaveTimer = undefined;
      }

      this.queueStateDirty = false;

      try {
        await queueState.upsert({
          where: { guildId: this.guildId },
          create: {
            guildId: this.guildId,
            queue: JSON.stringify(this.queue),
            queuePosition: this.queuePosition,
            nowPlaying: this.nowPlaying
              ? JSON.stringify(this.nowPlaying)
              : null,
            loopCurrentSong: this.loopCurrentSong,
            loopCurrentQueue: this.loopCurrentQueue,
            volume: this.volume,
          },
          update: {
            queue: JSON.stringify(this.queue),
            queuePosition: this.queuePosition,
            nowPlaying: this.nowPlaying
              ? JSON.stringify(this.nowPlaying)
              : null,
            loopCurrentSong: this.loopCurrentSong,
            loopCurrentQueue: this.loopCurrentQueue,
            volume: this.volume,
          },
        });
        debug(`Saved full state for guild ${this.guildId}`);
      } catch (error: unknown) {
        debug(`Failed to save full state: ${formatError(error)}`);
      }
    });
  }

  private async loadQueueState(): Promise<void> {
    const queueState = this.getQueueStateDelegate();
    if (!queueState) {
      return;
    }

    try {
      const savedState = await queueState.findUnique({
        where: { guildId: this.guildId },
      });

      if (savedState) {
        this.queue = JSON.parse(savedState.queue) as QueuedSong[];
        this.queuePosition = savedState.queuePosition;
        this.loopCurrentSong = savedState.loopCurrentSong;
        this.loopCurrentQueue = savedState.loopCurrentQueue;

        if (savedState.volume !== null) {
          this.volume = savedState.volume;
        }

        if (savedState.nowPlaying) {
          this.nowPlaying = JSON.parse(savedState.nowPlaying) as QueuedSong;
        }

        debug(
          `Loaded queue state for guild ${this.guildId}: ${this.queue.length} songs, position ${this.queuePosition}`,
        );
      }

      if (this.queue.length === 0) {
        this.queuePosition = 0;
      } else if (
        this.queuePosition < 0 ||
        this.queuePosition >= this.queue.length
      ) {
        debug(
          `Queue position ${this.queuePosition} out of bounds for guild ${this.guildId}, resetting to 0`,
        );
        this.queuePosition = 0;
      }
    } catch (error: unknown) {
      debug(`Failed to load queue state: ${formatError(error)}`);
    }
  }

  storeFullPlaylist(playlistId: string, songs: SongMetadata[]): void {
    this.fullPlaylists.set(playlistId, {
      songs,
      addedCount: 0,
      timestamp: Date.now(),
    });
  }

  getStoredPlaylist(playlistId: string): FullPlaylist | undefined {
    const playlist = this.fullPlaylists.get(playlistId);
    if (
      playlist &&
      Date.now() - playlist.timestamp < 15 * ONE_MINUTE_IN_SECONDS
    ) {
      // 15 minutes expiration
      return playlist;
    }
    this.fullPlaylists.delete(playlistId); // Clear expired
    return undefined;
  }

  async addNextBatch(
    playlistId: string,
    count: number,
  ): Promise<SongMetadata[]> {
    const storedPlaylist = this.getStoredPlaylist(playlistId);
    if (!storedPlaylist) {
      throw new Error("No stored playlist found or it has expired.");
    }

    const startIndex = storedPlaylist.addedCount;
    const endIndex = Math.min(startIndex + count, storedPlaylist.songs.length);
    const songsToAdd = storedPlaylist.songs.slice(startIndex, endIndex);

    if (songsToAdd.length === 0) {
      throw new Error("No more songs to add from this playlist.");
    }

    // Add songs to the main queue
    for (const song of songsToAdd) {
      await this.add(song as QueuedSong);
    }

    storedPlaylist.addedCount = endIndex;
    storedPlaylist.timestamp = Date.now(); // Refresh timestamp
    this.fullPlaylists.set(playlistId, storedPlaylist); // Update map

    return songsToAdd;
  }

  getStoredPlaylistIds(): string[] {
    const validIds: string[] = [];
    const now = Date.now();

    for (const [id, playlist] of this.fullPlaylists.entries()) {
      if (now - playlist.timestamp < 15 * ONE_MINUTE_IN_SECONDS) {
        validIds.push(id);
      } else {
        this.fullPlaylists.delete(id); // Clean up expired
      }
    }

    return validIds;
  }

  getStoredPlaylistTitles(): Array<{ id: string; title: string }> {
    const validPlaylists: Array<{ id: string; title: string }> = [];
    const now = Date.now();

    for (const [id, playlist] of this.fullPlaylists.entries()) {
      if (now - playlist.timestamp < 15 * ONE_MINUTE_IN_SECONDS) {
        const title = playlist.songs[0]?.playlist?.title ?? "Unknown Playlist";
        validPlaylists.push({ id, title });
      } else {
        this.fullPlaylists.delete(id); // Clean up expired
      }
    }

    return validPlaylists;
  }

  async connect(channel: VoiceChannel): Promise<void> {
    // Always get freshest default volume setting value
    const settings = await getGuildSettings(this.guildId);
    const { defaultVolume = DEFAULT_VOLUME } = settings;
    this.defaultVolume = defaultVolume;

    this.voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      selfDeaf: true,
      adapterCreator: channel.guild
        .voiceAdapterCreator as DiscordGatewayAdapterCreator,
    });

    const guildSettings = await getGuildSettings(this.guildId);

    // Workaround to disable keepAlive
    this.voiceConnection.on("stateChange", (oldState, newState) => {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
      const oldNetworking = Reflect.get(oldState, "networking");
      const newNetworking = Reflect.get(newState, "networking");

      const networkStateChangeHandler = (_: any, newNetworkState: any) => {
        const newUdp = Reflect.get(newNetworkState, "udp");
        clearInterval(newUdp?.keepAliveInterval);
      };

      oldNetworking?.off("stateChange", networkStateChangeHandler);
      newNetworking?.on("stateChange", networkStateChangeHandler);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

      this.currentChannel = channel;
      if (newState.status === VoiceConnectionStatus.Ready) {
        this.registerVoiceActivityListener(guildSettings);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (!this.voiceConnection) {
      return;
    }

    if (this.status === STATUS.PLAYING) {
      this.pause();
    }

    this.loopCurrentSong = false;
    this.voiceConnection.destroy();
    this.audioPlayer?.stop(true);

    this.voiceConnection = null;
    this.audioPlayer = null;
    this.audioResource = null;

    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    // Save full state including position on disconnect
    await this.saveFullState();
  }

  async seek(positionSeconds: number): Promise<void> {
    this.status = STATUS.PAUSED;

    if (this.voiceConnection === null) {
      throw new Error("Not connected to a voice channel.");
    }

    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error("No song currently playing");
    }

    if (positionSeconds > currentSong.length) {
      throw new Error("Seek position is outside the range of the song.");
    }

    let realPositionSeconds = positionSeconds;
    if (currentSong.offset !== undefined) {
      realPositionSeconds += currentSong.offset;
    }

    const stream = await this.getFfmpegInput(currentSong, {
      seek: realPositionSeconds,
    });
    this.audioPlayer = createAudioPlayer({
      behaviors: {
        // Needs to be somewhat high for livestreams
        maxMissedFrames: 50,
      },
    });
    this.voiceConnection.subscribe(this.audioPlayer);
    this.playAudioPlayerResource(this.createAudioStream(stream));
    this.attachListeners();
    this.startTrackingPosition(positionSeconds);

    this.status = STATUS.PLAYING;
  }

  async forwardSeek(positionSeconds: number): Promise<void> {
    return this.seek(this.positionInSeconds + positionSeconds);
  }

  getPosition(): number {
    return this.positionInSeconds;
  }

  async play(): Promise<void> {
    this.clampQueuePosition();

    if (this.voiceConnection === null) {
      throw new Error("Not connected to a voice channel.");
    }

    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error("Queue empty.");
    }

    // Cancel any pending idle disconnection
    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    // Resume from paused state
    if (
      this.status === STATUS.PAUSED &&
      currentSong.url === this.nowPlaying?.url
    ) {
      if (this.audioPlayer) {
        this.audioPlayer.unpause();
        this.status = STATUS.PLAYING;
        this.startTrackingPosition();
        return;
      }

      // Was disconnected, need to recreate stream
      if (!currentSong.isLive) {
        return this.seek(this.getPosition());
      }
    }

    try {
      let positionSeconds: number | undefined;
      if (currentSong.offset !== undefined) {
        positionSeconds = currentSong.offset;
      }

      const stream = await this.getFfmpegInput(currentSong, {
        seek: positionSeconds,
      });
      this.audioPlayer = createAudioPlayer({
        behaviors: {
          // Needs to be somewhat high for livestreams
          maxMissedFrames: 50,
        },
      });
      this.voiceConnection.subscribe(this.audioPlayer);
      this.playAudioPlayerResource(this.createAudioStream(stream));

      this.attachListeners();

      this.status = STATUS.PLAYING;
      this.nowPlaying = currentSong;

      if (currentSong.url === this.lastSongURL) {
        this.startTrackingPosition();
      } else {
        // Reset position counter
        this.startTrackingPosition(0);
        this.lastSongURL = currentSong.url;
      }
    } catch (error: unknown) {
      const noUpcomingSongs = this.queuePosition + 1 >= this.queue.length;

      if (noUpcomingSongs) {
        await this.enqueueOperation(() => {
          if (this.queue.length > 0) {
            this.queue.splice(this.queuePosition, 1);
            this.clampQueuePosition();
          }
          this.status = STATUS.IDLE;
          this.nowPlaying = null;
          this.stopTrackingPosition();
          this.audioPlayer?.stop(true);
          this.markQueueStateDirty();
        });

        debug(
          `Playback failed at end of queue for "${
            currentSong?.title ?? "unknown"
          }": ${formatError(error)}`,
        );
        return;
      }

      let skipSucceeded = false;

      try {
        await this.forward(1);
        skipSucceeded = true;
      } catch (forwardError: unknown) {
        debug(
          `Could not skip forward after play error: ${formatError(forwardError)}`,
        );
      }

      if ((error as { statusCode: number }).statusCode === 410 && currentSong) {
        const channelId = currentSong.addedInChannelId;

        if (channelId) {
          debug(`${currentSong.title} is unavailable`);
          return;
        }
      }

      if (skipSucceeded) {
        debug(
          `Skipped "${currentSong?.title ?? "unknown"}" after play error: ${formatError(error)}`,
        );
        return;
      }

      this.status = STATUS.IDLE;
      this.nowPlaying = null;
      this.stopTrackingPosition();

      throw error;
    }
  }

  pause(): void {
    if (this.status !== STATUS.PLAYING) {
      throw new Error("Not currently playing.");
    }

    this.status = STATUS.PAUSED;

    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    this.stopTrackingPosition();
  }

  async forward(skip: number): Promise<void> {
    if (skip < 1) {
      throw new Error("Skip amount must be at least 1.");
    }

    const previousPosition = this.queuePosition;

    await this.enqueueOperation(() => {
      const targetPosition = this.queuePosition + skip;

      if (targetPosition >= this.queue.length) {
        throw new Error("No songs in queue to forward to.");
      }

      this.queuePosition = targetPosition;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
      this.markQueueStateDirty();
    });

    try {
      const currentSong = this.getCurrent();

      if (currentSong) {
        await this.play();
      } else {
        await this.enqueueOperation(() => {
          this.status = STATUS.IDLE;
          this.nowPlaying = null;
          this.audioPlayer?.stop(true);
        });

        const settings = await getGuildSettings(this.guildId);
        const { secondsToWaitAfterQueueEmpties } = settings;

        if (secondsToWaitAfterQueueEmpties !== 0) {
          this.disconnectTimer = setTimeout(() => {
            if (this.status === STATUS.IDLE) {
              void this.disconnect();
            }
          }, secondsToWaitAfterQueueEmpties * 1000);
        }
      }
    } catch (error: unknown) {
      await this.enqueueOperation(() => {
        this.queuePosition = previousPosition;
        this.positionInSeconds = 0;
        this.stopTrackingPosition();
        this.markQueueStateDirty();
      });

      throw error;
    }
  }

  registerVoiceActivityListener(guildSettings: Setting) {
    const {
      turnDownVolumeWhenPeopleSpeak,
      turnDownVolumeWhenPeopleSpeakTarget,
    } = guildSettings;
    if (!turnDownVolumeWhenPeopleSpeak || !this.voiceConnection) {
      return;
    }

    this.voiceConnection.receiver.speaking.on("start", (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel?.id;

      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.add(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(
        turnDownVolumeWhenPeopleSpeakTarget,
      );
    });

    this.voiceConnection.receiver.speaking.on("end", (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel.id;
      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.delete(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(
        turnDownVolumeWhenPeopleSpeakTarget,
      );
    });
  }

  suppressVoiceWhenPeopleAreSpeaking(
    turnDownVolumeWhenPeopleSpeakTarget: number,
  ): void {
    if (!this.currentChannel) {
      return;
    }

    const speakingUsers = this.channelToSpeakingUsers.get(
      this.currentChannel.id,
    );
    if (speakingUsers && speakingUsers.size > 0) {
      this.setVolume(turnDownVolumeWhenPeopleSpeakTarget);
    } else {
      this.setVolume(this.defaultVolume);
    }
  }

  canGoBack() {
    return this.queuePosition - 1 >= 0;
  }

  async back(): Promise<void> {
    if (!this.canGoBack()) {
      throw new Error("No songs in queue to go back to.");
    }

    await this.enqueueOperation(() => {
      this.queuePosition--;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
      this.markQueueStateDirty();
    });

    if (this.status !== STATUS.PAUSED) {
      await this.play();
    }
  }

  getCurrent(): QueuedSong | null {
    if (this.queue[this.queuePosition]) {
      return this.queue[this.queuePosition];
    }

    return null;
  }

  getSongAt(index: number): QueuedSong | null {
    if (index > 0 && index <= this.queue.length) {
      return this.queue[index - 1];
    }
    return null;
  }

  getFullQueueLength(): number {
    return this.queue.length;
  }

  async jumpTo(position: number): Promise<void> {
    if (position < 1 || position > this.queue.length) {
      throw new Error("Position is out of bounds.");
    }

    await this.enqueueOperation(() => {
      this.queuePosition = position - 1;
      this.positionInSeconds = 0; // Reset song position when jumping
      this.stopTrackingPosition();
      this.markQueueStateDirty();
    });

    await this.play();
  }

  /**
   * Returns queue, not including the current song.
   * @returns {QueuedSong[]}
   */
  getQueue(): QueuedSong[] {
    return this.queue.slice(this.queuePosition + 1);
  }

  /**
   * Returns the full queue including all songs (past, current, and upcoming).
   * @returns {QueuedSong[]}
   */
  getFullQueue(): QueuedSong[] {
    return this.queue;
  }

  async add(
    song: QueuedSong,
    {
      immediate = false,
      insertAt,
    }: { immediate?: boolean; insertAt?: number } = {},
  ): Promise<void> {
    await this.enqueueOperation(
      () => {
        if (insertAt !== undefined) {
          // Insert at specific position (1-based index)
          const targetIndex = Math.max(0, insertAt - 1);
          this.queue.splice(targetIndex, 0, song);
        } else if (song.playlist || !immediate) {
          // Add to end of queue
          this.queue.push(song);
        } else {
          // Add as the next song to be played (immediate = true)
          const insertIndex = Math.min(
            this.queuePosition + 1,
            this.queue.length,
          );
          this.queue.splice(insertIndex, 0, song);
        }

        this.markQueueStateDirty();
      },
      { recordUndo: true },
    );
  }

  async addMany(songs: QueuedSong[]): Promise<void> {
    if (songs.length === 0) {
      return;
    }

    await this.enqueueOperation(
      () => {
        this.queue.push(...songs);
        this.markQueueStateDirty();
      },
      { recordUndo: true },
    );
  }

  private shuffleSongs(songs: QueuedSong[], weighted: boolean): QueuedSong[] {
    if (!weighted) {
      return shuffle([...songs]);
    }

    return [...songs]
      .map((song) => ({
        song,
        // Ensure priority is a positive number; default to 1
        weight: Math.max(song.priority ?? 1, 0.0001),
        key: -Math.log(Math.random()),
      }))
      .sort((a, b) => a.key / a.weight - b.key / b.weight)
      .map((entry) => entry.song);
  }

  async shuffle(upcomingOnly = false, weighted = false): Promise<void> {
    if (this.isQueueEmpty()) {
      return; // No need to shuffle an empty queue
    }

    await this.enqueueOperation(
      () => {
        if (upcomingOnly) {
          const upcomingSongs = this.queue.slice(this.queuePosition + 1);
          const shuffledUpcoming = this.shuffleSongs(upcomingSongs, weighted);
          this.queue = [
            ...this.queue.slice(0, this.queuePosition + 1),
            ...shuffledUpcoming,
          ];
        } else {
          // Shuffle entire queue excluding the currently playing song
          const currentSong = this.queue[this.queuePosition];
          const restOfQueue = this.queue.slice(this.queuePosition + 1);
          const shuffledRest = this.shuffleSongs(restOfQueue, weighted);
          this.queue = [currentSong, ...shuffledRest];
          this.queuePosition = 0; // Reset queue position to the start of the shuffled queue
        }

        this.markQueueStateDirty();
      },
      { recordUndo: true },
    );
  }

  async shuffleRange(
    from: number,
    to: number,
    weighted = false,
  ): Promise<void> {
    if (from > to) {
      throw new Error("'from' must be less than or equal to 'to'.");
    }

    await this.enqueueOperation(
      () => {
        const startIndex = from - 1;
        const endIndex = to - 1;

        if (startIndex < 0 || endIndex >= this.queue.length) {
          throw new Error("Range is outside the queue bounds.");
        }

        if (
          startIndex <= this.queuePosition &&
          this.queuePosition <= endIndex
        ) {
          throw new Error(
            "Cannot shuffle a range that includes the currently playing song.",
          );
        }

        const segment = this.queue.slice(startIndex, endIndex + 1);
        const shuffledSegment = this.shuffleSongs(segment, weighted);

        this.queue.splice(startIndex, segment.length, ...shuffledSegment);
        this.markQueueStateDirty();
      },
      { recordUndo: true },
    );
  }

  async clear(): Promise<void> {
    const current = this.getCurrent();

    await this.enqueueOperation(
      () => {
        const newQueue: QueuedSong[] = [];

        if (current) {
          newQueue.push(current);
        }

        this.queue = newQueue;
        this.queuePosition = 0;

        this.markQueueStateDirty();
      },
      { recordUndo: true },
    );
  }

  async removeFromQueue(index: number, amount = 1): Promise<void> {
    await this.enqueueOperation(
      () => {
        if (amount < 1) {
          throw new Error("Amount must be at least 1.");
        }

        const startIndex = this.queuePosition + index;

        if (
          startIndex < this.queuePosition ||
          startIndex >= this.queue.length
        ) {
          throw new Error("Removal index is outside the range of the queue.");
        }

        if (startIndex + amount > this.queue.length) {
          throw new Error("Removal range exceeds the queue length.");
        }

        this.queue.splice(startIndex, amount);
        this.clampQueuePosition();
        this.markQueueStateDirty();
      },
      { recordUndo: true },
    );
  }

  async removeCurrent(): Promise<void> {
    await this.enqueueOperation(
      () => {
        this.queue = [
          ...this.queue.slice(0, this.queuePosition),
          ...this.queue.slice(this.queuePosition + 1),
        ];
        this.clampQueuePosition();
        this.markQueueStateDirty();
      },
      { recordUndo: true },
    );
  }

  async removeDuplicates(): Promise<number> {
    return this.enqueueOperation(
      () => {
        const startIndex = Math.max(this.queuePosition + 1, 0);
        const seen = new Set<string>();
        const prefix = this.queue.slice(0, startIndex);
        const upcoming = this.queue.slice(startIndex);

        const deduped: QueuedSong[] = [];
        let removed = 0;

        for (const song of upcoming) {
          const key = `${song.source}:${song.url}`;
          if (seen.has(key)) {
            removed++;
            continue;
          }

          seen.add(key);
          deduped.push(song);
        }

        if (removed === 0) {
          if (this.undoStack.length > 0) {
            this.undoStack.pop();
          }
          return 0;
        }

        this.queue = [...prefix, ...deduped];
        this.markQueueStateDirty();
        return removed;
      },
      { recordUndo: true },
    );
  }

  async resetPriorities(): Promise<number> {
    return this.enqueueOperation(
      () => {
        let updated = 0;

        const updatedQueue = this.queue.map((song) => {
          const newPriority = song.priority ?? 1;

          if (newPriority !== 1) {
            updated++;
            return {
              ...song,
              priority: 1,
            };
          }

          if (song.priority === undefined) {
            updated++;
            return {
              ...song,
              priority: 1,
            };
          }

          return song;
        });

        if (updated === 0) {
          if (this.undoStack.length > 0) {
            this.undoStack.pop();
          }
          return 0;
        }

        this.queue = updatedQueue;
        this.markQueueStateDirty();
        return updated;
      },
      { recordUndo: true },
    );
  }

  queueSize(): number {
    return this.getQueue().length;
  }

  isQueueEmpty(): boolean {
    return this.queueSize() === 0;
  }

  async stop(): Promise<void> {
    await this.disconnect();

    await this.enqueueOperation(
      () => {
        this.queuePosition = 0;
        this.queue = [];
        this.markQueueStateDirty();
      },
      { recordUndo: true },
    );

    await this.flushQueueState();
  }

  async move(from: number, to: number): Promise<QueuedSong> {
    if (from > this.queueSize() || to > this.queueSize()) {
      throw new Error("Move index is outside the range of the queue.");
    }

    return this.enqueueOperation(
      () => {
        const moved = this.queue.splice(this.queuePosition + from, 1)[0];

        this.queue.splice(this.queuePosition + to, 0, moved);
        this.markQueueStateDirty();
        return this.queue[this.queuePosition + to];
      },
      { recordUndo: true },
    );
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  async undo(): Promise<boolean> {
    const snapshot = this.undoStack.pop();

    if (!snapshot) {
      return false;
    }

    await this.enqueueOperation(() => {
      this.queue = snapshot.queue.map((song) => ({
        ...song,
        playlist: song.playlist ? { ...song.playlist } : null,
      }));
      this.queuePosition = snapshot.queuePosition;
      this.loopCurrentSong = snapshot.loopCurrentSong;
      this.loopCurrentQueue = snapshot.loopCurrentQueue;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
      this.nowPlaying = this.getCurrent();
      this.markQueueStateDirty();
    });

    await this.flushQueueState();
    return true;
  }

  setVolume(level: number): void {
    // Level should be a number between 0 and 100 = 0% => 100%
    this.volume = level;
    this.setAudioPlayerVolume(level);
  }

  getVolume(): number {
    // Only use default volume if player volume is not already set (in the event of a reconnect we shouldn't reset)
    return this.volume ?? this.defaultVolume;
  }

  private async getVideoInfoWithYtDlp(url: string): Promise<YtDlpResponse> {
    return new Promise((resolve, reject) => {
      const args: string[] = [
        "--dump-json",
        "--no-warnings",
      ];

      // Add cookies if configured - try browser first, then file
      if (this.config.YT_DLP_COOKIES_BROWSER) {
        args.push("--cookies-from-browser", this.config.YT_DLP_COOKIES_BROWSER);
        debug("Using cookies from browser:", this.config.YT_DLP_COOKIES_BROWSER);
      } else if (this.config.YT_DLP_COOKIES_FILE && fs.existsSync(this.config.YT_DLP_COOKIES_FILE)) {
        args.push("--cookies", this.config.YT_DLP_COOKIES_FILE);
        debug("Using cookies file:", this.config.YT_DLP_COOKIES_FILE);
      } else {
        debug("No cookies configured");
      }

      args.push(url);

      debug("yt-dlp args:", args);
      const ytDlp = spawn("yt-dlp", args);

      let stdout = "";
      let stderr = "";

      ytDlp.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      ytDlp.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      ytDlp.on("close", (code: number) => {
        if (code === 0) {
          try {
            const info = JSON.parse(stdout) as YtDlpResponse;
            resolve(info);
          } catch (parseError: unknown) {
            debug("Failed to parse yt-dlp JSON output:", parseError);
            reject(
              new Error(
                `Failed to parse yt-dlp JSON output: ${String(parseError)}`,
              ),
            );
          }
        } else {
          debug("yt-dlp failed with code:", code);
          debug("yt-dlp stderr:", stderr);
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
        }
      });

      ytDlp.on("error", (error: Error) => {
        debug("Failed to spawn yt-dlp:", error.message);
        reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
      });
    });
  }

  private extractVideoId(url: string): string {
    const regex =
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
    const match = regex.exec(url);
    return match?.[1] ?? url;
  }

  private async getYouTubeInfo(url: string): Promise<{
    formats: VideoFormat[];
    isLive: boolean;
    lengthSeconds: string;
  }> {
    const videoId = this.extractVideoId(url);

    // Construct full YouTube URL if we only have a video ID
    const fullUrl =
      url.includes("youtube.com") || url.includes("youtu.be")
        ? url
        : `https://www.youtube.com/watch?v=${videoId}`;

    const info = await this.getVideoInfoWithYtDlp(fullUrl);

    const formats: VideoFormat[] = (info.formats ?? []).map(
      (format: YtDlpFormat) => ({
        url: format.url ?? "",
        itag: format.format_id ?? "",
        codecs:
          format.acodec && format.acodec !== "none"
            ? format.acodec
            : (format.vcodec ?? ""),
        container: format.ext ?? "",
        audioSampleRate: format.asr?.toString(),
        averageBitrate: format.abr,
        bitrate: format.tbr,
        isLive: info.is_live ?? false,
        loudnessDb:
          typeof format.loudness_db === "number"
            ? format.loudness_db
            : undefined,
        httpHeaders: format.http_headers
          ? { ...format.http_headers }
          : undefined,
      }),
    );

    return {
      formats,
      isLive: info.is_live ?? false,
      lengthSeconds: info.duration?.toString() ?? "0",
    };
  }

  private getHashForCache(url: string): string {
    return hasha(url);
  }

  private async getFfmpegInput(
    song: QueuedSong,
    options?: { seek?: number },
  ): Promise<string | Readable> {
    if (song.source === MediaSource.HLS) {
      return this.createReadStream({
        url: song.url,
        cacheKey: song.url,
        cache: false,
      });
    }

    const hash = this.getHashForCache(song.url);
    const cachedPath = path.join(this.fileCache.cacheDir, hash);

    if (fs.existsSync(cachedPath)) {
      return cachedPath;
    }

    let ffmpegInput: string | Readable | null = null;

    // Not yet cached, must download
    const info = await this.getYouTubeInfo(song.url);

    const { formats } = info;

    // Look for the ideal format (opus codec, webm container, 48kHz)
    const filter = (format: VideoFormat): boolean =>
      format.codecs === "opus" &&
      format.container === "webm" &&
      format.audioSampleRate !== undefined &&
      parseInt(format.audioSampleRate, 10) === 48000 &&
      Boolean(format.url);

    let format = formats.find(filter);

    const nextBestFormat = (
      formats: VideoFormat[],
    ): VideoFormat | undefined => {
      if (formats.length < 1) {
        return undefined;
      }

      if (formats[0].isLive) {
        formats = formats.sort(
          (a, b) => (b.averageBitrate ?? 0) - (a.averageBitrate ?? 0),
        );

        return formats.find((format) =>
          [128, 127, 120, 96, 95, 94, 93].includes(
            parseInt(format.itag as string, 10),
          ),
        );
      }

      formats = formats
        .filter((format) => format.averageBitrate)
        .sort((a, b) => {
          if (a && b) {
            return b.averageBitrate! - a.averageBitrate!;
          }

          return 0;
        });
      return formats.find((format) => !format.bitrate) ?? formats[0];
    };

    if (!format) {
      format = nextBestFormat(info.formats);

      if (!format) {
        // If still no format is found, throw
        throw new Error("Can't find suitable format.");
      }
    }

    debug("Using format", format);

    if (!format.url || format.url.trim() === "") {
      throw new Error("Selected format has no valid URL");
    }

    ffmpegInput = format.url;

    // Don't cache livestreams or long videos
    const MAX_CACHE_LENGTH_SECONDS = 30 * 60; // 30 minutes
    const shouldCacheVideo =
      !info.isLive &&
      parseInt(info.lengthSeconds, 10) < MAX_CACHE_LENGTH_SECONDS &&
      options?.seek === undefined;

    debug(shouldCacheVideo ? "Caching video" : "Not caching video");

    const ffmpegInputOptions: string[] = [];

    if (options?.seek !== undefined) {
      ffmpegInputOptions.push("-ss", options.seek.toString());
    }

    return this.createReadStream({
      url: ffmpegInput,
      cacheKey: song.url,
      ffmpegInputOptions,
      cache: shouldCacheVideo,
      volumeAdjustment: format?.loudnessDb
        ? `${-format.loudnessDb}dB`
        : undefined,
      headers: format?.httpHeaders,
    });
  }

  private startTrackingPosition(initalPosition?: number): void {
    if (initalPosition !== undefined) {
      this.positionInSeconds = initalPosition;
    }

    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }

    this.playPositionInterval = setInterval(() => {
      this.positionInSeconds++;
    }, 1000);
  }

  private stopTrackingPosition(): void {
    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }
  }

  private attachListeners(): void {
    if (!this.voiceConnection) {
      return;
    }

    if (
      this.voiceConnection.listeners(VoiceConnectionStatus.Disconnected)
        .length === 0
    ) {
      this.voiceConnection.on(
        VoiceConnectionStatus.Disconnected,
        this.onVoiceConnectionDisconnect.bind(this),
      );
    }

    if (!this.audioPlayer) {
      return;
    }

    if (this.audioPlayer.listeners("stateChange").length === 0) {
      this.audioPlayer.on(
        AudioPlayerStatus.Idle,
        this.onAudioPlayerIdle.bind(this),
      );
    }

    // Add error handler for audio player
    if (this.audioPlayer.listeners("error").length === 0) {
      this.audioPlayer.on("error", (error: Error) => {
        debug(`Audio player error: ${formatError(error)}`);

        // Try to skip to next song on player error
        this.forward(1).catch((forwardError: unknown) => {
          debug(
            `Failed to skip after audio player error: ${formatError(forwardError)}`,
          );
          // If we can't skip, stop playback
          this.status = STATUS.IDLE;
          this.nowPlaying = null;
          this.stopTrackingPosition();
        });
      });
    }
  }

  private onVoiceConnectionDisconnect(): void {
    this.disconnect();
  }

  private async onAudioPlayerIdle(
    _oldState: AudioPlayerState,
    newState: AudioPlayerState,
  ): Promise<void> {
    // Automatically advance queued song at end
    if (
      this.loopCurrentSong &&
      newState.status === AudioPlayerStatus.Idle &&
      this.status === STATUS.PLAYING
    ) {
      await this.seek(0);
      return;
    }

    // Automatically re-add current song to queue
    if (
      this.loopCurrentQueue &&
      newState.status === AudioPlayerStatus.Idle &&
      this.status === STATUS.PLAYING
    ) {
      const currentSong = this.getCurrent();

      if (currentSong) {
        await this.add({ ...currentSong });
      } else {
        throw new Error("No song currently playing.");
      }
    }

    if (
      newState.status === AudioPlayerStatus.Idle &&
      this.status === STATUS.PLAYING
    ) {
      try {
        await this.forward(1);
        // Auto announce the next song if configured to
        const settings = await getGuildSettings(this.guildId);
        const { autoAnnounceNextSong } = settings;
        if (autoAnnounceNextSong && this.currentChannel) {
          await this.currentChannel.send({
            embeds: this.getCurrent() ? [buildPlayingMessageEmbed(this)] : [],
          });
        }
      } catch {
        // This happens when the queue is empty
        await this.enqueueOperation(() => {
          this.status = STATUS.IDLE;
          this.nowPlaying = null;
          this.stopTrackingPosition();
          this.audioPlayer?.stop(true);
          this.markQueueStateDirty();
        });

        const settings = await getGuildSettings(this.guildId);
        const { secondsToWaitAfterQueueEmpties } = settings;

        if (secondsToWaitAfterQueueEmpties !== 0) {
          this.disconnectTimer = setTimeout(() => {
            if (this.status === STATUS.IDLE) {
              void this.disconnect();
            }
          }, secondsToWaitAfterQueueEmpties * 1000);
        }
      }
    }
  }

  private async createReadStream(options: {
    url: string;
    cacheKey: string;
    ffmpegInputOptions?: string[];
    cache?: boolean;
    volumeAdjustment?: string;
    headers?: Record<string, string>;
  }): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const capacitor = new WriteStream();
      let hasResolved = false;
      let ffmpegProcess: any = null;

      // Handle capacitor errors
      capacitor.on("error", (error: Error) => {
        debug(`Capacitor error: ${formatError(error)}`);
        if (!hasResolved) {
          hasResolved = true;
          reject(error);
        }
        if (ffmpegProcess) {
          try {
            ffmpegProcess.kill("SIGKILL");
          } catch (e) {
            debug(`Error killing ffmpeg process: ${formatError(e)}`);
          }
        }
      });

      if (options?.cache) {
        const cacheStream = this.fileCache.createWriteStream(
          this.getHashForCache(options.cacheKey),
        );

        // Handle cache stream errors
        cacheStream.on("error", (error: Error) => {
          debug(`Cache stream error: ${formatError(error)}`);
          // Don't reject, just log - caching is optional
        });

        capacitor.createReadStream().pipe(cacheStream);
      }

      const returnedStream = capacitor.createReadStream();
      let hasReturnedStreamClosed = false;

      // Handle returned stream errors
      returnedStream.on("error", (error: Error) => {
        debug(`Returned stream error: ${formatError(error)}`);
        if (!hasResolved) {
          hasResolved = true;
          reject(error);
        }
        if (ffmpegProcess) {
          try {
            ffmpegProcess.kill("SIGKILL");
          } catch (e) {
            debug(`Error killing ffmpeg process: ${formatError(e)}`);
          }
        }
      });

      const inputOptions = [...(options.ffmpegInputOptions ?? ["-re"])];

      if (options.headers && Object.keys(options.headers).length > 0) {
        const headerLines = Object.entries(options.headers)
          .map(([name, value]) => `${name}: ${value}`)
          .join("\r\n");

        inputOptions.push("-headers", `${headerLines}\r\n`);

        if (options.headers["User-Agent"]) {
          inputOptions.push("-user_agent", options.headers["User-Agent"]);
        }
      }

      const stream = ffmpeg(options.url)
        .inputOptions(inputOptions)
        .noVideo()
        .audioCodec("libopus")
        .outputFormat("webm")
        .addOutputOption([
          "-filter:a",
          `volume=${options?.volumeAdjustment ?? "1"}`,
        ])
        .on("error", (error: Error) => {
          const errorMessage = `FFmpeg error while processing ${
            options.url
          }: ${formatError(error)}`;
          debug(errorMessage);
          console.error(errorMessage);

          // Clean up streams
          try {
            capacitor.destroy();
            returnedStream.destroy();
          } catch (cleanupError) {
            debug(`Error during cleanup: ${formatError(cleanupError)}`);
          }

          // Always reject if we haven't resolved yet
          if (!hasResolved) {
            hasResolved = true;
            reject(new Error(errorMessage));
          }
        })
        .on("start", (command) => {
          debug(`Spawned ffmpeg with ${command}`);
        })
        .on("end", () => {
          debug("FFmpeg process ended normally");
        })
        .on("exit", (code: number, signal: string) => {
          debug(`FFmpeg exited with code ${code} and signal ${signal}`);

          // If exit was abnormal and we haven't resolved, reject
          if (
            code !== 0 &&
            code !== null &&
            !hasResolved &&
            !hasReturnedStreamClosed
          ) {
            hasResolved = true;
            const errorMessage = `FFmpeg exited with code ${code} while processing ${options.url}`;
            console.error(errorMessage);
            const error = new Error(errorMessage);
            reject(error);
          }
        });

      ffmpegProcess = stream;
      stream.pipe(capacitor);

      returnedStream.on("close", () => {
        debug("Returned stream closed");
        if (!options.cache && ffmpegProcess) {
          try {
            ffmpegProcess.kill("SIGKILL");
          } catch (e) {
            debug(`Error killing ffmpeg process: ${formatError(e)}`);
          }
        }

        hasReturnedStreamClosed = true;
      });

      // Resolve immediately with the stream
      // The stream will handle errors asynchronously
      hasResolved = true;
      resolve(returnedStream);
    });
  }

  private createAudioStream(stream: string | Readable) {
    const resolvedStream =
      typeof stream === "string" ? fs.createReadStream(stream) : stream;

    // Add error handler for the resolved stream
    resolvedStream.on("error", (error: Error) => {
      debug(`Audio stream error: ${formatError(error)}`);
      // Stream errors will be caught by the audio player error handler
    });

    const audioResource = createAudioResource(resolvedStream, {
      inputType: StreamType.WebmOpus,
      inlineVolume: true,
    });

    // Add error handler for metadata if available
    if (audioResource.metadata) {
      audioResource.metadata.on?.("error", (error: Error) => {
        debug(`Audio resource metadata error: ${formatError(error)}`);
      });
    }

    return audioResource;
  }

  private playAudioPlayerResource(resource: AudioResource) {
    if (this.audioPlayer !== null) {
      this.audioResource = resource;
      this.setAudioPlayerVolume();
      this.audioPlayer.play(this.audioResource);
    }
  }

  private setAudioPlayerVolume(level?: number) {
    // Audio resource expects a float between 0 and 1 to represent level percentage
    this.audioResource?.volume?.setVolume((level ?? this.getVolume()) / 100);
  }
}
