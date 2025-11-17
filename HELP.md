# 🎵 Mu100% Bot Commands

Complete reference for all available commands.

## Getting Started

Most commands require you to be in a voice channel. Use prefix commands with `!` (or your server's prefix). Slash commands (`/`) are shown only where prefix isn't available.

## Playback Commands

### `!play` (aliases: `!p`)
**Description**: Play a song, playlist, or search for music

**Flags**:
- `--now` - Add track to the front of the queue
- `--shuffle` - Shuffle the input if adding multiple tracks
- `--skip` - Skip the currently playing track
- `--at=position` - Insert at a specific position
- `--priority=number` - Set priority level (1-10)

**Examples**:
```
!play Rick Astley - Never Gonna Give You Up
!play https://youtube.com/watch?v=dQw4w9WgXcQ --now
!play My Playlist --shuffle --skip
!pa 3 Never Gonna Give You Up  # play at position 3
!insert Song Title  # same as --now
```

### `!resume` (aliases: `!res`)
**Description**: Resume paused playback

### `!pause` (aliases: `!pau`)
**Description**: Pause the current song

### `!stop` (aliases: `!st`)
**Description**: Stop playback, disconnect, and clear all songs in the queue

### `!join` (aliases: `!j`)
**Description**: Join your voice channel

### `!skip` (aliases: `!s`, `!next`)
**Description**: Skip to the next song in the queue

**Examples**:
```
!skip
!skip 5
```

## Queue Management

### `!queue` (aliases: `!q`)
**Description**: Display the current queue

### `!jump` (aliases: `!j`, `!previous`, `!prev`)
**Description**: Jump to a specific position in the queue

**Examples**:
```
!jump 5
!jump next
!jump last
!previous  # jumps to current-1
```

### `!move` (aliases: `!m`)
**Description**: Move songs within the queue

**Examples**:
```
!move 3 1
```

### `!remove` (aliases: `!rm`)
**Description**: Remove songs from the queue

**Examples**:
```
!remove 3
```

### `!shuffle` (aliases: `!sh`)
**Description**: Randomize the order of songs in the queue

### `!clear` (aliases: `!cl`)
**Description**: Clear all songs from the queue

### `!remove-duplicates` (aliases: `!dedupe`, `!dedup`, `!rmd`)
**Description**: Remove duplicate songs from the queue

### `!reset-priorities`
**Description**: Reset all song priorities to default

## Playback Control

### `!volume` (aliases: `!vol`)
**Description**: Set the playback volume

**Examples**:
```
!volume 75
!volume 50
```

### `!seek` (aliases: `!se`)
**Description**: Seek to a specific position in the current song

**Examples**:
```
!seek 1m30s
!seek 90
```

### `!fseek` (aliases: `!fs`)
**Description**: Seek forward by a specified amount

**Examples**:
```
!fseek 30s
!fseek 1m
```

### `!loop` (aliases: `!l`)
**Description**: Toggle looping the current song

### `!loop-queue` (aliases: `!lq`)
**Description**: Toggle looping the entire queue

### `!unskip` (aliases: `!us`)
**Description**: Go back to the previous song

### `!replay` (aliases: `!re`)
**Description**: Restart the current song from the beginning

### `!now-playing` (aliases: `!np`)
**Description**: Display information about the currently playing song

## Configuration

### `!config`
**Description**: Configure bot settings (requires Manage Server permission)

**Available Commands**:
- `!config get` - View current settings
- `!config set-prefix <new-prefix>` - Change command prefix

**Note**: Most config options are slash-only. Use `/config` for advanced settings.

## Favorites System

Mu has two different favorites systems:

### `!like` (aliases: `!fav`, `!.f`)
**Description**: Save the current song or a song from the queue as a personal favorite

**Examples**:
```
!fav  # saves current song
!fav next  # saves next song in queue
```

### `!play-favorites` (aliases: `!pf`)
**Description**: Play all your personal favorites from the like command

**Examples**:
```
!pf
```

### `/favorites` (slash-only)
**Description**: Create and manage named favorites with custom queries

**Note**: This is a different system from `!fav` - use `/favorites` for advanced named favorites.

## Tagging (User-level)

Tag songs with your own labels and play them later. Tags are personal to you (not server-wide).

### `!tag` 
**Description**: Tag a song under a given tag name

**Usage**:
```
!tag <tag-name> [position]
```

**Examples**:
```
!tag gym           # tags the current song as "gym"
!tag chill next    # tags the next queued song as "chill"
!tag commute 5     # tags song at position 5 as "commute"
```

### `!tags`
**Description**: Show your tags or play songs for a tag

**Subcommands**:
- `!tags` or `!tags show` — list your tags and how many songs each has
- `!tags play <tag-name>` — add all songs from the tag to the queue

**Examples**:
```
!tags
!tags show
!tags play gym
```

## Utility Commands

### `!help` (aliases: `!h`)
**Description**: Display all available commands

### `!disconnect` (aliases: `!dc`, `!leave`)
**Description**: Disconnect from the voice channel

### `!undo` (aliases: `!u`)
**Description**: Undo the last queue modification

### `!next-batch` (aliases: `!nb`)
**Description**: Display the next batch of songs in the queue

## Command Syntax

### Prefix Commands (Primary)
```
!command-name value
!command-name --flag
!command-name --flag=value
!command-name value1 value2
```

### Slash Commands (Secondary)
Use `/` only where prefix commands aren't available.

### Command Flags
For `!play`, these flags are available:
- `--now` - Add track to the front of the queue
- `--shuffle` - Shuffle the input if adding multiple tracks
- `--skip` - Skip the currently playing track
- `--at=position` - Insert at a specific position
- `--priority=number` - Set priority level

### Command Aliases
- `!p` = `!play`
- `!s` = `!skip` 
- `!q` = `!queue`
- `!j` = `!jump` or `!join`
- `!m` = `!move`
- `!rm` = `!remove`
- `!vol` = `!volume`
- `!np` = `!now-playing`
- `!prev` = `!previous` (jumps to current-1)
- `!insert` or `!i` = `!play --now`
- `!pa` or `!playat` = `!play --at=position`
- `!fav` = `!like` (save current song as favorite)
- `!pf` = `!play-favorites` (play all saved favorites)
- `!dedupe` = `!remove-duplicates`

### Position Arguments
Many commands accept flexible position arguments:
- **Numbers**: `1`, `5`, `10`
- **Keywords**: `top`, `current`, `next`, `last`
- **With Offsets**: `current+2`, `next-1`, `last-3`, `top+1`

### Time Arguments
Time values can be specified in multiple formats:
- **Seconds**: `90`, `120`
- **Minutes**: `1m`, `2m30s`
- **Hours**: `1h`, `1h30m`
- **Colon format**: `1:30`, `2:15:30`

## Tips & Tricks

### **Queue Management**
- `!jump next` - skip to next song
- `!move 5 1` - move song 5 to front
- `!remove 3` - remove song at position 3

### **Playback Control**
- `!fseek 30s` - skip forward 30 seconds
- `!volume 75` - set volume to 75%
- `!unskip` - go back to previous song

### **Advanced Features**
- `--now` or `!insert` - play song immediately
- `--shuffle` - randomize playlist when adding
- `--at=3` - insert song at specific position
- `!pa 5 Song Title` - shortcut for `--at=5`

## Troubleshooting

**"not connected"** - Make sure you're in a voice channel
**"nothing is playing"** - Start playing a song first with `/play`
**"no song to go back to"** - Use `/jump` to navigate instead of `/unskip`
**Commands not working** - Check prefix, permissions, or try slash commands

Use `/help` to see all available commands.
