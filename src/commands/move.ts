import {ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('move')
    .setDescription('move songs within the queue')
    .addStringOption(option =>
      option.setName('from')
        .setDescription('position of the song to move (e.g., 1, current, next-1)')
        .setRequired(true),
    )
    .addStringOption(option =>
      option.setName('to')
        .setDescription('position to move the song to (e.g., 1, top, next+2, last-1)')
        .setRequired(true));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  private parsePositionArgument(arg: string, player: Player): number {
    const queueLength = player.queue.length;
    const currentQueuePosition = player.queuePosition;

    let basePosition: number | undefined; // 1-based index

    if (arg.startsWith('top')) {
      basePosition = 1;
    } else if (arg.startsWith('current')) {
      basePosition = currentQueuePosition + 1;
    } else if (arg.startsWith('next')) {
      basePosition = currentQueuePosition + 2;
    } else if (arg.startsWith('last')) {
      basePosition = queueLength;
    } else {
      basePosition = parseInt(arg, 10);
    }

    if (isNaN(basePosition) || basePosition < 1) {
      throw new Error('Invalid position keyword or number.');
    }

    let offset = 0;
    const offsetMatch = arg.match(/([+-]\d+)$/);
    if (offsetMatch) {
      offset = parseInt(offsetMatch[1], 10);
    }

    let finalPosition = basePosition + offset;

    // Ensure 'finalPosition' is within valid bounds (1 to queueLength)
    finalPosition = Math.max(1, Math.min(finalPosition, queueLength));

    return finalPosition;
  }

  public async executePrefix(message: Message, args: string[], prefix: string): Promise<void> {
    if (args.length < 2) {
      await message.channel.send(errorMsg('Please provide both "from" and "to" positions.'));
      return;
    }

    const player = this.playerManager.get(message.guild!.id);

    let from: number;
    let to: number;

    try {
      from = this.parsePositionArgument(args[0].toLowerCase(), player);
      to = this.parsePositionArgument(args[1].toLowerCase(), player);
    } catch (e: unknown) {
      await message.channel.send(errorMsg((e as Error).message));
      return;
    }

    // Create a mock ChatInputCommandInteraction
    const mockInteraction: ChatInputCommandInteraction = {
      guild: message.guild,
      channel: message.channel,
      member: message.member,
      options: {
        getInteger: (name: string) => {
          if (name === 'from') return from;
          if (name === 'to') return to;
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

    const fromArg = interaction.options.getString('from')!;
    const toArg = interaction.options.getString('to')!;

    let from: number;
    let to: number;

    try {
      from = this.parsePositionArgument(fromArg.toLowerCase(), player);
      to = this.parsePositionArgument(toArg.toLowerCase(), player);
    } catch (e: unknown) {
      throw new Error((e as Error).message); // Re-throw for slash command error handling
    }

    const {title} = player.move(from, to);

    await interaction.reply('moved **' + title + '** to position **' + String(to) + '**');
  }
}
