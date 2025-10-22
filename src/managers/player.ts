import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import Player from '../services/player.js';
import FileCacheProvider from '../services/file-cache.js';

@injectable()
export default class PlayerManager {
  private readonly guildPlayers: Map<string, Player>;
  private readonly pendingPlayers: Map<string, Promise<Player>>;
  private readonly fileCache: FileCacheProvider;

  constructor(@inject(TYPES.FileCache) fileCache: FileCacheProvider) {
    this.guildPlayers = new Map();
    this.pendingPlayers = new Map();
    this.fileCache = fileCache;
  }

  async get(guildId: string): Promise<Player> {
    const existing = this.guildPlayers.get(guildId);
    if (existing) {
      return existing;
    }

    let pending = this.pendingPlayers.get(guildId);

    if (!pending) {
      pending = Player.create(this.fileCache, guildId)
        .then(player => {
          this.guildPlayers.set(guildId, player);
          this.pendingPlayers.delete(guildId);
          return player;
        })
        .catch(error => {
          this.pendingPlayers.delete(guildId);
          throw error;
        });

      this.pendingPlayers.set(guildId, pending);
    }

    return pending;
  }

  getAll(): Player[] {
    return Array.from(this.guildPlayers.values());
  }
}
