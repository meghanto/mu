# Queue Handling Architecture - Error Summary

## Overview
The queue persistence system has fundamental architectural issues that cause race conditions, inconsistent state, and broken playback behavior.

---

## Critical Issues

### 1. **Race Conditions Between In-Memory Queue and Database State**

**Problem**: The queue exists in two places simultaneously:
- In-memory array: `this.queue` (lines 114, player.ts)
- Database: `QueueState` table via Prisma

**Race Condition Scenarios**:

#### Scenario A: Concurrent Saves Overwrite Each Other
```
Time 0: Queue = [Song A, Song B], Position = 0
Time 1: User adds Song C → saveQueueContents() starts (async)
Time 2: User skips → forward() updates position to 1, saveQueueContents() starts (async)
Time 3: First save completes with Position = 0
Time 4: Second save completes with Position = 1
Result: Database state is inconsistent - might have wrong position or missing Song C
```

#### Scenario B: Load Overwrites Fresh State
```
Time 0: Bot restarts, Player constructor calls loadQueueState() (async, not awaited)
Time 1: User adds Song A via !play → add() updates in-memory queue, saveQueueContents() starts
Time 2: loadQueueState() completes, overwrites in-memory queue with empty database state
Time 3: saveQueueContents() completes, saves empty queue back to database
Result: Song A disappears
```

**Current "Fix" is Broken** (lines 202-210):
```typescript
if (this.queue.length > 0) {
  debug(`Skipping queue load for guild ${this.guildId} - queue already in memory`);
  return;
}
```
This prevents loading if queue already exists, but:
- Defeats the purpose of queue persistence on bot restart
- Only works if songs are added before loadQueueState completes
- Timing-dependent behavior (race condition)

---

### 2. **Constructor Async/Await Anti-Pattern**

**Problem** (line 137):
```typescript
constructor(fileCache: FileCacheProvider, guildId: string) {
  this.fileCache = fileCache;
  this.guildId = guildId;
  
  // Load saved queue state on initialization
  this.queueLoadedPromise = this.loadQueueState(); // ❌ Fire-and-forget
}
```

**Why This is Wrong**:
- Constructors cannot be async
- `loadQueueState()` runs in background, no guarantee when it completes
- Methods that call `ensureQueueLoaded()` work, but initial state is undefined
- Player can be used before queue is loaded

**Symptom**: User reports "queue goes back to being empty" after resume because:
1. Bot restarts
2. Player constructed with empty queue
3. User calls !resume before `loadQueueState()` completes
4. Resume sees empty queue

---

### 3. **Inconsistent Auto-Play Logic**

**Problem** (add-query-to-queue.ts, lines 130-146):
```typescript
if (player.voiceConnection === null) {
  await player.connect(targetVoiceChannel);
  await player.play(); // ✓ Plays when no connection
} else if (player.status === STATUS.IDLE || player.status === STATUS.PAUSED) {
  await player.play(); // ✓ Plays when idle/paused
}
// ❌ Does NOT play when status is PLAYING
```

**Why This Breaks**:
- If a song is already playing and user adds more songs via !play, nothing happens
- Songs sit in queue but don't auto-advance
- User expects !play to either start playback OR queue for later, behavior is inconsistent

**Compounded By**: Status management is fragile
- STATUS.PLAYING set in multiple places (lines 407, 445, 476)
- STATUS.PAUSED set in pause() and on errors
- STATUS.IDLE set only when queue empties (line 533)
- No single source of truth for player state

---

### 4. **Queue Position Management is Fragile**

**Problem**: `queuePosition` is incremented/decremented in multiple places:
- `manualForward()`: `this.queuePosition += skip` (line 635)
- `forward()`: calls `manualForward()`, then on error: `this.queuePosition--` (line 550)
- `back()`: `this.queuePosition--` (line 643)
- `shuffle()`: can reset to 0 (line 754)
- `clear()`: resets to 0 (line 769)
- `jumpTo()`: sets to `position - 1` (line 690)

**Why This is Dangerous**:
- No validation that position stays within bounds
- `manualForward()` can increment beyond queue length
- `forward()` tries to rollback on error, but if `play()` fails, position is wrong
- Database saves might happen before or after position updates

**Example Bug Flow** (from user's reported issue):
```
1. Queue has 3 songs, position = 0
2. User calls skip → forward(1)
3. manualForward(1) → position = 1
4. play() fails (network error)
5. Error handler calls forward(1) again (line 480)
6. manualForward(1) → position = 2
7. play() fails again
8. Error handler calls forward(1) again
9. manualForward(1) → position = 3 (OUT OF BOUNDS!)
10. getCurrent() returns null
11. Queue appears empty
```

---

### 5. **Void Async Calls Everywhere**

**Problem**: Database operations use `void` to fire-and-forget:
```typescript
void this.saveQueueContents();  // Line 733, add()
void this.saveQueueContents();  // Line 738, addMany()
void this.saveQueueContents();  // Line 757, shuffle()
void this.saveQueueContents();  // Line 772, clear()
void this.saveQueueContents();  // Line 776, removeFromQueue()
void this.saveQueueContents();  // Line 785, removeCurrent()
void this.saveQueueContents();  // Line 530, forward()
void this.saveQueueContents();  // Line 815, move()
```

**Why This is Wrong**:
- No guarantee saves complete before next operation
- Multiple saves can be in-flight simultaneously
- Last save wins, middle updates can be lost
- No error handling if save fails
- Creates race conditions with loadQueueState()

**Example**:
```
User types: !play song1 → !play song2 → !skip
This triggers: save1, save2, save3 (all concurrent)
Database ends up with: ??? (whichever save finishes last)
```

---

### 6. **`stop()` vs `clear()` vs `disconnect()` Confusion**

**Problem**: Three different methods manipulate queue state:

```typescript
// stop() - line 798
stop(): void {
  this.disconnect();
  this.queuePosition = 0;
  this.queue = [];
  // ❌ Does NOT save to database
}

// clear() - line 759
clear(): void {
  const newQueue = [];
  const current = this.getCurrent();
  if (current) {
    newQueue.push(current);
  }
  this.queuePosition = 0;
  this.queue = newQueue;
  void this.saveQueueContents(); // ✓ Saves
}

// disconnect() - calls saveFullState() elsewhere
```

**Why This is Broken**:
- `stop()` clears queue in memory but NOT in database
- After bot restart, "stopped" queue reappears
- User confusion: "I stopped playback, why are songs still there?"

---

### 7. **No Atomic Transactions**

**Problem**: Queue modifications are multi-step operations with no atomicity:

```typescript
add(song: QueuedSong, options): void {
  if (insertAt !== undefined) {
    this.queue.splice(insertAt - 1, 0, song);  // Step 1: Modify array
  } else if (song.playlist || !immediate) {
    this.queue.push(song);                      // Step 1: Modify array
  } else {
    const insertIndex = this.queuePosition + 1;
    this.queue.splice(insertIndex, 0, song);    // Step 1: Modify array
  }
  void this.saveQueueContents();                // Step 2: Save (async)
}
```

**What Can Go Wrong**:
- If bot crashes between step 1 and step 2, database has stale data
- If another operation happens during step 2, state diverges
- No rollback mechanism if save fails

---

### 8. **Player Per Guild Singleton Pattern Issues**

**Problem** (managers/player.ts):
```typescript
export default class PlayerManager {
  private readonly players: Map<string, Player> = new Map();
  
  get(guildId: string): Player {
    if (!this.players.has(guildId)) {
      const newPlayer = new Player(this.fileCache, guildId);
      this.players.set(guildId, newPlayer);
    }
    return this.players.get(guildId)!;
  }
}
```

**Why This is Problematic**:
- Player instance created on first access
- Constructor starts async `loadQueueState()`
- Subsequent `get()` calls return same instance
- But if called multiple times quickly, first access might not have loaded queue yet
- No way to know when Player is "ready"

**User Impact**:
```
Bot starts → User1 types !play → PlayerManager.get() creates Player
→ loadQueueState() starts loading → User1's command sees empty queue
→ loadQueueState() completes → User2 types !queue → sees loaded queue
→ Inconsistent behavior depending on timing
```

---

## Architectural Recommendations

### Short-term Fixes (Band-aids)

1. **Make queue loading synchronous during resume**:
   - Don't rely on constructor to load
   - Resume command should explicitly await load before operating

2. **Debounce database saves**:
   - Don't save on every modification
   - Use a debounce timer (e.g., 500ms)
   - Batch multiple changes into single save

3. **Add queue state validation**:
   - Validate `queuePosition < queue.length` before every operation
   - Throw errors instead of silently breaking

### Long-term Fixes (Proper Solution)

1. **Single Source of Truth**:
   - Either use database as primary (load on every read) OR
   - Use in-memory as primary (only save on disconnect/shutdown)
   - Don't try to keep both in sync continuously

2. **Event-Driven Architecture**:
   ```typescript
   class Player extends EventEmitter {
     private queue: QueuedSong[] = [];
     
     add(song: QueuedSong) {
       this.queue.push(song);
       this.emit('queue:modified', this.queue);
     }
   }
   
   // Separate persistence layer
   player.on('queue:modified', debounce((queue) => {
     saveToDatabase(queue);
   }, 500));
   ```

3. **Async Initialization Pattern**:
   ```typescript
   class Player {
     private constructor() { /* private */ }
     
     static async create(guildId: string): Promise<Player> {
       const player = new Player();
       await player.loadQueueState();
       return player; // Guaranteed to be ready
     }
   }
   ```

4. **Use a State Machine**:
   - Explicitly model states: INITIALIZING, IDLE, PLAYING, PAUSED, ERROR
   - Validate state transitions
   - Prevent operations in wrong states

5. **Queue Operation Queue** (yes, a queue for queue operations):
   ```typescript
   private operationQueue: Promise<void> = Promise.resolve();
   
   async add(song: QueuedSong) {
     this.operationQueue = this.operationQueue.then(async () => {
       this.queue.push(song);
       await this.saveQueueContents(); // Await, don't void
     });
     await this.operationQueue;
   }
   ```

---

## Summary of User-Reported Symptoms and Root Causes

| Symptom | Root Cause |
|---------|------------|
| "Queue goes back to empty after resume" | Race between `loadQueueState()` and user commands |
| "Songs added but not played" | Auto-play logic only checks IDLE/PAUSED, not PLAYING status |
| "Skip makes songs disappear" | `forward()` error handler increments position beyond bounds |
| "Queue shows different content after operations" | Void async saves complete out of order |
| "Stop doesn't persist, songs come back" | `stop()` doesn't save to database |

---

## Current State Assessment

**What Works**:
- Basic queue operations (add, remove, move) work in isolation
- Database schema is sound
- Volume control and loop modes work

**What's Broken**:
- Queue persistence is fundamentally unreliable
- Race conditions everywhere
- No error recovery
- Timing-dependent behavior
- State consistency not guaranteed

**Severity**: **HIGH** - The queue system is not production-ready. Users will experience data loss, inconsistent behavior, and frustration.
