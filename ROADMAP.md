# Project Roadmap: Muse Bot Enhancements

This document outlines the progress made on recent feature requests and the plan for upcoming work.

## Completed Features

### 1. Enhanced Prefix Command Handling
-   **General Infrastructure:**
    -   **`Command` Interface (`src/commands/index.ts`):**
        -   Modified `executePrefix` method signature to `executePrefix?: (message: Message, args: string[], prefix: string) => Promise<void>;` to pass the guild-specific prefix.
    -   **`Bot` Class (`src/bot.ts`):**
        -   **Imported `getGuildSettings`** from `../utils/get-guild-settings.js` to retrieve guild settings.
        -   **Modified `messageCreate` handler:**
            -   Now retrieves guild-specific `prefix` using `getGuildSettings`.
            -   Parses `commandName` and `args` from the message content.
            -   Resolves commands by `slashCommand.name` or by checking `command.aliases`.
            -   Calls `command.executePrefix(message, args, prefix)` passing the determined prefix.
        -   **Debugging:** Replaced `debug()` calls with `console.log()` in `messageCreate` handler for direct output visibility.
    -   **`inversify.config.ts`:**
        -   **Added Discord Gateway Intents:** `GatewayIntentBits.GuildMessages` and `GatewayIntentBits.MessageContent` were added to the client initialization to enable message processing.
    -   **Debugging Resolution:** Fixed `ReferenceError: getGuildSettings is not defined` by adding the import. Resolved "Used disallowed intents" error by enabling `Message Content Intent` in Discord Developer Portal.

### 2. `play` Command Aliases & Flags
-   **`Play` Command (`src/commands/play.ts`):**
    -   **Injected `Config`:** `private readonly config: Config;` was added and injected into the constructor to access `this.config.PREFIX`.
    -   **Added `aliases` property:** `public readonly aliases = ['p', 'insert', 'i'];`
    -   **Implemented `executePrefix(message, args, prefix)`:**
        -   Parses `query` and flags (`--now`, `--shuffle`, `--skip`) from `args`.
        -   Handles `insert`/`i` aliases by checking `message.content.slice(prefix.length).trim().split(/ +/)[0]?.toLowerCase()` to set `immediate=true`.
        -   Constructs a mock `ChatInputCommandInteraction` with parsed options.
        -   Calls `this.execute(mockInteraction)` to reuse existing slash command logic.

### 3. `skip` Command Aliases
-   **`Skip` Command (`src/commands/skip.ts`):**
    -   **Added `aliases` property:** `public readonly aliases = ['s'];`
    -   **Implemented `executePrefix(message, args, prefix)`:**
        -   Parses `numToSkip` from `args[0]` (defaults to 1).
        -   Constructs a mock `ChatInputCommandInteraction` with the `number` option.
        -   Calls `this.execute(mockInteraction)`.

### 4. `clear` Command Aliases
-   **`Clear` Command (`src/commands/clear.ts`):**
    -   **Added `aliases` property:** `public readonly aliases = ['c'];`
    -   **Implemented `executePrefix(message, args, prefix)`:**
        -   Constructs a mock `ChatInputCommandInteraction` (no arguments needed).
        -   Calls `this.execute(mockInteraction)`.

### 5. `shuffle` Command with `--upcoming` Flag
-   **`Shuffle` Command (`src/commands/shuffle.ts`):**
    -   **Modified `slashCommand`:** Added a boolean option for `--upcoming` (`.addBooleanOption(option => option.setName('upcoming').setDescription('...'))`).
    -   **Implemented `executePrefix(message, args, prefix)`:**
        -   Parses `--upcoming` flag from `args`.
        -   Constructs a mock `ChatInputCommandInteraction` with the `upcoming` option.
        -   Calls `this.execute(mockInteraction)`.
    -   **Modified `execute(interaction)`:** Retrieves `upcomingOnly = interaction.options.getBoolean('upcoming') ?? false;` and passes it to `player.shuffle(upcomingOnly)`.
-   **`Player` Class (`src/services/player.ts`):**
    -   **Modified `shuffle(upcomingOnly = false): void` method:**
        -   Now accepts `upcomingOnly` boolean.
        -   If `upcomingOnly` is true, shuffles `this.queue.slice(this.queuePosition + 1)`.
        -   If `upcomingOnly` is false, shuffles the entire queue *excluding* the current song and resets `this.queuePosition` to 0.

### 6. `move` Command with Expanded Position Parsing
-   **`Move` Command (`src/commands/move.ts`):**
    -   **Modified `slashCommand`:** Changed both `from` and `to` options from `addIntegerOption` to `addStringOption` to accept keywords and offsets.
    -   **Added `private parsePositionArgument(arg: string, player: Player): number` helper method:**
        -   Parses a string argument (e.g., "top", "next+3", "5-1") into a 1-based numerical position.
        -   Handles keywords: `top` (1), `current` (`player.queuePosition + 1`), `next` (`player.queuePosition + 2`), `last` (`player.queue.length`).
        -   Parses `+N`/`-N` offsets.
        -   Ensures final position is within `1` and `queueLength`.
        -   Throws `Error` for invalid input.
    -   **Modified `executePrefix(message, args, prefix)`:**
        -   Uses `parsePositionArgument` for both `args[0]` (from) and `args[1]` (to).
        -   Constructs a mock `ChatInputCommandInteraction` and calls `this.execute(mockInteraction)`.
    -   **Modified `execute(interaction)`:**
        -   Retrieves `fromArg = interaction.options.getString('from')!` and `toArg = interaction.options.getString('to')!`.
        -   Uses `parsePositionArgument` for both `fromArg` and `toArg`.
        -   Passes the resulting numerical `from` and `to` to `player.move(from, to)`.

### 7. Fetch All Songs from APIs
-   **`src/services/youtube-api.ts`:**
    -   **Modified `getPlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]>`:**
        -   Removed `playlistLimit` parameter from signature.
        -   Implemented fetching of *all* playlist items up to `HARD_PLAYLIST_FETCH_LIMIT = 5000`.
        -   The `while` loop condition now includes `playlistVideos.length < HARD_PLAYLIST_FETCH_LIMIT`.
        -   Removed the `limitedPlaylistVideos` slicing logic.
-   **`src/services/spotify-api.ts`:**
    -   **Added `const HARD_PLAYLIST_FETCH_LIMIT = 5000;`**
    -   **Modified `getAlbum(url: string): Promise<[SpotifyTrack[], QueuedPlaylist]>`:**
        -   Removed `playlistLimit` parameter.
        -   Removed `this.limitTracks` call, now returns all fetched tracks.
    -   **Modified `getPlaylist(url: string): Promise<[SpotifyTrack[], QueuedPlaylist]>`:**
        -   Removed `playlistLimit` parameter.
        -   The `while` loop condition now includes `items.length < HARD_PLAYLIST_FETCH_LIMIT`.
        -   Removed `this.limitTracks` call, now returns all fetched tracks (sliced to `HARD_PLAYLIST_FETCH_LIMIT`).
    -   **Modified `getArtist(url: string): Promise<SpotifyTrack[]>`:**
        -   Removed `playlistLimit` parameter.
        -   Removed `this.limitTracks` call, now returns all fetched tracks (sliced to `HARD_PLAYLIST_FETCH_LIMIT`).
    -   **Removed `private limitTracks(...)` helper method.**

### 8. Adjust `get-songs` Service
-   **`src/services/get-songs.ts`:**
    -   **Modified `getSongs(query: string, _playlistLimit: number, shouldSplitChapters: boolean): Promise<[SongMetadata[], string]>`:**
        -   Renamed `playlistLimit` parameter to `_playlistLimit` (to mark as unused).
        -   Removed `playlistLimit` from calls to `this.youtubePlaylist` and `this.spotifySource`.
        -   Removed `extraMsg` logic related to `playlistLimit` (as limit is now applied at queuing stage).
    -   **Modified `private async youtubePlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]>`:**
        -   Removed `playlistLimit` parameter from signature.
    -   **Modified `private async spotifySource(url: string, shouldSplitChapters: boolean): Promise<[SongMetadata[], number, number]>`:**
        -   Removed `playlistLimit` parameter from signature.
        -   Removed `playlistLimit` from calls to `this.spotifyAPI.getAlbum`, `getPlaylist`, `getArtist`.

### 9. Player Class Playlist Storage
-   **`Player` Class (`src/services/player.ts`):**
    -   **Added `export interface FullPlaylist { ... }`:** Defines structure for stored playlists.
    -   **Added `private fullPlaylists: Map<string, FullPlaylist> = new Map();`** property.
    -   **Added `storeFullPlaylist(playlistId: string, songs: SongMetadata[]): void` method:** Stores a full playlist.
    -   **Added `getStoredPlaylist(playlistId: string): FullPlaylist | undefined` method:** Retrieves a stored playlist, handling 15-minute expiration.
    -   **Added `addNextBatch(playlistId: string, count: number): SongMetadata[]` method:** Adds a batch of songs from a stored playlist to the active queue, updates `addedCount`, and refreshes timestamp.
    -   **Imported `ONE_MINUTE_IN_SECONDS`** from `../utils/constants.js`.
    -   **Added `getStoredPlaylistIds(): string[]` method:** Returns IDs of non-expired stored playlists.
    -   **Added `getStoredPlaylistTitles(): {id: string, title: string}[]` method:** Returns IDs and titles for autocomplete.

### 10. `AddQueryToQueue` Refactoring
-   **`src/services/add-query-to-queue.ts`:**
    -   **Imported `QueuedSong`, `Player`** from `./player.js`.
    -   **Modified `addToQueue` method:**
        -   Calls `this.getSongs.getSongs(query, _playlistLimit, shouldSplitChapters)` (where `_playlistLimit` is now unused).
        -   If fetched songs are a playlist:
            -   Calls `player.storeFullPlaylist(playlistId, fetchedSongs)`.
            -   Takes the first `playlistLimit` songs for initial queuing.
            -   Updates `storedPlaylist.addedCount` and `timestamp`.
            -   Updates `extraMsg` to inform the user about the stored playlist and how to add more.
        -   Otherwise, queues all fetched songs directly.

### 11. New `next-batch` Command
-   **`NextBatchCommand` (`src/commands/next-batch.ts`):**
    -   **Created new command file.**
    -   **Slash Command Definition:** Includes `count` (integer) and `playlist` (string, autocomplete enabled) options.
    -   **Implemented `handleAutocompleteInteraction`:** Suggests stored playlist titles using `player.getStoredPlaylistTitles()`.
    -   **Implemented `handleCommand(interaction, count, playlistIdArg)`:**
        -   Determines `targetPlaylistId` (from `playlistIdArg`, infers if only one stored, or prompts if multiple).
        -   Retrieves `storedPlaylist` using `player.getStoredPlaylist()`.
        -   Calls `player.addNextBatch()` to add songs.
        -   Provides user feedback on added songs and remaining songs.
    -   **Implemented `execute(interaction)`:** Retrieves `count` and `playlistId` from slash command options, calls `handleCommand`.
    -   **Implemented `executePrefix(message, args, prefix)`:** Parses `count` from `args[0]` and `playlistId` from `args[1]`, calls `handleCommand`.

## Completed Features

### 1. Enhanced Prefix Command Handling
-   **General Infrastructure:**
    -   **`Command` Interface (`src/commands/index.ts`):**
        -   Modified `executePrefix` method signature to `executePrefix?: (message: Message, args: string[], prefix: string) => Promise<void>;` to pass the guild-specific prefix.
    -   **`Bot` Class (`src/bot.ts`):**
        -   **Imported `getGuildSettings`** from `../utils/get-guild-settings.js` to retrieve guild settings.
        -   **Modified `messageCreate` handler:**
            -   Now retrieves guild-specific `prefix` using `getGuildSettings`.
            -   Parses `commandName` and `args` from the message content.
            -   Resolves commands by `slashCommand.name` or by checking `command.aliases`.
            -   Calls `command.executePrefix(message, args, prefix)` passing the determined prefix.
        -   **Debugging:** Replaced `debug()` calls with `console.log()` in `messageCreate` handler for direct output visibility.
    -   **`inversify.config.ts`:**
        -   **Added Discord Gateway Intents:** `GatewayIntentBits.GuildMessages` and `GatewayIntentBits.MessageContent` were added to the client initialization to enable message processing.
    -   **Debugging Resolution:** Fixed `ReferenceError: getGuildSettings is not defined` by adding the import. Resolved "Used disallowed intents" error by enabling `Message Content Intent` in Discord Developer Portal.

### 2. `play` Command Aliases & Flags
-   **`Play` Command (`src/commands/play.ts`):**
    -   **Injected `Config`:** `private readonly config: Config;` was added and injected into the constructor to access `this.config.PREFIX`.
    -   **Added `aliases` property:** `public readonly aliases = ['p', 'insert', 'i'];`
    -   **Implemented `executePrefix(message, args, prefix)`:**
        -   Parses `query` and flags (`--now`, `--shuffle`, `--skip`) from `args`.
        -   Handles `insert`/`i` aliases by checking `message.content.slice(prefix.length).trim().split(/ +/)[0]?.toLowerCase()` to set `immediate=true`.
        -   Constructs a mock `ChatInputCommandInteraction` with parsed options.
        -   Calls `this.execute(mockInteraction)` to reuse existing slash command logic.

### 3. `skip` Command Aliases
-   **`Skip` Command (`src/commands/skip.ts`):**
    -   **Added `aliases` property:** `public readonly aliases = ['s'];`
    -   **Implemented `executePrefix(message, args, prefix)`:**
        -   Parses `numToSkip` from `args[0]` (defaults to 1).
        -   Constructs a mock `ChatInputCommandInteraction` with the `number` option.
        -   Calls `this.execute(mockInteraction)`.

### 4. `clear` Command Aliases
-   **`Clear` Command (`src/commands/clear.ts`):**
    -   **Added `aliases` property:** `public readonly aliases = ['c'];`
    -   **Implemented `executePrefix(message, args, prefix)`:**
        -   Constructs a mock `ChatInputCommandInteraction` (no arguments needed).
        -   Calls `this.execute(mockInteraction)`.

### 5. `shuffle` Command with `--upcoming` Flag
-   **`Shuffle` Command (`src/commands/shuffle.ts`):**
    -   **Modified `slashCommand`:** Added a boolean option for `--upcoming` (`.addBooleanOption(option => option.setName('upcoming').setDescription('...'))`).
    -   **Implemented `executePrefix(message, args, prefix)`:**
        -   Parses `--upcoming` flag from `args`.
        -   Constructs a mock `ChatInputCommandInteraction` with the `upcoming` option.
        -   Calls `this.execute(mockInteraction)`.
    -   **Modified `execute(interaction)`:** Retrieves `upcomingOnly = interaction.options.getBoolean('upcoming') ?? false;` and passes it to `player.shuffle(upcomingOnly)`.
-   **`Player` Class (`src/services/player.ts`):**
    -   **Modified `shuffle(upcomingOnly = false): void` method:**
        -   Now accepts `upcomingOnly` boolean.
        -   If `upcomingOnly` is true, shuffles `this.queue.slice(this.queuePosition + 1)`.
        -   If `upcomingOnly` is false, shuffles the entire queue *excluding* the current song and resets `this.queuePosition` to 0.

### 6. `move` Command with Expanded Position Parsing
-   **`Move` Command (`src/commands/move.ts`):**
    -   **Modified `slashCommand`:** Changed both `from` and `to` options from `addIntegerOption` to `addStringOption` to accept keywords and offsets.
    -   **Added `private parsePositionArgument(arg: string, player: Player): number` helper method:**
        -   Parses a string argument (e.g., "top", "next+3", "5-1") into a 1-based numerical position.
        -   Handles keywords: `top` (1), `current` (`player.queuePosition + 1`), `next` (`player.queuePosition + 2`), `last` (`player.queue.length`).
        -   Parses `+N`/`-N` offsets.
        -   Ensures final position is within `1` and `queueLength`.
        -   Throws `Error` for invalid input.
    -   **Modified `executePrefix(message, args, prefix)`:**
        -   Uses `parsePositionArgument` for both `args[0]` (from) and `args[1]` (to).
        -   Constructs a mock `ChatInputCommandInteraction` and calls `this.execute(mockInteraction)`.
    -   **Modified `execute(interaction)`:**
        -   Retrieves `fromArg = interaction.options.getString('from')!` and `toArg = interaction.options.getString('to')!`.
        -   Uses `parsePositionArgument` for both `fromArg` and `toArg`.
        -   Passes the resulting numerical `from` and `to` to `player.move(from, to)`.

### 7. Fetch All Songs from APIs
-   **`src/services/youtube-api.ts`:**
    -   **Modified `getPlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]>`:**
        -   Removed `playlistLimit` parameter from signature.
        -   Implemented fetching of *all* playlist items up to `HARD_PLAYLIST_FETCH_LIMIT = 5000`.
        -   The `while` loop condition now includes `playlistVideos.length < HARD_PLAYLIST_FETCH_LIMIT`.
        -   Removed the `limitedPlaylistVideos` slicing logic.
-   **`src/services/spotify-api.ts`:**
    -   **Added `const HARD_PLAYLIST_FETCH_LIMIT = 5000;`**
    -   **Modified `getAlbum(url: string): Promise<[SpotifyTrack[], QueuedPlaylist]>`:**
        -   Removed `playlistLimit` parameter.
        -   Removed `this.limitTracks` call, now returns all fetched tracks.
    -   **Modified `getPlaylist(url: string): Promise<[SpotifyTrack[], QueuedPlaylist]>`:**
        -   Removed `playlistLimit` parameter.
        -   The `while` loop condition now includes `items.length < HARD_PLAYLIST_FETCH_LIMIT`.
        -   Removed `this.limitTracks` call, now returns all fetched tracks (sliced to `HARD_PLAYLIST_FETCH_LIMIT`).
    -   **Modified `getArtist(url: string): Promise<SpotifyTrack[]>`:**
        -   Removed `playlistLimit` parameter.
        -   Removed `this.limitTracks` call, now returns all fetched tracks (sliced to `HARD_PLAYLIST_FETCH_LIMIT`).
    -   **Removed `private limitTracks(...)` helper method.**

### 8. Adjust `get-songs` Service
-   **`src/services/get-songs.ts`:**
    -   **Modified `getSongs(query: string, _playlistLimit: number, shouldSplitChapters: boolean): Promise<[SongMetadata[], string]>`:**
        -   Renamed `playlistLimit` parameter to `_playlistLimit` (to mark as unused).
        -   Removed `playlistLimit` from calls to `this.youtubePlaylist` and `this.spotifySource`.
        -   Removed `extraMsg` logic related to `playlistLimit` (as limit is now applied at queuing stage).
    -   **Modified `private async youtubePlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]>`:**
        -   Removed `playlistLimit` parameter from signature.
    -   **Modified `private async spotifySource(url: string, shouldSplitChapters: boolean): Promise<[SongMetadata[], number, number]>`:**
        -   Removed `playlistLimit` parameter from signature.
        -   Removed `playlistLimit` from calls to `this.spotifyAPI.getAlbum`, `getPlaylist`, `getArtist`.

### 9. Player Class Playlist Storage
-   **`Player` Class (`src/services/player.ts`):**
    -   **Added `export interface FullPlaylist { ... }`:** Defines structure for stored playlists.
    -   **Added `private fullPlaylists: Map<string, FullPlaylist> = new Map();`** property.
    -   **Added `storeFullPlaylist(playlistId: string, songs: SongMetadata[]): void` method:** Stores a full playlist.
    -   **Added `getStoredPlaylist(playlistId: string): FullPlaylist | undefined` method:** Retrieves a stored playlist, handling 15-minute expiration.
    -   **Added `addNextBatch(playlistId: string, count: number): SongMetadata[]` method:** Adds a batch of songs from a stored playlist to the active queue, updates `addedCount`, and refreshes timestamp.
    -   **Imported `ONE_MINUTE_IN_SECONDS`** from `../utils/constants.js`.
    -   **Added `getStoredPlaylistIds(): string[]` method:** Returns IDs of non-expired stored playlists.
    -   **Added `getStoredPlaylistTitles(): {id: string, title: string}[]` method:** Returns IDs and titles for autocomplete.

### 10. `AddQueryToQueue` Refactoring
-   **`src/services/add-query-to-queue.ts`:**
    -   **Imported `QueuedSong`, `Player`** from `./player.js`.
    -   **Modified `addToQueue` method:**
        -   Calls `this.getSongs.getSongs(query, _playlistLimit, shouldSplitChapters)` (where `_playlistLimit` is now unused).
        -   If fetched songs are a playlist:
            -   Calls `player.storeFullPlaylist(playlistId, fetchedSongs)`.
            -   Takes the first `playlistLimit` songs for initial queuing.
            -   Updates `storedPlaylist.addedCount` and `timestamp`.
            -   Updates `extraMsg` to inform the user about the stored playlist and how to add more.
        -   Otherwise, queues all fetched songs directly.

### 11. New `next-batch` Command
-   **`NextBatchCommand` (`src/commands/next-batch.ts`):**
    -   **Created new command file.**
    -   **Slash Command Definition:** Includes `count` (integer) and `playlist` (string, autocomplete enabled) options.
    -   **Implemented `handleAutocompleteInteraction`:** Suggests stored playlist titles using `player.getStoredPlaylistTitles()`.
    -   **Implemented `handleCommand(interaction, count, playlistIdArg)`:**
        -   Determines `targetPlaylistId` (from `playlistIdArg`, infers if only one stored, or prompts if multiple).
        -   Retrieves `storedPlaylist` using `player.getStoredPlaylist()`.
        -   Calls `player.addNextBatch()` to add songs.
        -   Provides user feedback on added songs and remaining songs.
    -   **Implemented `execute(interaction)`:** Retrieves `count` and `playlistId` from slash command options, calls `handleCommand`.
    -   **Implemented `executePrefix(message, args, prefix)`:** Parses `count` from `args[0]` and `playlistId` from `args[1]`, calls `handleCommand`.

### 12. `queue` Command Enhancements
-   **`queue` Command (`src/commands/queue.ts`):**
    -   **Implemented `list` subcommand:** Lists all saved playlists for the current server.
    -   **Implemented `delete` subcommand:** Deletes a saved playlist by name.
    -   **Implemented `load` subcommand:** Loads a saved playlist and adds its songs to the queue.
    -   **Implemented `export` subcommand:** Exports a saved playlist as a JSON file.
    -   **Implemented `import` subcommand:** Imports a playlist from an attached JSON file (slash command only).
    -   **Modified `show` subcommand:**
        -   `page` option now accepts `top`, `current`, and `last` as string values.
        -   Default page is now `current`.
    -   **Added `q` alias:** The `queue` command can now be invoked using `q` as a prefix command.
    -   **Refactored `executeLoad`:** Improved efficiency by using a new `addMany` method in the `Player` class.
-   **`Player` Class (`src/services/player.ts`):**
    -   **Added `addMany(songs: QueuedSong[]): void` method:** Adds multiple songs to the queue.
