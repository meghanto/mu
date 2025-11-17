# Bucket Mode Specification

## Overview

Bucket Mode is an advanced queue management system that allows users to organize songs into separate "buckets" (categories/playlists) and control how those buckets are played back. This transforms the bot from a simple linear queue into a flexible DJ mixing board.

## Core Concepts

### What is a Bucket?

A bucket is a named container for songs within the queue. Think of it as a sub-queue or category.

- **Default Bucket**: All songs go here by default if no bucket is specified
- **Named Buckets**: Users can create custom buckets with any name
- **Lifecycle**: Buckets follow the queue lifecycle - they persist per-guild and are saved with queue state

### Visibility & Permissions

- All buckets are **public** - anyone can see and add to any bucket
- No special permissions needed to create or manage buckets

## Basic Commands

### Adding Songs to Buckets

```
!play <song>                           # Adds to default bucket (or user's bucket if in rotation)
!play <song> --bucket=<name>           # Adds to specific bucket
!play <song> --bucket=hype             # Example: add to "hype" bucket
```

**Smart Bucket Assignment:**
When adding a song during multi-bucket playback:
1. If user already has a bucket in the current rotation → song goes there
2. If user doesn't have a bucket in rotation → song goes to active bucket
3. If you want different behavior, specify `--bucket=<name>` explicitly

### Viewing Buckets

```
!q                                     # Shows default bucket queue (current behavior)
!q --bucket=<name>                     # Shows specific bucket's queue
!q --showbuckets                       # Shows all buckets and their contents
```

### Managing Songs in Buckets

All existing queue commands accept optional bucket parameters:

```
!shuffle --bucket=<name>               # Shuffle songs within a specific bucket
!jump <position> --bucket=<name>       # Jump to position within a bucket
!move <from> <to> --bucket=<name>      # Move song within a bucket
!remove <position> --bucket=<name>     # Remove song from a bucket
```

## Playback Modes

### Mode 1: Standard Playback (Default)

```
!play <song>
```

Plays from the default bucket only. This is the current behavior - most users won't even know buckets exist.

### Mode 2: Play All Buckets Sequentially

```
!playallbuckets
```

Plays all buckets in order of bucket creation:
1. All songs from bucket1
2. Then all songs from bucket2
3. Then all songs from bucket3
4. etc.

### Mode 3: Play Specific Buckets with Rotation

```
!playbucket <bucket1> <bucket2> ... --rotate
```

Alternates between specified buckets in round-robin fashion, picking one song from each bucket per rotation.

**Example:**
```
!playbucket hype chill --rotate
```
Playback order: hype[0], chill[0], hype[1], chill[1], hype[2], chill[2], ...

### Mode 4: Multi-Bucket with Custom Counts

```
!playmultibucket <bucket1> <count1> <bucket2> <count2> ... --rotate
```

Alternates between buckets in round-robin format, but picks a specified number of songs from each bucket before rotating.

**Example:**
```
!playmultibucket hype 2 chill 3 --rotate
```
Playback order: hype[0], hype[1], chill[0], chill[1], chill[2], hype[2], hype[3], chill[3], chill[4], chill[5], ...

## Advanced Behavior

### Empty Bucket Handling

When rotation encounters an empty bucket:
1. **Auto-skip** to next bucket in rotation
2. **Keep placeholder "try"** - the rotation slot stays active
3. If songs are added to that bucket later, they automatically slot into the rotation on the next cycle

**Why?** This allows dynamic bucket population during playback without breaking the rotation pattern.

### Queue Position with Buckets

When using `!playbucket` or `!playmultibucket`:
- Songs are **inserted** at the current queue position
- Existing queue after current position is preserved
- Provides immediate gratification while respecting existing queue

### Skip Behavior in Multi-Bucket Mode

```
!skip
```

In multi-bucket rotation mode, skip means "pass this bucket's turn, move to next bucket in rotation."

- Does NOT remove the song from the bucket
- Does NOT remove the bucket from rotation
- Simply advances to the next bucket's turn

### Now Playing Display

When playing from buckets, the now-playing embed should show bucket information:

```
🎵 Now Playing
[Bucket: Hype Tracks] Song Title - Artist
Added by: @Username
```

## Use Cases & Examples

### Use Case 1: Duet Mode (Two Users Taking Turns)

```
!playmultibucket alice 1 bob 1 --rotate
```

Alice and Bob alternate songs. If either adds more songs during playback, they go to their respective buckets and slot in on their turn.

### Use Case 2: Genre Mixing

```
!play rock-song --bucket=rock
!play hip-hop-song --bucket=hiphop
!play edm-song --bucket=edm
!playmultibucket rock 2 hiphop 1 edm 1 --rotate
```

Play 2 rock songs, then 1 hip-hop, then 1 EDM, repeat. Perfect for variety.

### Use Case 3: Energy Management

```
!playbucket warmup main hype cooldown
```

Play sequentially through energy levels for a party or workout session.

### Use Case 4: DJ Sets

```
!play opening-track --bucket=set1
!play transition-track --bucket=set2
!play finale-track --bucket=set3
!playallbuckets
```

Prepare multiple sets in advance, then play through them in order.

### Use Case 5: Fair Request Handling

```
!playmultibucket alice 1 bob 1 charlie 1 --rotate
```

Three friends each get equal turns. If Dave joins later and adds a song, he can either:
- Specify his bucket: `!play song --bucket=dave` (holds for later)
- Or get added to rotation if the group decides to include him

## Implementation Considerations

### Data Model

Each queued song needs to track:
```typescript
interface QueuedSong {
  // ... existing fields ...
  bucket?: string; // Bucket name, undefined = default bucket
}
```

Additional state to track:
```typescript
interface PlayerState {
  buckets: Map<string, QueuedSong[]>;  // Bucket name → songs in that bucket
  activeBuckets?: {                     // Only set during multi-bucket playback
    names: string[];                    // Bucket names in rotation order
    counts: number[];                   // Songs to pick per bucket per rotation
    currentIndex: number;               // Which bucket's turn it is
    currentCount: number;               // How many picked from current bucket this rotation
  };
}
```

### Progressive Complexity

**Beginner users:**
- Never specify `--bucket` flag
- Everything works like a normal music bot
- Buckets are invisible to them

**Intermediate users:**
- Learn `!play --bucket=<name>` to organize
- Use `!playbucket bucket1 bucket2 --rotate` for simple mixing

**Power users:**
- Master `!playmultibucket` with custom counts
- Create complex rotation patterns
- Organize elaborate listening sessions

### Command Aliases (Optional Quality of Life)

To reduce complexity for common patterns:

```
!duet @user                            # Alias for !playmultibucket me 1 @user 1 --rotate
!roundrobin bucket1 bucket2 bucket3    # Alias for !playmultibucket bucket1 1 bucket2 1 bucket3 1 --rotate
!fair @user1 @user2 @user3             # Creates user buckets and sets up equal rotation
```

### Visual Feedback

**Simple queue view (default):**
```
!q
Current Queue (12 songs):
1. Song A - Artist A
2. Song B - Artist B
...
```

**Bucket-aware view:**
```
!q --showbuckets
Current Queue (12 songs across 3 buckets):

[Default] (5 songs)
1. Song A - Artist A
2. Song B - Artist B

[Hype] (4 songs)
3. Song C - Artist C
4. Song D - Artist D

[Chill] (3 songs)
5. Song E - Artist E
...
```

**During rotation:**
```
!q
Multi-Bucket Rotation Active:
▶ [Hype] × 2 → [Chill] × 3 → repeat

Next up:
1. [Hype] Song A
2. [Hype] Song B
3. [Chill] Song C
4. [Chill] Song D
5. [Chill] Song E
6. [Hype] Song F
...
```

## Edge Cases & Error Handling

### Empty Bucket in Rotation
- Auto-skip with placeholder (covered above)
- User feedback: "⏭️ Skipping [BucketName] - empty"

### Non-existent Bucket
```
!q --bucket=doesntexist
```
Response: "❌ Bucket 'doesntexist' not found. Available buckets: default, hype, chill"

### Malformed Multibucket Command
```
!playmultibucket bucket1 2 bucket2
```
Response: "❌ Invalid format. Each bucket needs a count. Usage: !playmultibucket <bucket> <count> <bucket> <count> ..."

### Single Bucket in Rotation
```
!playmultibucket hype 2 --rotate
```
Works fine, just picks 2 songs from hype repeatedly. Effectively means "play hype bucket 2 songs at a time."

### All Buckets Empty in Rotation
- Stop playback
- Enter IDLE state
- User feedback: "⏹️ All buckets in rotation are empty"

## Future Enhancements (Not in Initial Spec)

### Bucket Metadata
- Track bucket creator
- Bucket descriptions
- Bucket creation timestamps
- Play count per bucket

### Bucket Permissions (if needed)
- Private buckets (only creator can add)
- Shared buckets (specific users can edit)
- Read-only buckets (curated playlists)

### Bucket Templates
- Save bucket configurations as templates
- `!loadtemplate friday-vibes` recreates buckets + rotation

### Cross-Server Buckets
- Export/import buckets between servers
- Share bucket configs

### Smart Buckets
- Auto-bucket by genre (if metadata available)
- Auto-bucket by tempo/energy
- Auto-bucket by user who added

### Bucket Analytics
- Most popular bucket
- Bucket play statistics
- User contribution stats per bucket

## Summary

Bucket Mode transforms the queue from a linear list into a flexible, multi-dimensional mixing system. It maintains backward compatibility (casual users won't notice it exists) while providing power users with sophisticated tools for organizing and blending music during long listening sessions.

The key insight: **rotation with placeholder tries** allows dynamic, collaborative queue building without breaking the playback flow.
