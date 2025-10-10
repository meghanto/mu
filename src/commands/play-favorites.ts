import {ChatInputCommandInteraction, Message} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import fs from 'fs/promises';
import path from 'path';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SongMetadata, QueuedSong} from '../services/player.js';

const FAVORITES_DIR = path.join('data', 'favorites');

@injectable()
export default class PlayLikesCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('playlikes')
    .setDescription('plays all your favorited songs');

  public aliases = ['pf'];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    const userId = interaction.user.id;

    const userFavoritesPath = path.join(FAVORITES_DIR, `${userId}.json`);

    try {
      const fileContent = await fs.readFile(userFavoritesPath, 'utf-8');
      const favorites: SongMetadata[] = JSON.parse(fileContent);

      if (favorites.length === 0) {
        await interaction.reply({content: 'You have no favorited songs to play.', ephemeral: true});
        return;
      }

      const player = this.playerManager.get(guildId);

      const songs: QueuedSong[] = favorites.map((song: SongMetadata) => ({
        ...song,
        addedInChannelId: interaction.channel!.id,
        requestedBy: interaction.user.id,
      }));

      player.addMany(songs);

      await interaction.reply({content: `Added ${favorites.length} favorited songs to the queue.`});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await interaction.reply({content: 'You have no favorited songs to play.', ephemeral: true});
      } else {
        console.error(error);
        await interaction.reply({content: 'An error occurred while playing your favorited songs.', ephemeral: true});
      }
    }
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const mockInteraction = {
      options: {
        getString: () => null,
        getInteger: () => null,
        getBoolean: () => null,
        getSubcommand: () => null,
      },
      guild: message.guild,
      channel: message.channel,
      user: message.author,
      reply: async (options: any) => message.reply(options),
    } as unknown as ChatInputCommandInteraction;

    await this.execute(mockInteraction);
  }
}
