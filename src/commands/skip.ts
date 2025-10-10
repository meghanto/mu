import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('skip')
    .setDescription('skip the next songs')
    .addIntegerOption(option => option
      .setName('number')
      .setDescription('number of songs to skip [default: 1]')
      .setRequired(false));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public readonly aliases = ['s'];

  public async executePrefix(message: Message, args: string[], prefix: string): Promise<void> {
    const numToSkip = parseInt(args[0], 10) || 1;

    // Create a mock ChatInputCommandInteraction
    const mockInteraction: ChatInputCommandInteraction = {
      guild: message.guild,
      channel: message.channel,
      member: message.member,
      options: {
        getInteger: (name: string) => {
          if (name === 'number') return numToSkip;
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
    const numToSkip = interaction.options.getInteger('number') ?? 1;

    if (numToSkip < 1) {
      throw new Error('invalid number of songs to skip');
    }

    const player = this.playerManager.get(interaction.guild!.id);

    try {
      await player.forward(numToSkip);
      await interaction.reply({
        content: 'keep \'er movin\'',
        embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [],
      });
    } catch (_: unknown) {
      throw new Error('no song to skip to');
    }
  }
}
