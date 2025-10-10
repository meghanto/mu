import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('shuffle the current queue')
    .addBooleanOption(option => option
      .setName('upcoming')
      .setDescription('shuffle only upcoming songs (excluding current and previous)')
      .setRequired(false));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executePrefix(message: Message, args: string[], prefix: string): Promise<void> {
    let upcoming = false;

    const filteredArgs: string[] = [];
    for (const arg of args) {
      if (arg === '--upcoming') {
        upcoming = true;
      } else {
        filteredArgs.push(arg); // Should be no other args for shuffle
      }
    }

    // Create a mock ChatInputCommandInteraction
    const mockInteraction: ChatInputCommandInteraction = {
      guild: message.guild,
      channel: message.channel,
      member: message.member,
      options: {
        getBoolean: (name: string) => {
          if (name === 'upcoming') return upcoming;
          return null;
        },
      } as any,
      deferReply: async (options?: any) => {
        await message.channel.send('Thinking...');
      },
      editReply: async (options: any) => {
        await message.channel.send(options.content || { embeds: options.embeds });
      },
      reply: async (options: any) => {
        await message.reply(options.content || { embeds: options.embeds });
      },
    } as ChatInputCommandInteraction;

    await this.execute(mockInteraction);
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);
    const upcomingOnly = interaction.options.getBoolean('upcoming') ?? false;

    if (player.isQueueEmpty()) {
      throw new Error('not enough songs to shuffle');
    }

    player.shuffle(upcomingOnly);

    await interaction.reply(upcomingOnly ? 'shuffled upcoming songs' : 'shuffled entire queue');
  }
}
